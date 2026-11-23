import "server-only";

import {
  chunk,
  describeFailure,
  postgrestIn,
  requestInit,
  samePrice,
  searchTokens,
  summarise,
  toNumber,
  type AlisnadTarget,
  type Fetch,
  type ItemChange,
  type RemoteItem,
  type TargetResult,
} from "./targets";

type ProductRow = {
  id: string;
  name_en: string | null;
  name_ar?: string | null;
  base_price: number | string | null;
  erp_item_code: string;
  sku?: string | null;
  is_active?: boolean | null;
};

const FIELDS = "id,name_en,name_ar,sku,base_price,erp_item_code,is_active";
const headersFor = (target: AlisnadTarget) => ({ apikey: target.key, Authorization: `Bearer ${target.key}`, Accept: "application/json" });
const filterFor = (codes: string[]) => `erp_item_code=${encodeURIComponent(postgrestIn(codes))}&is_deleted=is.false`;

async function getProducts(target: AlisnadTarget, query: string, fetchImpl: Fetch) {
  const res = await fetchImpl(`${target.url}/rest/v1/products?select=${FIELDS}&${query}`, requestInit({ headers: headersFor(target) }));
  if (!res.ok) throw new Error(await describeFailure("alisnad.iq", "read", res));
  return (await res.json()) as ProductRow[];
}

/**
 * alisnad.iq keeps one product per storage option with a code in
 * products.erp_item_code, and checkout charges products.base_price (variants
 * carry no price of their own; offers and price bands apply on top). So a
 * selling price goes to base_price of every non-deleted product whose code is
 * one of the device's link codes.
 */
export async function readAlisnadProducts(target: AlisnadTarget, codes: string[], fetchImpl: Fetch = fetch) {
  const rows: ProductRow[] = [];
  for (const part of chunk(codes, 40)) rows.push(...(await getProducts(target, filterFor(part), fetchImpl)));
  return rows;
}

const toItem = (r: ProductRow): RemoteItem => ({
  code: r.erp_item_code,
  name: r.name_en ?? r.name_ar ?? null,
  active: r.is_active !== false,
  selling: toNumber(r.base_price),
});

/** What alisnad.iq holds for each code (codes it lacks are absent). */
export async function lookupAlisnad(target: AlisnadTarget, codes: string[], fetchImpl: Fetch = fetch) {
  const rows = await readAlisnadProducts(target, codes, fetchImpl);
  return new Map(rows.map((r) => [r.erp_item_code, toItem(r)]));
}

export async function pushAlisnadPrice(target: AlisnadTarget, codes: string[], price: number, fetchImpl: Fetch = fetch): Promise<TargetResult> {
  try {
    const rows = await readAlisnadProducts(target, codes, fetchImpl);
    const found = new Set(rows.map((r) => r.erp_item_code));
    const missing = codes.filter((c) => !found.has(c));
    const stale = rows.filter((r) => !samePrice(r.base_price, price));

    const items: ItemChange[] = rows
      .filter((r) => samePrice(r.base_price, price))
      .map((r) => ({ code: r.erp_item_code, name: r.name_en ?? undefined, selling: { old: price, new: price, action: "unchanged" } }));

    for (const part of chunk([...new Set(stale.map((r) => r.erp_item_code))], 40)) {
      const res = await fetchImpl(
        `${target.url}/rest/v1/products?${filterFor(part)}`,
        requestInit({
          method: "PATCH",
          headers: { ...headersFor(target), "Content-Type": "application/json", Prefer: "return=representation" },
          body: JSON.stringify({ base_price: price }),
        }),
      );
      if (!res.ok) return { status: "error", error: await describeFailure("alisnad.iq", "update", res), items };
      const updated = (await res.json()) as ProductRow[];
      const expected = stale.filter((r) => part.includes(r.erp_item_code));
      if (updated.length !== expected.length || !updated.every((r) => samePrice(r.base_price, price))) {
        return { status: "error", error: "alisnad.iq did not confirm the new price.", items };
      }
      for (const r of expected) {
        items.push({ code: r.erp_item_code, name: r.name_en ?? undefined, selling: { old: toNumber(r.base_price), new: price, action: "updated" } });
      }
    }
    return summarise(items, missing);
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Products whose English or Arabic name, SKU or code contains every word of
 * the query (link search in the device form). Only products with a code can
 * be linked, so the others are left out.
 */
export async function searchAlisnad(target: AlisnadTarget, query: string, fetchImpl: Fetch = fetch, limit = 12) {
  const tokens = searchTokens(query);
  if (!tokens.length) return [];
  const clause = (t: string) => {
    const v = `"*${t}*"`;
    return `or(name_en.ilike.${v},name_ar.ilike.${v},sku.ilike.${v},erp_item_code.ilike.${v})`;
  };
  const tree = encodeURIComponent(`(${tokens.map(clause).join(",")})`);
  const rows = await getProducts(target, `and=${tree}&erp_item_code=not.is.null&is_deleted=is.false&order=is_active.desc,name_en.asc&limit=${limit}`, fetchImpl);
  return rows.map(toItem);
}

/** Products named exactly like one of `names` (English or Arabic name, or SKU) — automatic linking. */
export async function findAlisnadByNames(target: AlisnadTarget, names: string[], fetchImpl: Fetch = fetch) {
  const rows: ProductRow[] = [];
  for (const part of chunk(names, 25)) {
    const list = postgrestIn(part);
    const tree = encodeURIComponent(`(name_en.${list},name_ar.${list},sku.${list})`);
    rows.push(...(await getProducts(target, `or=${tree}&erp_item_code=not.is.null&is_deleted=is.false`, fetchImpl)));
  }
  return rows.map((r) => ({ ...toItem(r), names: [r.name_en, r.name_ar, r.sku].filter((n): n is string => Boolean(n)) }));
}
