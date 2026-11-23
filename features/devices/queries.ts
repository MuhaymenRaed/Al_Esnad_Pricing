import "server-only";

import type { SessionContext } from "@/lib/auth/session";
import type { DeviceFilters, SortKey } from "@/lib/filters/devices";
import { sanitizeFilters, toRpcFilters } from "@/lib/filters/devices";
import { caps, type DataProjection } from "@/lib/permissions";
import { brandColor } from "@/lib/brand-colors";
import { loadSyncRows } from "@/lib/price-sync/state";
import { syncConfig } from "@/lib/price-sync/targets";
import { createClient, type ServerSupabase } from "@/lib/supabase/server";
import type {
  CatalogSearchRow,
  DeviceFinancialsRow,
  DeviceRow,
  FullDeviceSearchRow,
  Json,
  SubmissionRow,
} from "@/types/database";
import { deriveDeviceSync, type DeviceSync, type SyncCompare } from "./sync-state";
import type { DevicePage, DeviceListRow, DeviceSummary, Option } from "./types";

const num = (v: number | string | null | undefined) => (v === null || v === undefined ? null : String(v));

function base(r: {
  id: string;
  name: string;
  brand_id: string;
  brand_name: string;
  brand_color: string | null;
  category_id: string | null;
  category_name: string | null;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: r.id,
    name: r.name,
    brandId: r.brand_id,
    brandName: r.brand_name,
    brandColor: brandColor(r.brand_color, r.brand_name),
    categoryId: r.category_id,
    categoryName: r.category_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function fromFull(r: FullDeviceSearchRow): DeviceListRow {
  return {
    ...base(r),
    status: r.status,
    sku: r.sku,
    modelNumber: r.model_number,
    purchasePrice: num(r.official_purchase_price),
    discountType: r.discount_type,
    discountValue: num(r.discount_value),
    discountAmount: num(r.discount_amount),
    paybackAmount: num(r.payback_amount),
    finalCost: num(r.final_cost_before_profit),
    profit: num(r.company_profit),
    sellingPrice: num(r.final_selling_price),
    sortValue: r.sort_value,
  };
}

/** Viewer projection: the row type physically has no private fields. */
function fromCatalog(r: CatalogSearchRow): DeviceListRow {
  return { ...base(r), sellingPrice: num(r.final_selling_price), sortValue: r.sort_value };
}

/** Data Entry projection: no financial fields at all (as in the baseline design). */
function fromSubmission(r: SubmissionRow): DeviceListRow {
  return { ...base(r), status: r.status, sku: r.sku, modelNumber: r.model_number };
}

export function encodeCursor(row: DeviceListRow | undefined, offset?: number) {
  if (offset !== undefined) return Buffer.from(JSON.stringify({ o: offset })).toString("base64url");
  if (!row?.sortValue) return null;
  return Buffer.from(JSON.stringify({ v: row.sortValue, id: row.id })).toString("base64url");
}

export function decodeCursor(cursor: string | null | undefined): { v?: string; id?: string; o?: number } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    /* invalid cursor → start from the beginning */
  }
  return null;
}

/**
 * Resolves which projection a request may use. The requested view can only
 * narrow access; it is always checked against the user's REAL permissions.
 */
export function resolveProjection(session: SessionContext, requested: string | null): DataProjection | null {
  const p = session.permissions;
  if (requested === "full") return caps.readFull(p) ? "full" : null;
  if (requested === "catalog") return caps.readCatalog(p) ? "catalog" : null;
  if (requested === "submissions") {
    // Data Entry preview: my_submissions only ever returns the caller's own rows.
    return caps.readSubmissions(p) || session.previewRole === "data_entry" ? "submissions" : null;
  }
  return session.projection;
}

type PageArgs = {
  supabase: ServerSupabase;
  projection: DataProjection;
  filters: DeviceFilters;
  timezone: string;
  ids?: string[];
  cursor?: string | null;
  limit: number;
  now?: Date;
  /** Full projection: add each row's publishing status on ERPNext / alisnad.iq. */
  withSync?: boolean;
  /** Company currency decimals (price comparison for the publishing status). */
  decimals?: number;
};

