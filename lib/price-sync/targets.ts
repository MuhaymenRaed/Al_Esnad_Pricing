import "server-only";

/**
 * Where prices are published. Each target is configured with server-only
 * environment variables and is simply skipped when they are missing.
 */
export type AlisnadTarget = { url: string; key: string };
export type ErpnextTarget = {
  url: string;
  key: string;
  secret: string;
  /** Selling price list (ERPNEXT_SELLING_PRICE_LIST) — gets the final selling price; null = not sent. */
  sellingList: string | null;
  /** Buying price list (ERPNEXT_BUYING_PRICE_LIST) — source of purchase prices for imports, gets the purchase price; null = not used. */
  buyingList: string | null;
  /** Item groups whose Items are devices (ERPNEXT_ITEM_GROUPS, comma separated). */
  itemGroups: string[];
  /** The only company whose Items are read or priced (ERPNEXT_COMPANY). */
  company: string;
};

export function getSyncTargets(): { alisnad: AlisnadTarget | null; erpnext: ErpnextTarget | null } {
  const env = (name: string) => process.env[name]?.trim() || undefined;
  const list = (name: string, fallback: string) => {
    const value = env(name) ?? fallback;
    return /^(none|off|-)$/i.test(value) ? null : value;
  };
  const aUrl = env("ALISNAD_SUPABASE_URL");
  const aKey = env("ALISNAD_SUPABASE_SERVICE_ROLE_KEY");
  const eUrl = env("ERPNEXT_URL");
  const eKey = env("ERPNEXT_API_KEY");
  const eSecret = env("ERPNEXT_API_SECRET");
  const buyingList = list("ERPNEXT_BUYING_PRICE_LIST", "Standard Buying");
  // ERPNext holds one general price per item and list: a list that keeps the purchase
  // prices is never overwritten with selling prices.
  const selling = list("ERPNEXT_SELLING_PRICE_LIST", "Standard Selling");
  const sellingList = selling && selling !== buyingList ? selling : null;
  const itemGroups = (env("ERPNEXT_ITEM_GROUPS") ?? "الأجهزة").split(",").map((g) => g.trim()).filter(Boolean);
  // ERPNext is shared with other companies: without a company it is not used at all.
  const company = list("ERPNEXT_COMPANY", "الاسناد");
  return {
    alisnad: aUrl && aKey ? { url: aUrl.replace(/\/+$/, ""), key: aKey } : null,
    erpnext:
      eUrl && eKey && eSecret && company
        ? { url: eUrl.replace(/\/+$/, ""), key: eKey, secret: eSecret, sellingList, buyingList, itemGroups, company }
        : null,
  };
}

/** Which systems are connected and which ERPNext price lists are used, for screens (no secrets). */
export function syncConfig() {
  const { alisnad, erpnext } = getSyncTargets();
  return {
    alisnad: Boolean(alisnad),
    erpnext: Boolean(erpnext),
    erpSelling: erpnext?.sellingList ?? null,
    erpBuying: erpnext?.buyingList ?? null,
    erpCompany: erpnext?.company ?? null,
  };
}
export type SyncConfig = ReturnType<typeof syncConfig>;

export type PriceAction = "updated" | "created" | "unchanged";
export type PriceChange = { old: number | null; new: number; action: PriceAction };

/**
 * One matched item (alisnad.iq product or ERPNext Item) and what happened to
 * its prices: `selling` is the final selling price, `buying` the purchase
 * price (ERPNext only, when a buying price list is configured).
 */
export type ItemChange = { code: string; name?: string; selling?: PriceChange; buying?: PriceChange };

/**
 * Outcome of pushing a device's prices to one system for all of its link codes
 * (stored in price_sync_jobs.results). `missing` lists codes that system does
 * not have — normal, since a code usually belongs to just one of the systems.
 */
export type TargetResult =
  | { status: "updated"; items: ItemChange[]; missing: string[] }
  | { status: "unchanged"; items: ItemChange[]; missing: string[] }
  | { status: "not_found"; missing: string[] }
  | { status: "skipped"; reason: "not_configured" }
  | { status: "error"; error: string; items?: ItemChange[] };

export const isChanged = (i: ItemChange) => Boolean((i.selling && i.selling.action !== "unchanged") || (i.buying && i.buying.action !== "unchanged"));

/** Summarise item changes into a TargetResult. */
export function summarise(items: ItemChange[], missing: string[]): TargetResult {
  if (!items.length) return { status: "not_found", missing };
  return { status: items.some(isChanged) ? "updated" : "unchanged", items, missing };
}

/** What a system holds for one link code (status checks, badges). */
export type RemoteItem = { code: string; name: string | null; active: boolean; selling: number | null; buying?: number | null };

/** PostgREST `in` list with every value double-quoted (codes contain spaces, "+", commas…). */
export const postgrestIn = (values: string[]) => `in.(${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")})`;

export type Fetch = typeof fetch;

const TIMEOUT_MS = 12_000;
export const requestInit = (init: RequestInit = {}): RequestInit => ({ ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });

/** A short, secret-free description of a failed HTTP response. */
export async function describeFailure(system: string, action: string, res: Response) {
  const body = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 240);
  return `${system} ${action} failed (HTTP ${res.status})${body ? `: ${body}` : ""}`;
}

export const samePrice = (a: unknown, b: number) => a !== null && a !== undefined && a !== "" && Math.abs(Number(a) - b) < 0.005;
export const toNumber = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

/** Splits a list so request URLs stay short (codes can be long). */
export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Runs tasks with at most `limit` in flight; results keep the input order. */
export async function pool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Search words: trimmed, de-duplicated, without characters that break filter syntax. */
export function searchTokens(query: string, max = 6) {
  return [
    ...new Set(
      query
        .replace(/["\\(),*%]/g, " ")
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ].slice(0, max);
}

/** Names compared for automatic linking: letter case and spacing are ignored, nothing else. */
export const normaliseName = (name: string) => name.toLowerCase().replace(/[\s\u00a0]+/g, " ").trim();
