import type { AppRole } from "@/types/database";

/**
 * Permission keys mirror public.permission_catalog. The database is
 * authoritative (has_permission(), RLS, guarded RPCs) — these helpers only
 * decide what the UI renders. Administrators implicitly hold every key.
 */
export const PERMISSIONS = [
  "devices.read_all",
  "devices.read_public",
  "devices.read_own_submissions",
  "devices.create",
  "devices.update",
  "devices.archive",
  "devices.delete",
  "devices.submit",
  "devices.edit_own_submissions",
  "financials.read",
  "financials.update",
  "prices.publish",
  "pricing.read_public",
  "reports.export",
  "brands.read",
  "brands.manage",
  "categories.read",
  "categories.manage",
  "submissions.review",
  "users.manage",
  "roles.manage",
  "roles.preview",
  "audit.read",
  "settings.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
type Perms = ReadonlySet<string>;

export const ROLES: AppRole[] = ["administrator", "pricing_manager", "viewer", "data_entry"];

export const ROLE_LABELS: Record<AppRole, string> = {
  administrator: "Administrator",
  pricing_manager: "Pricing Manager",
  viewer: "Viewer",
  data_entry: "Data Entry Operator",
};

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  administrator: "Complete control: users, permissions, settings, audit logs and all pricing.",
  pricing_manager: "Full pricing access: costs, discounts, paybacks, profit and selling prices.",
  viewer: "Browses the catalogue with final selling prices only.",
  data_entry: "Submits new devices with their official purchase price for review.",
};

export type PreviewRole = Extract<AppRole, "viewer" | "data_entry">;
export const PREVIEW_ROLES: PreviewRole[] = ["viewer", "data_entry"];
export const PREVIEW_COOKIE = "view_as";

export function isPreviewRole(value: unknown): value is PreviewRole {
  return value === "viewer" || value === "data_entry";
}

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (ROLES as string[]).includes(value);
}

/** Capability checks (same rules as the SQL gates in app_extensions.sql). */
export const caps = {
  readFull: (p: Perms) => p.has("devices.read_all") && p.has("financials.read"),
  readCatalog: (p: Perms) =>
    (p.has("devices.read_public") || p.has("devices.read_all")) &&
    (p.has("pricing.read_public") || p.has("financials.read")),
  submit: (p: Perms) => p.has("devices.submit"),
  readSubmissions: (p: Perms) => p.has("devices.submit") || p.has("devices.read_own_submissions"),
  createDevice: (p: Perms) => p.has("devices.create") && p.has("financials.update"),
  editDevice: (p: Perms) => p.has("devices.update") && p.has("financials.update"),
  archive: (p: Perms) => p.has("devices.archive"),
  deleteDevice: (p: Perms) => p.has("devices.delete"),
  review: (p: Perms) => p.has("submissions.review") && p.has("devices.update"),
  financialReport: (p: Perms) => p.has("reports.export") && p.has("devices.read_all") && p.has("financials.read"),
  publishPrices: (p: Perms) => p.has("prices.publish") && p.has("financials.update"),
  importDevices: (p: Perms) => p.has("devices.create") && p.has("financials.update"),
};

/**
 * Which projection of the device data an interface uses:
 *   full        — every financial value (Administrator, Pricing Manager)
 *   catalog     — name, brand, category, selling price (Viewer)
 *   submissions — own submissions (Data Entry)
 */
export type DataProjection = "full" | "catalog" | "submissions";

export function projectionFor(permissions: Perms): DataProjection | null {
  if (caps.readFull(permissions)) return "full";
  if (caps.readCatalog(permissions)) return "catalog";
  if (caps.readSubmissions(permissions)) return "submissions";
  return null;
}

export const DASHBOARD_TITLES: Record<AppRole, string> = {
  administrator: "Administrator Dashboard",
  pricing_manager: "Pricing Management",
  viewer: "Device Catalogue",
  data_entry: "Data Entry",
};