export async function fetchDevicePage({
  supabase,
  projection,
  filters,
  timezone,
  ids,
  cursor,
  limit,
  now,
  withSync,
  decimals = 0,
}: PageArgs): Promise<DevicePage> {
  const clean = sanitizeFilters(filters, projection);
  const decoded = decodeCursor(cursor);

  if (projection === "submissions") {
    const offset = decoded?.o ?? 0;
    const { data, error } = await supabase.rpc("my_submissions", {
      p_search: clean.q ?? null,
      p_status: clean.statuses?.length === 1 ? clean.statuses[0] : null,
      p_limit: limit,
      p_offset: offset,
    });
    // A previewing manager has no submissions of their own: show an empty list.
    if (error?.code === "42501") return { rows: [], total: 0, nextCursor: null };
    if (error) throw error;
    let rows = (data ?? []).map(fromSubmission);
    if (ids) rows = rows.filter((r) => ids.includes(r.id));
    return {
      rows,
      total: offset === 0 ? (data?.[0]?.total_count ?? 0) : null,
      nextCursor: (data?.length ?? 0) === limit ? encodeCursor(undefined, offset + limit) : null,
    };
  }

  const sort: SortKey = clean.sort ?? "name_asc";
  const args = {
    p_filters: toRpcFilters(clean, timezone, ids ? { ids } : {}, now) as Json,
    p_sort: sort,
    p_cursor: decoded?.id ? ({ v: decoded.v ?? "", id: decoded.id } as Json) : null,
    p_limit: limit,
  };

  if (projection === "full") {
    const { data, error } = await supabase.rpc("search_devices", args);
    if (error) throw error;
    const rows = (data ?? []).map(fromFull);
    if (withSync) await attachSync(supabase, rows, decimals);
    return {
      rows,
      total: decoded ? null : (data?.[0]?.total_count ?? 0),
      nextCursor: rows.length === limit ? encodeCursor(rows[rows.length - 1]) : null,
    };
  }

  const { data, error } = await supabase.rpc("search_catalog", args);
  if (error) throw error;
  const rows = (data ?? []).map(fromCatalog);
  return {
    rows,
    total: decoded ? null : (data?.[0]?.total_count ?? 0),
    nextCursor: rows.length === limit ? encodeCursor(rows[rows.length - 1]) : null,
  };
}

export async function fetchDeviceSummary(
  supabase: ServerSupabase,
  projection: DataProjection,
  filters: DeviceFilters,
  timezone: string,
  ids?: string[],
): Promise<DeviceSummary | undefined> {
  if (projection === "submissions") return undefined;
  const clean = sanitizeFilters(filters, projection);
  const p_filters = toRpcFilters(clean, timezone, ids ? { ids } : {}) as Json;
  const { data, error } =
    projection === "full"
      ? await supabase.rpc("device_summary", { p_filters })
      : await supabase.rpc("catalog_summary", { p_filters });
  if (error) throw error;
  const summary = data as unknown as DeviceSummary;
  summary.brands = summary.brands.map((b) => ({ ...b, color: brandColor(b.color ?? null, b.label) }));
  return summary;
}

/**
 * Retrieves the COMPLETE authorised result set for exports by walking the
 * cursor server-side — independent of what the browser loaded or scrolled to.
 */
export async function fetchAllDevices(args: Omit<PageArgs, "cursor" | "limit">, maxRows = 10_000) {
  const rows: DeviceListRow[] = [];
  let cursor: string | null = null;
  let truncated = false;
  do {
    const page: DevicePage = await fetchDevicePage({ ...args, cursor, limit: 1000 });
    rows.push(...page.rows);
    cursor = page.nextCursor;
    if (rows.length >= maxRows && cursor) {
      truncated = true;
      break;
    }
  } while (cursor);
  return { rows, truncated };
}

