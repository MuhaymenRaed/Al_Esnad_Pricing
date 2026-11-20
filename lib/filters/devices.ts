import { z } from "zod";
import type { TFunction } from "@/lib/i18n/core";
import type { DataProjection } from "@/lib/permissions";
import type { DeviceStatus } from "@/types/database";

/**
 * One filter model shared by the URL, the device table, the statistics and the
 * PDF export, so all of them always describe the exact same result set.
 */

export const CATALOG_SORTS = ["name_asc", "name_desc", "newest", "oldest", "updated", "price_asc", "price_desc"] as const;
export const FULL_SORTS = [
  ...CATALOG_SORTS,
  "purchase_asc",
  "purchase_desc",
  "cost_asc",
  "cost_desc",
  "profit_asc",
  "profit_desc",
] as const;
export type SortKey = (typeof FULL_SORTS)[number];

export const SORT_LABELS: Record<SortKey, string> = {
  name_asc: "Name A–Z",
  name_desc: "Name Z–A",
  newest: "Newest first",
  oldest: "Oldest first",
  updated: "Recently updated",
  price_asc: "Lowest selling price",
  price_desc: "Highest selling price",
  purchase_asc: "Lowest purchase price",
  purchase_desc: "Highest purchase price",
  cost_asc: "Lowest final cost",
  cost_desc: "Highest final cost",
  profit_asc: "Lowest profit",
  profit_desc: "Highest profit",
};

export const PRICE_FIELDS = ["selling", "purchase", "cost", "profit", "discount", "payback"] as const;
export type PriceField = (typeof PRICE_FIELDS)[number];
export const PRICE_FIELD_LABELS: Record<PriceField, string> = {
  selling: "Selling price",
  purchase: "Purchase price",
  cost: "Final cost",
  profit: "Company profit",
  discount: "Discount amount",
  payback: "Payback",
};

export const STATUSES: DeviceStatus[] = ["draft", "pending_review", "active", "rejected", "archived"];
export const STATUS_LABELS: Record<DeviceStatus, string> = {
  draft: "Draft",
  pending_review: "Pending review",
  active: "Active",
  rejected: "Rejected",
  archived: "Archived",
};

export const RECENT_WINDOWS = ["7d", "30d", "90d"] as const;
export type RecentWindow = (typeof RECENT_WINDOWS)[number];
export const RECENT_LABELS: Record<RecentWindow, string> = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days" };

export type DeviceFilters = {
  q?: string;
  brandIds?: string[];
  categoryIds?: string[];
  statuses?: DeviceStatus[];
  priceField?: PriceField;
  priceMin?: string;
  priceMax?: string;
  dateField?: "created" | "updated";
  dateFrom?: string; // YYYY-MM-DD (company time zone)
  dateTo?: string; // YYYY-MM-DD inclusive
  recent?: RecentWindow;
  sort?: SortKey;
};

const uuid = z.uuid();
const amount = z
  .string()
  .trim()
  .transform((v) => v.replace(/[,\s]/g, ""))
  .pipe(z.string().regex(/^\d{1,15}(\.\d{1,3})?$/));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Strict schema for filters arriving from the network (API / server actions). */
export const deviceFiltersSchema = z.object({
  q: z.string().trim().max(120).optional(),
  brandIds: z.array(uuid).max(500).optional(),
  categoryIds: z.array(uuid).max(500).optional(),
  statuses: z.array(z.enum(["draft", "pending_review", "active", "rejected", "archived"])).max(5).optional(),
  priceField: z.enum(PRICE_FIELDS).optional(),
  priceMin: amount.optional(),
  priceMax: amount.optional(),
  dateField: z.enum(["created", "updated"]).optional(),
  dateFrom: day.optional(),
  dateTo: day.optional(),
  recent: z.enum(RECENT_WINDOWS).optional(),
  sort: z.enum(FULL_SORTS).optional(),
});

type SearchParamsLike = URLSearchParams | Record<string, string | string[] | undefined>;

