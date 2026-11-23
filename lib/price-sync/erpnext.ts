import "server-only";

import {
  chunk,
  describeFailure,
  pool,
  requestInit,
  samePrice,
  searchTokens,
  summarise,
  toNumber,
  type ErpnextTarget,
  type Fetch,
  type ItemChange,
  type PriceChange,
  type RemoteItem,
  type TargetResult,
} from "./targets";

type ItemPrice = {
  name: string;
  item_code: string;
  item_name: string | null;
  price_list: string;
  price_list_rate: number | string;
  currency: string | null;
  customer?: string | null;
  supplier?: string | null;
};
type Item = { item_code: string; item_name: string | null; disabled?: number | boolean | null };

const ITEM_FIELDS = ["item_code", "item_name", "disabled"];
const PRICE_FIELDS = ["name", "item_code", "item_name", "price_list", "price_list_rate", "currency", "customer", "supplier"];

const headersFor = (target: ErpnextTarget) => ({
  Authorization: `token ${target.key}:${target.secret}`,
  Accept: "application/json",
  "Content-Type": "application/json",
});

/**
 * Items are only ever read for the configured company (its Item Defaults):
 * every Item request carries that filter, so codes of other companies sharing
 * the same ERPNext are invisible — never imported, linked, checked or priced.
 */
const scoped = (target: ErpnextTarget, doctype: string, filters: unknown[]) =>
  doctype === "Item" ? [...filters, ["Item Default", "company", "=", target.company]] : filters;

async function list<T>(target: ErpnextTarget, doctype: string, filters: unknown[], fields: string[], fetchImpl: Fetch, limit = 500): Promise<T[]> {
  const res = await fetchImpl(
    `${target.url}/api/resource/${encodeURIComponent(doctype)}?filters=${encodeURIComponent(JSON.stringify(scoped(target, doctype, filters)))}&fields=${encodeURIComponent(JSON.stringify(fields))}&limit_page_length=${limit}`,
    requestInit({ headers: headersFor(target) }),
  );
  if (!res.ok) throw new Error(await describeFailure("ERPNext", `${doctype} read`, res));
  return ((await res.json()) as { data?: T[] }).data ?? [];
}

/** An `in` filter split over several short requests (item codes can be long). */
async function listIn<T>(target: ErpnextTarget, doctype: string, field: string, values: string[], extra: unknown[], fields: string[], fetchImpl: Fetch) {
  const parts = await pool(chunk(values, 40), 3, (part) => list<T>(target, doctype, [[field, "in", part], ...extra], fields, fetchImpl));
  return parts.flat();
}

const readItems = (target: ErpnextTarget, codes: string[], fetchImpl: Fetch) => listIn<Item>(target, "Item", "item_code", codes, [], ITEM_FIELDS, fetchImpl);

/** Item Price rows of these items in the selling and (if configured) buying price lists. */
const readPriceRows = async (target: ErpnextTarget, codes: string[], fetchImpl: Fetch): Promise<ItemPrice[]> => {
  const lists = [target.sellingList, target.buyingList].filter((l): l is string => Boolean(l));
  if (!lists.length) return [];
  return listIn<ItemPrice>(target, "Item Price", "item_code", codes, [["price_list", "in", lists]], PRICE_FIELDS, fetchImpl);
};

/** General prices only: customer- and supplier-specific prices are left alone. */
const sellingRows = (target: ErpnextTarget, rows: ItemPrice[], code: string) =>
  target.sellingList ? rows.filter((r) => r.item_code === code && r.price_list === target.sellingList && !r.customer) : [];
const buyingRows = (target: ErpnextTarget, rows: ItemPrice[], code: string) =>
  target.buyingList ? rows.filter((r) => r.item_code === code && r.price_list === target.buyingList && !r.supplier && !r.customer) : [];

/** One price when every row agrees; null when there is none or they disagree. */
const uniform = (rows: ItemPrice[]) => {
  const first = toNumber(rows[0]?.price_list_rate);
  return first !== null && rows.every((r) => samePrice(r.price_list_rate, first)) ? first : null;
};

const listCurrencies = new Map<string, { currency: string | null; at: number }>();
/** Clears cached price-list currencies (tests). */
export const clearErpnextCache = () => listCurrencies.clear();

async function listCurrency(target: ErpnextTarget, name: string, fetchImpl: Fetch) {
  const key = `${target.url}|${name}`;
  const cached = listCurrencies.get(key);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.currency;
  const res = await fetchImpl(`${target.url}/api/resource/Price%20List/${encodeURIComponent(name)}`, requestInit({ headers: headersFor(target) }));
  if (!res.ok) throw new Error(await describeFailure("ERPNext", "price list read", res));
  const currency = ((await res.json()) as { data?: { currency?: string | null } }).data?.currency ?? null;
  listCurrencies.set(key, { currency, at: Date.now() });
  return currency;
}

