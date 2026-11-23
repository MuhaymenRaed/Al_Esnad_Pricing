"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth/guard";
import { fail, ok, toUserMessage, type ActionResult } from "@/lib/errors";
import { deviceFiltersSchema, type DeviceFilters } from "@/lib/filters/devices";
import { findAlisnadByNames, lookupAlisnad, searchAlisnad } from "@/lib/price-sync/alisnad";
import { findErpnextByNames, lookupErpnext, searchErpnext } from "@/lib/price-sync/erpnext";
import { processPriceSync, type SyncResults } from "@/lib/price-sync/process";
import { refreshSyncState } from "@/lib/price-sync/state";
import { getSyncTargets, normaliseName, type RemoteItem } from "@/lib/price-sync/targets";
import { createClient } from "@/lib/supabase/server";
import type { DeviceStatus } from "@/types/database";
import { fetchAllDevices, loadDeviceSync } from "./queries";
import type { DeviceSync, SyncSystem } from "./sync-state";
import type { SelectedDevice } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cleanIds = (ids: string[], max: number) => [...new Set(ids)].filter((id) => UUID.test(id)).slice(0, max);

/** The price-sync migrations are not installed yet (function or table unknown). */
const notInstalled = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === "PGRST202" || error.code === "PGRST205" || error.code === "42883" || error.code === "42P01"));

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function revalidate(ids: string[]) {
  revalidatePath("/devices");
  if (ids.length === 1) revalidatePath(`/devices/${ids[0]}`);
}

/** One device as shown in the publish review: its prices here and what each system holds. */
export type ReviewDevice = {
  id: string;
  name: string;
  status: DeviceStatus;
  selling: number | null;
  purchase: number | null;
  sync: DeviceSync | null;
};