function read(params: SearchParamsLike, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function list(value: string | undefined) {
  return value ? value.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
}

/** Lenient parse from URL query parameters — invalid values are dropped. */
export function parseFilters(params: SearchParamsLike): DeviceFilters {
  const raw = {
    q: read(params, "q"),
    brandIds: list(read(params, "brand")),
    categoryIds: list(read(params, "category")),
    statuses: list(read(params, "status")),
    priceField: read(params, "pf"),
    priceMin: read(params, "min"),
    priceMax: read(params, "max"),
    dateField: read(params, "date"),
    dateFrom: read(params, "from"),
    dateTo: read(params, "to"),
    recent: read(params, "recent"),
    sort: read(params, "sort"),
  };
  const result: DeviceFilters = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    const field = deviceFiltersSchema.shape[key as keyof typeof deviceFiltersSchema.shape];
    if (Array.isArray(value)) {
      // Keep the valid members of a list rather than dropping the whole list.
      const element = (field as unknown as z.ZodOptional<z.ZodArray<z.ZodType>>).unwrap().element;
      const valid = value.filter((v) => element.safeParse(v).success);
      if (valid.length) (result as Record<string, unknown>)[key] = valid;
      continue;
    }
    const parsed = field.safeParse(value);
    if (parsed.success && parsed.data !== undefined) (result as Record<string, unknown>)[key] = parsed.data;
  }
  return result;
}

export function filtersToSearchParams(filters: DeviceFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (filters.q) p.set("q", filters.q);
  if (filters.brandIds?.length) p.set("brand", filters.brandIds.join(","));
  if (filters.categoryIds?.length) p.set("category", filters.categoryIds.join(","));
  if (filters.statuses?.length) p.set("status", filters.statuses.join(","));
  if (filters.priceField && filters.priceField !== "selling") p.set("pf", filters.priceField);
  if (filters.priceMin) p.set("min", filters.priceMin);
  if (filters.priceMax) p.set("max", filters.priceMax);
  if (filters.dateField && filters.dateField !== "created") p.set("date", filters.dateField);
  if (filters.dateFrom) p.set("from", filters.dateFrom);
  if (filters.dateTo) p.set("to", filters.dateTo);
  if (filters.recent) p.set("recent", filters.recent);
  if (filters.sort && filters.sort !== "name_asc") p.set("sort", filters.sort);
  return p;
}

/** Removes anything the projection may not use (e.g. private-amount filters for Viewers). */
export function sanitizeFilters(filters: DeviceFilters, projection: DataProjection): DeviceFilters {
  if (projection === "full") return filters;
  const clean: DeviceFilters = { ...filters };
  delete clean.statuses;
  if (clean.priceField && clean.priceField !== "selling") {
    delete clean.priceField;
    delete clean.priceMin;
    delete clean.priceMax;
  }
  if (clean.sort && !(CATALOG_SORTS as readonly string[]).includes(clean.sort)) delete clean.sort;
  return clean;
}

export function isFiltered(filters: DeviceFilters) {
  return Object.entries(filters).some(([key, v]) => key !== "sort" && (Array.isArray(v) ? v.length > 0 : Boolean(v)));
}

/** Offset (minutes) of a time zone at a given instant, using Intl only. */
function zoneOffsetMinutes(timeZone: string, at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asUtc - at.getTime()) / 60000;
}

/** Midnight of `day` (YYYY-MM-DD) in `timeZone`, as an ISO instant. */
export function zonedDayStart(day: string, timeZone: string, addDays = 0) {
  const [y, m, d] = day.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d + addDays));
  const offset = zoneOffsetMinutes(timeZone, guess);
  return new Date(guess.getTime() - offset * 60000).toISOString();
}

export type RpcFilters = {
  q?: string;
  brandIds?: string[];
  categoryIds?: string[];
  ids?: string[];
  statuses?: DeviceStatus[];
  priceField?: PriceField;
  priceMin?: string;
  priceMax?: string;
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
};