function foreignCurrency(rows: ItemPrice[], currency: string) {
  const foreign = rows.find((p) => p.currency && p.currency !== currency);
  return foreign ? `ERPNext price list "${foreign.price_list}" is in ${foreign.currency}, not ${currency}.` : null;
}

/**
 * Every link code that is an ERPNext Item gets the selling price in the
 * selling price list and the purchase price in the buying price list (each
 * only when that list is configured): existing general prices are updated, a
 * missing one is added. Codes that are not Items are reported, never created.
 */
export async function pushErpnextPrice(
  target: ErpnextTarget,
  codes: string[],
  prices: { selling: number; buying: number | null },
  currency: string,
  fetchImpl: Fetch = fetch,
): Promise<TargetResult> {
  const headers = headersFor(target);
  const changes: ItemChange[] = [];
  try {
    if (!codes.length) return { status: "not_found", missing: [] };
    const [items, rows] = await Promise.all([readItems(target, codes, fetchImpl), readPriceRows(target, codes, fetchImpl)]);
    const mismatch = foreignCurrency(rows, currency);
    if (mismatch) return { status: "error", error: mismatch };
    const known = new Set(items.map((i) => i.item_code));
    const missing = codes.filter((c) => !known.has(c));

    type Write = { method: "PUT" | "POST"; path: string; body: Record<string, unknown> };
    const writes: Write[] = [];
    const plan = (existing: ItemPrice[], list: string, code: string, price: number): PriceChange => {
      if (!existing.length) {
        writes.push({ method: "POST", path: "/api/resource/Item%20Price", body: { item_code: code, price_list: list, price_list_rate: price } });
        return { old: null, new: price, action: "created" };
      }
      const stale = existing.filter((r) => !samePrice(r.price_list_rate, price));
      for (const r of stale) writes.push({ method: "PUT", path: `/api/resource/Item%20Price/${encodeURIComponent(r.name)}`, body: { price_list_rate: price } });
      return { old: toNumber((stale[0] ?? existing[0]).price_list_rate), new: price, action: stale.length ? "updated" : "unchanged" };
    };

    for (const item of items) {
      if (changes.some((c) => c.code === item.item_code)) continue;
      const change: ItemChange = { code: item.item_code, name: item.item_name ?? undefined };
      if (target.sellingList) change.selling = plan(sellingRows(target, rows, item.item_code), target.sellingList, item.item_code, prices.selling);
      if (target.buyingList && prices.buying !== null) change.buying = plan(buyingRows(target, rows, item.item_code), target.buyingList, item.item_code, prices.buying);
      changes.push(change);
    }

    // A price added to a list takes that list's currency: make sure it is ours.
    for (const list of new Set(writes.filter((w) => w.method === "POST").map((w) => String(w.body.price_list)))) {
      const listCurrencyCode = await listCurrency(target, list, fetchImpl);
      if (listCurrencyCode && listCurrencyCode !== currency) {
        return { status: "error", error: `ERPNext price list "${list}" is in ${listCurrencyCode}, not ${currency}.` };
      }
    }

    const failures = await pool(writes, 3, async (w) => {
      const res = await fetchImpl(`${target.url}${w.path}`, requestInit({ method: w.method, headers, body: JSON.stringify(w.body) }));
      return res.ok ? null : await describeFailure("ERPNext", w.method === "POST" ? "create price" : "update", res);
    });
    const failure = failures.find(Boolean);
    if (failure) return { status: "error", error: failure, items: changes };
    return summarise(changes, missing);
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : String(error), items: changes };
  }
}

/** What ERPNext holds for each code: Item name, enabled flag, selling and buying price (codes that are not Items are absent). */
export async function lookupErpnext(target: ErpnextTarget, codes: string[], currency: string, fetchImpl: Fetch = fetch) {
  const [items, rows] = await Promise.all([readItems(target, codes, fetchImpl), readPriceRows(target, codes, fetchImpl)]);
  const mismatch = foreignCurrency(rows, currency);
  if (mismatch) throw new Error(mismatch);
  const out = new Map<string, RemoteItem>();
  for (const i of items) {
    out.set(i.item_code, {
      code: i.item_code,
      name: i.item_name ?? i.item_code,
      active: !i.disabled,
      selling: target.sellingList ? uniform(sellingRows(target, rows, i.item_code)) : null,
      ...(target.buyingList ? { buying: uniform(buyingRows(target, rows, i.item_code)) } : {}),
    });
  }
  return out;
}

