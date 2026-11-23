/**
 * Publishing status of a device on alisnad.iq and in ERPNext, derived from
 * what each system held at the last check or publish (device_sync_state) and
 * the device's current prices. Pure: shared by the server and the browser.
 *
 *   off        the system is not connected on this server
 *   unlinked   the device has no link codes
 *   unchecked  link codes changed since the last check
 *   error      the last check or publish failed
 *   missing    none of the codes exists in that system
 *   hidden     found, but every match is inactive there (alisnad.iq: not shown; ERPNext: disabled)
 *   outdated   found, but a price there differs from this app → needs "Publish"
 *   synced     found and every price matches
 *
 * Compared prices: alisnad.iq — the final selling price; ERPNext — the
 * selling price (when a selling price list is configured) and the purchase
 * price (when a buying price list is configured). Amounts are compared after
 * rounding to the company currency's decimals, so 307,727.59 in ERPNext equals
 * 307,728 here when the currency has no decimals.
 */
export const SYNC_SYSTEMS = ["erpnext", "alisnad"] as const;
export type SyncSystem = (typeof SYNC_SYSTEMS)[number];

export type SyncBadgeState = "off" | "unlinked" | "unchecked" | "error" | "missing" | "hidden" | "outdated" | "synced";

export type RemoteItem = { code: string; name: string | null; active: boolean; selling: number | null; buying?: number | null };

/** A device_sync_state row as read from the database. */
export type SyncStateRow = {
  device_id: string;
  target: SyncSystem;
  codes: string[];
  items: unknown;
  error: string | null;
  checked_at: string;
  published_at: string | null;
};

export type SystemSync = {
  state: SyncBadgeState;
  items: RemoteItem[];
  checkedAt: string | null;
  publishedAt: string | null;
  error: string | null;
};
export type DeviceSync = Record<SyncSystem, SystemSync>;

/** What is connected and compared (from the server's configuration). */
export type SyncCompare = { alisnad: boolean; erpnext: boolean; erpSelling: boolean; erpBuying: boolean; decimals: number };

const round = (v: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round((v + Number.EPSILON) * f) / f;
};
export const samePrice = (a: number | null | undefined, b: number | null | undefined, decimals: number) =>
  a !== null && a !== undefined && b !== null && b !== undefined && round(a, decimals) === round(b, decimals);

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

export const asItems = (value: unknown): RemoteItem[] =>
  Array.isArray(value)
    ? value
        .filter((i): i is Record<string, unknown> => Boolean(i) && typeof i === "object")
        .map((i) => ({
          code: String(i.code ?? ""),
          name: typeof i.name === "string" ? i.name : null,
          active: i.active !== false,
          selling: i.selling === null || i.selling === undefined ? null : Number(i.selling),
          ...(i.buying === undefined ? {} : { buying: i.buying === null ? null : Number(i.buying) }),
        }))
    : [];

/** Whether one remote item holds this app's prices. */
export function itemMatches(system: SyncSystem, item: RemoteItem, local: { selling: number | null; purchase: number | null }, compare: SyncCompare) {
  if (system === "alisnad") return samePrice(item.selling, local.selling, compare.decimals);
  const selling = !compare.erpSelling || samePrice(item.selling, local.selling, compare.decimals);
  const buying = !compare.erpBuying || local.purchase === null || samePrice(item.buying ?? null, local.purchase, compare.decimals);
  return selling && buying;
}

export function deriveSystemSync(args: {
  system: SyncSystem;
  compare: SyncCompare;
  codes: string[];
  row: SyncStateRow | undefined;
  selling: number | null;
  purchase: number | null;
}): SystemSync {
  const { row, system, compare } = args;
  const base = { items: asItems(row?.items), checkedAt: row?.checked_at ?? null, publishedAt: row?.published_at ?? null, error: row?.error ?? null };
  if (!compare[system]) return { ...base, state: "off" };
  if (!args.codes.length) return { ...base, items: [], state: "unlinked" };
  if (!row || !sameSet(row.codes, args.codes)) return { ...base, items: [], state: "unchecked" };
  if (row.error) return { ...base, state: "error" };
  if (!base.items.length) return { ...base, state: "missing" };
  if (base.items.every((i) => !i.active)) return { ...base, state: "hidden" };
  const local = { selling: args.selling, purchase: args.purchase };
  return { ...base, state: base.items.every((i) => itemMatches(system, i, local, compare)) ? "synced" : "outdated" };
}

export function deriveDeviceSync(args: {
  compare: SyncCompare;
  codes: string[];
  rows: SyncStateRow[];
  selling: number | null;
  purchase: number | null;
}): DeviceSync {
  const of = (system: SyncSystem) =>
    deriveSystemSync({ system, compare: args.compare, codes: args.codes, row: args.rows.find((r) => r.target === system), selling: args.selling, purchase: args.purchase });
  return { erpnext: of("erpnext"), alisnad: of("alisnad") };
}

/** Badge tone per state. */
export const SYNC_TONES: Record<SyncBadgeState, "success" | "warning" | "danger" | "muted"> = {
  synced: "success",
  outdated: "warning",
  hidden: "warning",
  missing: "danger",
  error: "danger",
  unchecked: "muted",
  unlinked: "muted",
  off: "muted",
};
