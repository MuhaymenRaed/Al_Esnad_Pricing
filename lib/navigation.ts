import type { MessageKey } from "@/lib/i18n/core";
import type { DataProjection, Permission } from "@/lib/permissions";

export type NavItem = {
  href: string;
  label: MessageKey;
  icon: "home" | "devices" | "brands" | "categories" | "reports" | "users" | "roles" | "audit" | "settings";
  group: "main" | "admin";
};

/** Navigation for the interface being rendered (effective permissions). */
export function buildNavigation(permissions: ReadonlySet<Permission>, projection: DataProjection | null): NavItem[] {
  const items: NavItem[] = [{ href: "/dashboard", label: "nav.home", icon: "home", group: "main" }];

  if (projection === "full") items.push({ href: "/devices", label: "nav.devices", icon: "devices", group: "main" });
  else if (projection === "catalog") items.push({ href: "/devices", label: "nav.catalogue", icon: "devices", group: "main" });
  else if (projection === "submissions") items.push({ href: "/devices", label: "nav.submissions", icon: "devices", group: "main" });

  if ((projection === "full" || projection === "catalog") && permissions.has("brands.read"))
    items.push({ href: "/brands", label: "nav.brands", icon: "brands", group: "main" });
  if (permissions.has("categories.manage")) items.push({ href: "/categories", label: "nav.categories", icon: "categories", group: "main" });
  if (permissions.has("reports.export") && projection) items.push({ href: "/reports", label: "nav.reports", icon: "reports", group: "main" });

  if (permissions.has("users.manage")) items.push({ href: "/users", label: "nav.users", icon: "users", group: "admin" });
  if (permissions.has("roles.manage")) items.push({ href: "/roles-and-permissions", label: "nav.roles", icon: "roles", group: "admin" });
  if (permissions.has("audit.read")) items.push({ href: "/audit-logs", label: "nav.audit", icon: "audit", group: "admin" });

  items.push({ href: "/settings", label: "nav.settings", icon: "settings", group: "admin" });
  return items;
}

export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
