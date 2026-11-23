"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth/guard";
import type { SessionContext } from "@/lib/auth/session";
import { fail, ok, toUserMessage, type ActionResult } from "@/lib/errors";
import { classifyDevice, type DeviceCategory, type SkipReason } from "@/lib/price-sync/classify";
import { fetchErpDevices } from "@/lib/price-sync/erpnext";
import { refreshSyncState } from "@/lib/price-sync/state";
import { chunk, getSyncTargets } from "@/lib/price-sync/targets";
import { createClient } from "@/lib/supabase/server";

/**
 * One ERPNext device Item and what importing it would do:
 *   new            → a new device (pending review) with this brand, category and purchase price
 *   link           → an existing device with exactly this name gets linked to the item
 *   up_to_date     → already linked, purchase prices agree
 *   price_differs  → already linked, ERPNext's purchase price differs (can be taken over)
 *   skip           → not a phone or tablet (gift, accessory, watch…), or disabled in ERPNext
 *   unknown        → the name gives no known brand: add it by hand
 *   brand_missing  → the brand is not (or no longer) active in this app
 */
export type ImportRow = {
  code: string;
  name: string;
  kind: "new" | "link" | "up_to_date" | "price_differs" | "skip" | "unknown" | "brand_missing";
  brand?: string;
  category?: DeviceCategory;
  /** ERPNext purchase price, rounded to the company currency; null = none set. */
  purchase: number | null;
  /** The exact ERPNext rate when rounding changed it. */
  erpRate?: number;
  reason?: SkipReason | "disabled";
  device?: { id: string; name: string; purchase: number | null };
};

export type ImportPlan = {
  rows: ImportRow[];
  groups: string[];
  buyingList: string;
  /** Only this company's Items are read. */
  company: string;
};

const round = (v: number, decimals: number) => Math.round((v + Number.EPSILON) * 10 ** decimals) / 10 ** decimals;

async function planImport(session: SessionContext): Promise<ImportPlan | { error: string }> {
  const target = getSyncTargets().erpnext;
  if (!target) return { error: "sync.erpNotConnected" };
  if (!target.buyingList) return { error: "import.noBuyingList" };
  const decimals = session.settings.currencyDecimals;

  const items = await fetchErpDevices(target);
  const supabase = await createClient();
  const [brands, categories, devices] = await Promise.all([
    supabase.from("brands").select("id, name, is_active"),
    supabase.from("categories").select("id, name, is_active"),
    supabase.from("devices").select("id, name"),
  ]);
  if (brands.error || categories.error || devices.error) throw brands.error ?? categories.error ?? devices.error;

  const links = new Map<string, string>();
  const linkedDevices = new Set<string>();
  for (const part of chunk(items.map((i) => i.code), 100)) {
    const { data, error } = await supabase.from("device_link_codes").select("code, device_id").in("code", part);
    if (error) throw error;
    for (const l of data ?? []) links.set(l.code, l.device_id);
  }
  {
    // Devices with any link code are never matched by name.
    const { data, error } = await supabase.from("device_link_codes").select("device_id");
    if (error) throw error;
    for (const l of data ?? []) linkedDevices.add(l.device_id);
  }
  const deviceById = new Map((devices.data ?? []).map((d) => [d.id, d]));
  const ids = [...new Set(links.values())];
  const purchaseOf = new Map<string, number>();
  for (const part of chunk(ids, 100)) {
    const { data } = await supabase.from("device_financials").select("device_id, official_purchase_price").in("device_id", part);
    for (const f of data ?? []) purchaseOf.set(f.device_id, Number(f.official_purchase_price));
  }
  const unlinkedByName = new Map<string, { id: string; name: string }>();
  for (const d of devices.data ?? []) {
    const key = d.name.trim().toLowerCase();
    if (!linkedDevices.has(d.id) && !unlinkedByName.has(key)) unlinkedByName.set(key, d);
  }
  const activeBrands = new Map((brands.data ?? []).filter((b) => b.is_active).map((b) => [b.name.toLowerCase(), b]));

  const rows: ImportRow[] = items.map((item) => {
    const purchase = item.rate !== null && item.rate > 0 ? round(item.rate, decimals) : null;
    const base: ImportRow = { code: item.code, name: item.name, kind: "new", purchase, ...(purchase !== null && purchase !== item.rate ? { erpRate: item.rate! } : {}) };
    const linkedTo = links.get(item.code);
    if (linkedTo) {
      const d = deviceById.get(linkedTo);
      const appPurchase = purchaseOf.get(linkedTo) ?? null;
      const device = { id: linkedTo, name: d?.name ?? "", purchase: appPurchase };
      // A linked device's price in the selling list may already be its published SELLING
      // price: only a buying-list price is ever offered as a new purchase price.
      if (item.source !== "buying") return { ...base, kind: "up_to_date", purchase: appPurchase, device };
      const same = purchase === null || (appPurchase !== null && round(appPurchase, decimals) === purchase);
      return { ...base, kind: same ? "up_to_date" : "price_differs", device };
    }
    if (item.disabled) return { ...base, kind: "skip", reason: "disabled" };
    const c = classifyDevice(item.name);
    if (c.kind === "skip") return { ...base, kind: "skip", reason: c.reason };
    if (c.kind === "unknown") return { ...base, kind: "unknown" };
    const named = unlinkedByName.get(item.name.toLowerCase());
    if (named) return { ...base, kind: "link", brand: c.brand, category: c.category, device: { ...named, purchase: null } };
    if (!activeBrands.has(c.brand.toLowerCase())) return { ...base, kind: "brand_missing", brand: c.brand, category: c.category };
    return { ...base, brand: c.brand, category: c.category };
  });
  return { rows, groups: target.itemGroups, buyingList: target.buyingList, company: target.company };
}