/** Converts UI filters into the JSON document understood by the SQL search engine. */
export function toRpcFilters(
  filters: DeviceFilters,
  timeZone: string,
  extra: { ids?: string[] } = {},
  now = new Date(),
): RpcFilters {
  const out: RpcFilters = {};
  if (filters.q) out.q = filters.q;
  if (filters.brandIds?.length) out.brandIds = filters.brandIds;
  if (filters.categoryIds?.length) out.categoryIds = filters.categoryIds;
  if (filters.statuses?.length) out.statuses = filters.statuses;
  if (filters.priceMin || filters.priceMax) {
    out.priceField = filters.priceField ?? "selling";
    if (filters.priceMin) out.priceMin = filters.priceMin;
    if (filters.priceMax) out.priceMax = filters.priceMax;
  }
  const field = filters.dateField === "updated" ? "updated" : "created";
  if (filters.recent) {
    const days = Number.parseInt(filters.recent, 10);
    out[`${field}From`] = new Date(now.getTime() - days * 86400000).toISOString();
  } else {
    if (filters.dateFrom) out[`${field}From`] = zonedDayStart(filters.dateFrom, timeZone);
    if (filters.dateTo) out[`${field}To`] = zonedDayStart(filters.dateTo, timeZone, 1);
  }
  if (extra.ids) out.ids = extra.ids;
  return out;
}

export type FilterChip = { key: keyof DeviceFilters; label: string; value?: string };

/** Human-readable description of active filters (chips + PDF cover page). */
export function describeFilters(
  filters: DeviceFilters,
  lookups: { brands: Map<string, string>; categories: Map<string, string>; formatAmount: (v: string) => string },
  t: TFunction,
): FilterChip[] {
  const chips: FilterChip[] = [];
  const unknown = t("filters.chips.unknown");
  if (filters.q) chips.push({ key: "q", label: t("filters.chips.search", { value: filters.q }) });
  for (const id of filters.brandIds ?? [])
    chips.push({ key: "brandIds", value: id, label: t("filters.chips.brand", { value: lookups.brands.get(id) ?? unknown }) });
  for (const id of filters.categoryIds ?? [])
    chips.push({ key: "categoryIds", value: id, label: t("filters.chips.category", { value: lookups.categories.get(id) ?? unknown }) });
  for (const s of filters.statuses ?? []) chips.push({ key: "statuses", value: s, label: t("filters.chips.status", { value: t(`status.${s}`) }) });
  const field = t(`priceField.${filters.priceField ?? "selling"}`);
  if (filters.priceMin) chips.push({ key: "priceMin", label: t("filters.chips.min", { field, value: lookups.formatAmount(filters.priceMin) }) });
  if (filters.priceMax) chips.push({ key: "priceMax", label: t("filters.chips.max", { field, value: lookups.formatAmount(filters.priceMax) }) });
  const dateField = filters.dateField === "updated" ? t("filters.updated") : t("filters.added");
  if (filters.recent) chips.push({ key: "recent", label: t("filters.chips.recent", { field: dateField, value: t(`recent.${filters.recent}`) }) });
  if (filters.dateFrom) chips.push({ key: "dateFrom", label: t("filters.chips.from", { field: dateField, value: filters.dateFrom }) });
  if (filters.dateTo) chips.push({ key: "dateTo", label: t("filters.chips.to", { field: dateField, value: filters.dateTo }) });
  return chips;
}

export function removeChip(filters: DeviceFilters, chip: FilterChip): DeviceFilters {
  const next: DeviceFilters = { ...filters };
  const current = next[chip.key];
  if (Array.isArray(current) && chip.value) {
    const remaining = (current as string[]).filter((v) => v !== chip.value);
    (next as Record<string, unknown>)[chip.key] = remaining.length ? remaining : undefined;
  } else {
    delete next[chip.key];
  }
  return next;
}