async function reviewOf(ids: string[], decimals: number): Promise<ReviewDevice[]> {
  if (!ids.length) return [];
  const supabase = await createClient();
  const [devices, financials] = await Promise.all([
    supabase.from("devices").select("id, name, status").in("id", ids),
    supabase.from("device_financials").select("device_id, final_selling_price, official_purchase_price").in("device_id", ids),
  ]);
  const prices = new Map(
    (financials.data ?? []).map((f) => [f.device_id, { selling: Number(f.final_selling_price), purchase: Number(f.official_purchase_price) }]),
  );
  const sync = await loadDeviceSync(supabase, ids, decimals, prices).catch(() => null);
  const order = new Map(ids.map((id, i) => [id, i]));
  return (devices.data ?? [])
    .map((d) => ({
      id: d.id,
      name: d.name,
      status: d.status,
      selling: prices.get(d.id)?.selling ?? null,
      purchase: prices.get(d.id)?.purchase ?? null,
      sync: sync?.get(d.id) ?? null,
    }))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/**
 * Re-reads what alisnad.iq and ERPNext hold for these devices (no price
 * changes anywhere) and returns them with their prices here. Used by "Check
 * status" and as the first step of the publish review. At most 40 per call.
 */
export async function checkSyncAction(ids: string[]): Promise<ActionResult<{ devices: ReviewDevice[] }>> {
  const auth = await authorizeAction(["devices.read_all", "financials.read"]);
  if ("error" in auth) return auth.error;
  const unique = cleanIds(ids, 40);
  if (!unique.length) return fail("errors.selectDevices");
  const targets = getSyncTargets();
  if (!targets.alisnad && !targets.erpnext) return fail("sync.unavailable");
  try {
    if (!(await refreshSyncState(unique))) return fail("sync.needsMigration");
  } catch (e) {
    console.error("Sync status check failed", errorText(e));
    return fail(toUserMessage(e, "sync.checkFailed"));
  }
  revalidate(unique);
  return ok({ devices: await reviewOf(unique, auth.session.settings.currencyDecimals) });
}

export type PublishOutcome = {
  id: string;
  /** published: at least one system holds the prices now; not_found: no code exists in either system. */
  outcome: "published" | "not_found" | "failed" | "skipped";
  skipped?: "not_found" | "not_linked" | "not_active" | "no_price";
  results?: SyncResults;
};

/**
 * "Publish", after the admin confirmed the review: sends the current prices of
 * approved, linked devices to alisnad.iq (final selling price) and ERPNext
 * (purchase price, and the selling price when a selling price list is set).
 * The ONLY way prices reach those systems. At most 8 devices per call; the
 * browser sends larger selections in batches.
 */
export async function publishPricesAction(ids: string[]): Promise<ActionResult<{ outcomes: PublishOutcome[]; devices: ReviewDevice[] }>> {
  const auth = await authorizeAction(["prices.publish", "financials.update"]);
  if ("error" in auth) return auth.error;
  const unique = cleanIds(ids, 8);
  if (!unique.length) return fail("errors.selectDevices");
  const targets = getSyncTargets();
  if (!targets.alisnad && !targets.erpnext) return fail("sync.unavailable");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_price_syncs", { p_ids: unique });
  if (notInstalled(error)) return fail("sync.needsMigration");
  if (error) return fail(toUserMessage(error));
  const rows = data ?? [];
  const queued = rows.filter((r) => r.job_id !== null).map((r) => r.device_id);

  let outcomes: Awaited<ReturnType<typeof processPriceSync>>["outcomes"] = [];
  try {
    outcomes = (await processPriceSync({ deviceIds: queued, limit: queued.length * 2 + 2 })).outcomes;
  } catch (e) {
    console.error("Publishing prices failed", errorText(e));
    return fail(toUserMessage(e, "sync.failedTitle"));
  }
  const byDevice = new Map(outcomes.map((o) => [o.deviceId, o]));
  const published = new Map<string, Set<SyncSystem>>();
  for (const o of outcomes) {
    const done = new Set<SyncSystem>();
    for (const system of ["alisnad", "erpnext"] as const) {
      if (o.results[system].status === "updated" || o.results[system].status === "unchanged") done.add(system);
    }
    published.set(o.deviceId, done);
  }
  // Read both systems back so the badges show what they hold now.
  await refreshSyncState(queued, { published }).catch((e) => console.error("Sync status refresh failed", errorText(e)));

  const result: PublishOutcome[] = rows.map((r) => {
    if (r.skipped) return { id: r.device_id, outcome: "skipped", skipped: r.skipped };
    const o = byDevice.get(r.device_id);
    if (!o) return { id: r.device_id, outcome: "failed" };
    const outcome = o.status === "failed" ? "failed" : published.get(r.device_id)?.size ? "published" : "not_found";
    return { id: r.device_id, outcome, results: o.results };
  });
  revalidate(unique);
  return ok({ outcomes: result, devices: await reviewOf(unique, auth.session.settings.currencyDecimals) });
}

/**
 * Automatic linking: devices WITHOUT link codes get the ERPNext Items and
 * alisnad.iq products whose name (or code / SKU) is exactly the device name,
 * ignoring letter case and spacing. Existing links are never changed, and a
 * code already linked to another device stays with it. At most 40 per call.
 */
export async function autoLinkAction(ids: string[]): Promise<ActionResult<{ linked: number; already: number; none: number; taken: number }>> {
  const auth = await authorizeAction(["devices.update", "financials.update"]);
  if ("error" in auth) return auth.error;
  const unique = cleanIds(ids, 40);
  if (!unique.length) return fail("errors.selectDevices");
  const targets = getSyncTargets();
  if (!targets.alisnad && !targets.erpnext) return fail("sync.unavailable");

  const supabase = await createClient();
  const [devices, links] = await Promise.all([
    supabase.from("devices").select("id, name").in("id", unique),
    supabase.from("device_link_codes").select("device_id").in("device_id", unique),
  ]);
  if (notInstalled(links.error)) return fail("sync.needsMigration");
  if (devices.error || links.error) return fail(toUserMessage(devices.error ?? links.error));
  const alreadyLinked = new Set((links.data ?? []).map((l) => l.device_id));
  const candidates = (devices.data ?? []).filter((d) => !alreadyLinked.has(d.id));
  if (!candidates.length) return ok({ linked: 0, already: alreadyLinked.size, none: 0, taken: 0 });

  const names = [...new Set(candidates.map((d) => d.name.trim()))];
  let erp: Array<{ code: string; name: string }> = [];
  let site: Array<{ code: string; names: string[] }> = [];
  try {
    [erp, site] = await Promise.all([
      targets.erpnext ? findErpnextByNames(targets.erpnext, names) : Promise.resolve([]),
      targets.alisnad ? findAlisnadByNames(targets.alisnad, names) : Promise.resolve([]),
    ]);
  } catch (e) {
    console.error("Automatic linking lookup failed", errorText(e));
    return fail("sync.checkFailed");
  }

  const byName = new Map<string, Set<string>>();
  const add = (name: string, code: string) => {
    const key = normaliseName(name);
    byName.set(key, (byName.get(key) ?? new Set()).add(code));
  };
  for (const item of erp) {
    add(item.name, item.code);
    add(item.code, item.code);
  }
  for (const product of site) for (const n of product.names) add(n, product.code);

  const payload = candidates
    .map((d) => ({ device_id: d.id, codes: [...(byName.get(normaliseName(d.name)) ?? [])].slice(0, 50) }))
    .filter((p) => p.codes.length);
  if (!payload.length) return ok({ linked: 0, already: alreadyLinked.size, none: candidates.length, taken: 0 });

  const { data, error } = await supabase.rpc("link_devices", { p_links: payload });
  if (notInstalled(error)) return fail("sync.needsMigration");
  if (error) return fail(toUserMessage(error));
  const linked = (data ?? []).filter((r) => r.linked.length).map((r) => r.device_id);
  const taken = (data ?? []).filter((r) => !r.linked.length && r.taken.length).length;
  await refreshSyncState(linked).catch((e) => console.error("Sync status refresh failed", errorText(e)));
  revalidate(unique);
  return ok({ linked: linked.length, already: alreadyLinked.size, none: candidates.length - payload.length, taken });
}

export type LinkSide = { configured: boolean; error?: boolean; items: RemoteItem[] };
export type LinkSearch = {
  erpnext: LinkSide;
  alisnad: LinkSide;
  /** Codes already linked to a device: which one. */
  owners: Record<string, { id: string; name: string }>;
};

/** Finds ERPNext Items and alisnad.iq products to link (device form). */
export async function searchLinkTargetsAction(query: string): Promise<ActionResult<LinkSearch>> {
  const auth = await authorizeAction(["devices.update", "financials.read"], { write: false });
  if ("error" in auth) return auth.error;
  const q = query.trim().slice(0, 120);
  const targets = getSyncTargets();
  const empty = (configured: boolean): LinkSide => ({ configured, items: [] });
  if (q.length < 2) return ok({ erpnext: empty(Boolean(targets.erpnext)), alisnad: empty(Boolean(targets.alisnad)), owners: {} });

  const currency = auth.session.settings.currencyCode;
  const side = async (configured: boolean, run: () => Promise<RemoteItem[]>): Promise<LinkSide> => {
    if (!configured) return empty(false);
    try {
      return { configured: true, items: await run() };
    } catch (e) {
      console.error("Link search failed", errorText(e));
      return { configured: true, error: true, items: [] };
    }
  };
  const [erpnext, alisnad] = await Promise.all([
    side(Boolean(targets.erpnext), () => searchErpnext(targets.erpnext!, q, currency)),
    side(Boolean(targets.alisnad), () => searchAlisnad(targets.alisnad!, q)),
  ]);

  const codes = [...new Set([...erpnext.items, ...alisnad.items].map((i) => i.code))];
  const owners: LinkSearch["owners"] = {};
  if (codes.length) {
    const supabase = await createClient();
    const { data: links } = await supabase.from("device_link_codes").select("code, device_id").in("code", codes);
    const ids = [...new Set((links ?? []).map((l) => l.device_id))];
    const { data: devices } = ids.length ? await supabase.from("devices").select("id, name").in("id", ids) : { data: [] };
    const nameOf = new Map((devices ?? []).map((d) => [d.id, d.name]));
    for (const l of links ?? []) owners[l.code] = { id: l.device_id, name: nameOf.get(l.device_id) ?? "" };
  }
  return ok({ erpnext, alisnad, owners });
}

export type LinkPreview = {
  /** Per system: configured, lookup failed, and what each code matched. */
  alisnad: { configured: boolean; error?: boolean; matches: Record<string, RemoteItem> };
  erpnext: { configured: boolean; error?: boolean; matches: Record<string, RemoteItem> };
};

/**
 * What a device's link codes point to on alisnad.iq and in ERPNext (device form
 * preview), so staff can confirm the links before saving. A code already used by
 * another device is refused on save by the primary key of device_link_codes.
 */
export async function previewLinkCodesAction(codes: string[]): Promise<ActionResult<LinkPreview>> {
  const auth = await authorizeAction(["devices.update", "financials.read"], { write: false });
  if ("error" in auth) return auth.error;
  const clean = [...new Set(codes.map((c) => c.trim()).filter(Boolean))].slice(0, 50);
  if (clean.some((c) => c.length > 140)) return fail("validation.tooLong");

  const targets = getSyncTargets();
  const currency = auth.session.settings.currencyCode;
  const side = async (configured: boolean, run: () => Promise<Map<string, RemoteItem>>) => {
    if (!configured) return { configured: false, matches: {} };
    try {
      return { configured: true, matches: Object.fromEntries(await run()) };
    } catch {
      return { configured: true, error: true, matches: {} };
    }
  };
  const [alisnad, erpnext] = await Promise.all([
    side(Boolean(targets.alisnad), () => lookupAlisnad(targets.alisnad!, clean)),
    side(Boolean(targets.erpnext), () => lookupErpnext(targets.erpnext!, clean, currency)),
  ]);
  return ok({ alisnad, erpnext });
}

/** Every device matching the filters, for "select all" across pages (up to 2,000). */
export async function selectAllDevicesAction(filters: DeviceFilters): Promise<ActionResult<{ rows: SelectedDevice[]; truncated: boolean }>> {
  const auth = await authorizeAction(["devices.read_all", "financials.read"], { write: false });
  if ("error" in auth) return auth.error;
  const parsed = deviceFiltersSchema.safeParse(filters ?? {});
  if (!parsed.success) return fail("errors.invalidFormat");
  const supabase = await createClient();
  try {
    const { rows, truncated } = await fetchAllDevices({ supabase, projection: "full", filters: parsed.data, timezone: auth.session.settings.timezone }, 2000);
    return ok({ rows: rows.map((r) => ({ id: r.id, name: r.name, brandId: r.brandId, status: r.status })), truncated });
  } catch (e) {
    return fail(toUserMessage(e));
  }
}
