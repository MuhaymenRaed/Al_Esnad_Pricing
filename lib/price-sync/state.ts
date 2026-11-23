import "server-only";

import type { SyncStateRow, SyncSystem } from "@/features/devices/sync-state";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { DeviceSyncStateUpsert, Json } from "@/types/database";
import { lookupAlisnad } from "./alisnad";
import { lookupErpnext } from "./erpnext";
import { chunk, getSyncTargets, type RemoteItem } from "./targets";

const isMissingTable = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || /device_sync_state|device_link_codes/.test(error.message ?? "")));

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

/**
 * Looks every link code of these devices up on alisnad.iq and in ERPNext
 * (read-only, batched) and stores what each system holds in device_sync_state,
 * which drives the status badges. `published` marks the systems that were just
 * published to successfully. Uses the service role: callers authorise first.
 * Returns false when the price-sync tables are not installed yet.
 */
export async function refreshSyncState(deviceIds: string[], options: { published?: Map<string, Set<SyncSystem>> } = {}): Promise<boolean> {
  const targets = getSyncTargets();
  const ids = [...new Set(deviceIds)];
  if (!ids.length || (!targets.alisnad && !targets.erpnext)) return true;
  const db = createAdminClient();

  const codesOf = new Map<string, string[]>();
  for (const part of chunk(ids, 100)) {
    const { data, error } = await db.from("device_link_codes").select("device_id, code").in("device_id", part);
    if (isMissingTable(error)) return false;
    if (error) throw error;
    for (const row of data ?? []) codesOf.set(row.device_id, [...(codesOf.get(row.device_id) ?? []), row.code]);
  }
  const unlinked = ids.filter((id) => !codesOf.has(id));
  const allCodes = [...new Set([...codesOf.values()].flat())];

  const { data: settings } = await db.from("company_settings").select("currency_code").maybeSingle();
  const currency = settings?.currency_code ?? "IQD";

  const lookup = async <T>(enabled: boolean, run: () => Promise<Map<string, T>>) => {
    if (!enabled || !allCodes.length) return null;
    try {
      return { found: await run() };
    } catch (error) {
      return { error: errorText(error) };
    }
  };
  const [alisnad, erpnext] = await Promise.all([
    lookup(Boolean(targets.alisnad), () => lookupAlisnad(targets.alisnad!, allCodes)),
    lookup(Boolean(targets.erpnext), () => lookupErpnext(targets.erpnext!, allCodes, currency)),
  ]);

  const now = new Date().toISOString();
  // Rows of one request must share their columns: a column left out keeps its value.
  const groups = new Map<string, DeviceSyncStateUpsert[]>();
  const add = (row: DeviceSyncStateUpsert) => {
    const key = Object.keys(row).sort().join(",");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  };
  for (const [deviceId, codes] of codesOf) {
    const sorted = [...codes].sort();
    for (const [target, result] of [
      ["alisnad", alisnad],
      ["erpnext", erpnext],
    ] as const) {
      if (!result) continue;
      const row: DeviceSyncStateUpsert = { device_id: deviceId, target, codes: sorted, checked_at: now };
      if ("error" in result) {
        row.error = result.error;
      } else {
        const items: RemoteItem[] = sorted.map((c) => result.found.get(c)).filter((i): i is RemoteItem => Boolean(i));
        row.items = items as unknown as Json;
        row.error = null;
        if (options.published?.get(deviceId)?.has(target)) row.published_at = now;
      }
      add(row);
    }
  }
  for (const rows of groups.values()) {
    const { error } = await db.from("device_sync_state").upsert(rows, { onConflict: "device_id,target" });
    if (isMissingTable(error)) return false;
    if (error) throw error;
  }
  for (const part of chunk(unlinked, 100)) {
    const { error } = await db.from("device_sync_state").delete().in("device_id", part);
    if (error && !isMissingTable(error)) throw error;
  }
  return true;
}

/** Refreshes devices whose stored status does not describe their current link codes (e.g. right after a save). */
export async function refreshStaleSyncState(deviceIds: string[]) {
  try {
    const db = createAdminClient();
    const [{ data: codes, error }, { data: states }] = await Promise.all([
      db.from("device_link_codes").select("device_id, code").in("device_id", deviceIds),
      db.from("device_sync_state").select("device_id, target, codes").in("device_id", deviceIds),
    ]);
    if (error) return;
    const stale = deviceIds.filter((id) => {
      const mine = (codes ?? []).filter((c) => c.device_id === id).map((c) => c.code).sort();
      const rows = (states ?? []).filter((s) => s.device_id === id);
      if (!mine.length) return rows.length > 0;
      return !rows.length || rows.some((r) => [...r.codes].sort().join("\n") !== mine.join("\n"));
    });
    if (stale.length) await refreshSyncState(stale);
  } catch (error) {
    console.error("Sync status refresh failed", error);
  }
}

/** Link codes and stored status of these devices, read as the signed-in user (RLS: financials.read). */
export async function loadSyncRows(
  supabase: ServerSupabase,
  deviceIds: string[],
): Promise<{ codes: Map<string, string[]>; rows: Map<string, SyncStateRow[]> } | null> {
  const codes = new Map<string, string[]>();
  const rows = new Map<string, SyncStateRow[]>();
  if (!deviceIds.length) return { codes, rows };
  for (const part of chunk(deviceIds, 100)) {
    const [c, s] = await Promise.all([
      supabase.from("device_link_codes").select("device_id, code").in("device_id", part),
      supabase.from("device_sync_state").select("device_id, target, codes, items, error, checked_at, published_at").in("device_id", part),
    ]);
    if (c.error || s.error) return null;
    for (const row of c.data ?? []) codes.set(row.device_id, [...(codes.get(row.device_id) ?? []), row.code]);
    for (const row of (s.data ?? []) as SyncStateRow[]) rows.set(row.device_id, [...(rows.get(row.device_id) ?? []), row]);
  }
  return { codes, rows };
}
