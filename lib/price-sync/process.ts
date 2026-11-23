import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Json, PriceSyncJobRow } from "@/types/database";
import { pushAlisnadPrice } from "./alisnad";
import { pushErpnextPrice } from "./erpnext";
import { getSyncTargets, pool, type TargetResult } from "./targets";

export type SyncResults = { alisnad: TargetResult; erpnext: TargetResult };
export type SyncOutcome = {
  jobId: number;
  deviceId: string;
  codes: string[];
  price: number;
  buyingPrice: number | null;
  status: "done" | "failed";
  results: SyncResults;
};

/** A job stuck in "processing" this long (crashed request) may be picked up again. */
const STALE_MS = 5 * 60_000;

type JobRow = Pick<PriceSyncJobRow, "id" | "device_id" | "codes" | "selling_price" | "buying_price" | "currency_code" | "status" | "attempts" | "updated_at">;

const isMissingTable = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || /price_sync_jobs/.test(error.message ?? "")));

const skipped: TargetResult = { status: "skipped", reason: "not_configured" };

/**
 * Publishes open jobs (pending, failed, or stale "processing") of the given
 * devices: alisnad.iq gets the selling price, ERPNext the selling and the
 * purchase price. Jobs are only created when staff press "Publish"
 * (request_price_syncs), never by a price change. Each outcome is stored on
 * its job; pushing is idempotent (absolute prices).
 *
 * Callers must have authorised the user first; this uses the service role.
 */
export async function processPriceSync({ deviceIds, limit = 25 }: { deviceIds: string[]; limit?: number }): Promise<{
  available: boolean;
  outcomes: SyncOutcome[];
}> {
  const targets = getSyncTargets();
  if (!targets.alisnad && !targets.erpnext) return { available: false, outcomes: [] };
  if (!deviceIds.length) return { available: true, outcomes: [] };

  const db = createAdminClient();
  const { data: jobs, error } = await db
    .from("price_sync_jobs")
    .select("id, device_id, codes, selling_price, buying_price, currency_code, status, attempts, updated_at")
    .in("status", ["pending", "failed", "processing"])
    .in("device_id", deviceIds)
    .order("id", { ascending: true })
    .limit(limit);
  if (isMissingTable(error)) return { available: false, outcomes: [] };
  if (error) throw error;

  const run = async (job: JobRow): Promise<SyncOutcome | null> => {
    if (job.status === "processing" && Date.now() - new Date(job.updated_at).getTime() < STALE_MS) return null;

    // Claim the job: only one request may move it out of its current state.
    const { data: claimed } = await db
      .from("price_sync_jobs")
      .update({ status: "processing", attempts: job.attempts + 1 })
      .eq("id", job.id)
      .eq("status", job.status)
      .select("id");
    if (!claimed?.length) return null;

    const price = Number(job.selling_price);
    const buyingPrice = job.buying_price === null || job.buying_price === undefined ? null : Number(job.buying_price);
    const [alisnad, erpnext] = await Promise.all([
      targets.alisnad ? pushAlisnadPrice(targets.alisnad, job.codes, price) : Promise.resolve(skipped),
      targets.erpnext ? pushErpnextPrice(targets.erpnext, job.codes, { selling: price, buying: buyingPrice }, job.currency_code) : Promise.resolve(skipped),
    ]);
    const results: SyncResults = { alisnad, erpnext };
    const errors = Object.entries(results)
      .filter(([, r]) => r.status === "error")
      .map(([system, r]) => `${system}: ${(r as { error: string }).error}`);
    const status = errors.length ? "failed" : "done";

    // Only finish the job if it is still ours (a newer request may have superseded it meanwhile).
    await db
      .from("price_sync_jobs")
      .update({ status, results: results as unknown as Json, last_error: errors.join(" | ") || null })
      .eq("id", job.id)
      .eq("status", "processing");

    return { jobId: job.id, deviceId: job.device_id, codes: job.codes, price, buyingPrice, status, results };
  };

  const outcomes = await pool((jobs ?? []) as JobRow[], 4, run);
  return { available: true, outcomes: outcomes.filter((o): o is SyncOutcome => Boolean(o)) };
}