/** What "Import from ERPNext" would do — nothing is written. */
export async function previewErpImportAction(): Promise<ActionResult<ImportPlan>> {
  const auth = await authorizeAction(["devices.create", "financials.update"], { write: false });
  if ("error" in auth) return auth.error;
  try {
    const plan = await planImport(auth.session);
    if ("error" in plan) return fail(plan.error);
    return ok(plan);
  } catch (e) {
    console.error("ERPNext import preview failed", e instanceof Error ? e.message : e);
    return fail(toUserMessage(e, "import.loadFailed"));
  }
}

/**
 * Imports what the admin confirmed in the review: `create` = codes of new and
 * name-matched items, `updatePrices` = codes whose ERPNext purchase price should
 * replace the one here. ERPNext is read again on the server; nothing the
 * browser sends is trusted beyond the chosen codes.
 */
export async function runErpImportAction(input: { create: string[]; updatePrices: string[] }): Promise<
  ActionResult<{ created: number; linked: number; updated: number }>
> {
  const auth = await authorizeAction(["devices.create", "financials.update"]);
  if ("error" in auth) return auth.error;
  const create = new Set((input.create ?? []).slice(0, 2000));
  const update = new Set((input.updatePrices ?? []).slice(0, 2000));
  if (!create.size && !update.size) return fail("import.nothingChosen");

  let plan: ImportPlan;
  try {
    const result = await planImport(auth.session);
    if ("error" in result) return fail(result.error);
    plan = result;
  } catch (e) {
    return fail(toUserMessage(e, "import.loadFailed"));
  }

  const supabase = await createClient();
  const [brands, categories] = await Promise.all([
    supabase.from("brands").select("id, name").eq("is_active", true),
    supabase.from("categories").select("id, name").eq("is_active", true),
  ]);
  const brandId = new Map((brands.data ?? []).map((b) => [b.name.toLowerCase(), b.id]));
  const categoryId = new Map((categories.data ?? []).map((c) => [c.name.toLowerCase(), c.id]));

  type ImportItem = { code: string; name: string; brand_id?: string | null; category_id?: string | null; purchase: number | null; update_price?: boolean };
  const items = plan.rows.flatMap((r): ImportItem[] => {
    if ((r.kind === "new" || r.kind === "link") && create.has(r.code)) {
      return [
        {
          code: r.code,
          name: r.name,
          brand_id: r.brand ? (brandId.get(r.brand.toLowerCase()) ?? null) : null,
          category_id: r.category ? (categoryId.get(r.category.toLowerCase()) ?? null) : null,
          purchase: r.purchase,
        },
      ];
    }
    if (r.kind === "price_differs" && update.has(r.code) && r.purchase !== null) {
      return [{ code: r.code, name: r.name, purchase: r.purchase, update_price: true }];
    }
    return [];
  });
  if (!items.length) return fail("import.nothingChosen");

  let created = 0;
  let linked = 0;
  let updated = 0;
  const touched: string[] = [];
  for (const part of chunk(items, 200)) {
    const { data, error } = await supabase.rpc("import_erp_devices", { p_items: part });
    if (error) {
      if (error.code === "PGRST202" || error.code === "42883") return fail("sync.needsMigration");
      return fail(toUserMessage(error, "import.failed"));
    }
    for (const r of data ?? []) {
      if (r.result === "created") created++;
      if (r.result === "linked") linked++;
      if (r.result === "price_updated") updated++;
      if (r.result !== "exists") touched.push(r.device_id);
    }
  }
  // Show at once whether each device is in ERPNext / on alisnad.iq (small imports; larger
  // ones are checked from the list with "Check status", which keeps each request short).
  if (touched.length <= 40) await refreshSyncState(touched).catch(() => undefined);
  revalidatePath("/devices");
  revalidatePath("/dashboard");
  return ok({ created, linked, updated });
}