export async function fetchLookups(options: { includeInactive?: boolean } = {}) {
  const supabase = await createClient();
  let brands = supabase.from("brands").select("id, name, accent_color, is_active").order("sort_order").order("name");
  let categories = supabase.from("categories").select("id, name, is_active").order("name");
  if (!options.includeInactive) {
    brands = brands.eq("is_active", true);
    categories = categories.eq("is_active", true);
  }
  const [b, c] = await Promise.all([brands, categories]);
  if (b.error) throw b.error;
  if (c.error) throw c.error;
  return {
    brands: (b.data ?? []).map<Option>((x) => ({
      id: x.id,
      name: x.name,
      color: brandColor(x.accent_color, x.name),
      isActive: x.is_active,
    })),
    categories: (c.data ?? []).map<Option>((x) => ({ id: x.id, name: x.name, isActive: x.is_active })),
  };
}

export type ManagedDevice = {
  device: DeviceRow;
  brand: { id: string; name: string; accent_color: string | null; is_active: boolean };
  category: { id: string; name: string } | null;
  financials: DeviceFinancialsRow | null;
  /** Price-sync link codes (missing before the link-codes migration runs). */
  link_codes?: string[];
  created_by_name: string | null;
  updated_by_name: string | null;
  history: Array<{
    id: string;
    action: string;
    table_name: string;
    created_at: string;
    old_data: Record<string, unknown> | null;
    new_data: Record<string, unknown> | null;
    actor: string | null;
  }> | null;
};

export async function fetchManagedDevice(id: string): Promise<ManagedDevice | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_managed_device", { p_id: id });
  if (error) throw error;
  return (data as unknown as ManagedDevice | null) ?? null;
}

export async function fetchCatalogDevice(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_catalog_device", { p_id: id });
  if (error) throw error;
  const row = data?.[0];
  return row ? { ...row, brand_color: brandColor(row.brand_color, row.brand_name) } : null;
}

export async function fetchSubmission(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_submissions", { p_limit: 1000 });
  if (error?.code === "42501") return null;
  if (error) throw error;
  return data?.find((r) => r.id === id) ?? null;
}

const toNum = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));

/** What the server compares, or null when neither alisnad.iq nor ERPNext is connected. */
export function syncCompare(decimals: number): SyncCompare | null {
  const c = syncConfig();
  if (!c.alisnad && !c.erpnext) return null;
  return { alisnad: c.alisnad, erpnext: c.erpnext, erpSelling: Boolean(c.erpSelling), erpBuying: Boolean(c.erpBuying), decimals };
}

/**
 * Publishing status of these devices on ERPNext and alisnad.iq, from their link
 * codes and the stored status (read as the signed-in user: RLS financials.read).
 * Null when nothing is connected or the price-sync tables are not installed.
 */
export async function loadDeviceSync(
  supabase: ServerSupabase,
  ids: string[],
  decimals = 0,
  prices?: Map<string, { selling: number | null; purchase: number | null }>,
): Promise<Map<string, DeviceSync> | null> {
  const compare = syncCompare(decimals);
  if (!compare || !ids.length) return null;
  const loaded = await loadSyncRows(supabase, ids);
  if (!loaded) return null;
  let known = prices;
  if (!known) {
    known = new Map();
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await supabase
        .from("device_financials")
        .select("device_id, final_selling_price, official_purchase_price")
        .in("device_id", ids.slice(i, i + 100));
      for (const f of data ?? []) {
        known.set(f.device_id, { selling: Number(f.final_selling_price), purchase: Number(f.official_purchase_price) });
      }
    }
  }
  return new Map(
    ids.map((id) => [
      id,
      deriveDeviceSync({
        compare,
        codes: loaded.codes.get(id) ?? [],
        rows: loaded.rows.get(id) ?? [],
        selling: known.get(id)?.selling ?? null,
        purchase: known.get(id)?.purchase ?? null,
      }),
    ]),
  );
}

async function attachSync(supabase: ServerSupabase, rows: DeviceListRow[], decimals: number) {
  const prices = new Map(rows.map((r) => [r.id, { selling: toNum(r.sellingPrice), purchase: toNum(r.purchasePrice) }]));
  const sync = await loadDeviceSync(supabase, rows.map((r) => r.id), decimals, prices).catch(() => null);
  if (!sync) return;
  for (const row of rows) row.sync = sync.get(row.id);
}