/** Items whose name contains every word of the query, or whose code contains it (link search). */
export async function searchErpnext(target: ErpnextTarget, query: string, currency: string, fetchImpl: Fetch = fetch, limit = 12) {
  const tokens = searchTokens(query);
  if (!tokens.length) return [];
  const [byName, byCode] = await Promise.all([
    list<Item>(target, "Item", tokens.map((t) => ["item_name", "like", `%${t}%`]), ITEM_FIELDS, fetchImpl, limit),
    list<Item>(target, "Item", [["item_code", "like", `%${tokens.join(" ")}%`]], ITEM_FIELDS, fetchImpl, limit),
  ]);
  const codes = [...new Set([...byCode, ...byName].map((i) => i.item_code))].slice(0, limit);
  const found = await lookupErpnext(target, codes, currency, fetchImpl);
  return codes.map((c) => found.get(c)).filter((i): i is RemoteItem => Boolean(i));
}

/** Items whose name or code is exactly one of `names` (ERPNext compares without letter case) — automatic linking. */
export async function findErpnextByNames(target: ErpnextTarget, names: string[], fetchImpl: Fetch = fetch) {
  const [byName, byCode] = await Promise.all([
    listIn<Item>(target, "Item", "item_name", names, [], ITEM_FIELDS, fetchImpl),
    listIn<Item>(target, "Item", "item_code", names, [], ITEM_FIELDS, fetchImpl),
  ]);
  const seen = new Map<string, Item>();
  for (const i of [...byCode, ...byName]) seen.set(i.item_code, i);
  return [...seen.values()].map((i) => ({ code: i.item_code, name: i.item_name ?? i.item_code, active: !i.disabled }));
}

/** Every row of a doctype matching the filters (paged, 500 at a time). */
async function listAll<T>(target: ErpnextTarget, doctype: string, filters: unknown[], fields: string[], fetchImpl: Fetch): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; start < 20_000; start += 500) {
    const res = await fetchImpl(
      `${target.url}/api/resource/${encodeURIComponent(doctype)}?filters=${encodeURIComponent(JSON.stringify(scoped(target, doctype, filters)))}&fields=${encodeURIComponent(JSON.stringify(fields))}&order_by=${encodeURIComponent("`tab" + doctype + "`.name asc")}&limit_start=${start}&limit_page_length=500`,
      requestInit({ headers: headersFor(target) }),
    );
    if (!res.ok) throw new Error(await describeFailure("ERPNext", `${doctype} read`, res));
    const page = ((await res.json()) as { data?: T[] }).data ?? [];
    out.push(...page);
    if (page.length < 500) break;
  }
  return out;
}

export type ErpDevice = {
  code: string;
  name: string;
  group: string;
  disabled: boolean;
  /** Purchase price: the general price in the buying list, else (never published yet) the one in the selling list. */
  rate: number | null;
  /** Where `rate` came from. "selling" = the price typed in when the Item was created, before any publish. */
  source: "buying" | "selling" | null;
  currency: string | null;
};

/**
 * The device Items of the company (item groups ERPNEXT_ITEM_GROUPS) with
 * their purchase price — what "Import from ERPNext" reads. Items are created
 * in ERPNext with their purchase price in the selling list (الاسناد); after
 * the first Publish that list holds the selling price and the purchase price
 * lives in the buying list, which therefore always wins.
 */
export async function fetchErpDevices(target: ErpnextTarget, fetchImpl: Fetch = fetch): Promise<ErpDevice[]> {
  if (!target.buyingList && !target.sellingList) throw new Error("No ERPNext price list is configured (ERPNEXT_BUYING_PRICE_LIST).");
  if (!target.itemGroups.length) return [];
  const items = await listAll<Item & { item_group: string }>(
    target,
    "Item",
    [["item_group", "in", target.itemGroups]],
    ["item_code", "item_name", "item_group", "disabled"],
    fetchImpl,
  );
  const rows = await readPriceRows(target, items.map((i) => i.item_code), fetchImpl);
  const priceOf = (own: ItemPrice[]) => uniform(own) ?? (own.length ? toNumber(own[0].price_list_rate) : null);
  return items.map((i) => {
    const buying = buyingRows(target, rows, i.item_code);
    const selling = sellingRows(target, rows, i.item_code);
    const own = buying.length ? buying : selling;
    return {
      code: i.item_code,
      name: (i.item_name ?? i.item_code).trim(),
      group: i.item_group,
      disabled: Boolean(i.disabled),
      rate: priceOf(own),
      source: buying.length ? "buying" : selling.length ? "selling" : null,
      currency: own[0]?.currency ?? null,
    };
  });
}
