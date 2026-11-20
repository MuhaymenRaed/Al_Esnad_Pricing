import type { TFunction } from "@/lib/i18n/core";
import { isAppRole } from "@/lib/permissions";
import type { DeviceStatus } from "@/types/database";

type Log = { action: string; table_name: string; old_data: unknown; new_data: unknown };
type Tone = "brand" | "success" | "warning" | "info" | "neutral" | "gold";

const TABLES = ["devices", "device_financials", "brands", "categories", "profiles", "role_permissions", "company_settings"] as const;
type Table = (typeof TABLES)[number];
const isTable = (v: string): v is Table => (TABLES as readonly string[]).includes(v);

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const IGNORED = new Set(["updated_at", "updated_by", "created_at"]);

export function changedFields(log: Log) {
  const before = obj(log.old_data);
  const after = obj(log.new_data);
  return Object.keys({ ...before, ...after }).filter((k) => !IGNORED.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

/** Human-readable, translated sentence for an audit log entry. */
export function describeAudit(log: Log, t: TFunction): { summary: string; label: string; tone: Tone } {
  const before = obj(log.old_data);
  const after = obj(log.new_data);
  const name = String(after.name ?? before.name ?? after.email ?? before.email ?? "");
  const entity = isTable(log.table_name) ? t(`audit.entity.${log.table_name}`) : log.table_name;
  const role = (v: unknown) => (isAppRole(v) ? t(`roles.${v}`) : String(v ?? ""));
  const email = String(after.email ?? before.email ?? t("audit.s.someone"));

  switch (log.action) {
    case "USER_INVITED":
      return { summary: t("audit.s.invited", { email, role: role(after.role) }), label: t("audit.labels.invitation"), tone: "info" };
    case "USER_INVITE_RESENT":
      return { summary: t("audit.s.resent", { email }), label: t("audit.labels.invitation"), tone: "info" };
    case "ROLE_CHANGED":
      return { summary: t("audit.s.roleChanged", { email, from: role(before.role), to: role(after.role) }), label: t("audit.labels.role"), tone: "warning" };
    case "USER_ACTIVATED":
      return { summary: t("audit.s.activated", { email }), label: t("audit.labels.activation"), tone: "success" };
    case "USER_DEACTIVATED":
      return { summary: t("audit.s.deactivated", { email }), label: t("audit.labels.deactivation"), tone: "warning" };
  }

  if (log.table_name === "role_permissions") {
    const key = String(after.permission_key ?? before.permission_key ?? "");
    const r = role(after.role ?? before.role);
    const revoked = log.action === "DELETE" || after.allowed === false;
    return { summary: t(revoked ? "audit.s.revoked" : "audit.s.granted", { key, role: r }), label: t("audit.labels.permission"), tone: "warning" };
  }
  if (log.table_name === "device_financials") {
    if (log.action === "INSERT") return { summary: t("audit.s.pricingEntered"), label: t("audit.labels.pricing"), tone: "gold" };
    const fields = changedFields(log).map((f) => f.replace(/_/g, " ")).join(", ") || t("audit.s.recalculated");
    return { summary: t("audit.s.pricingChanged", { fields }), label: t("audit.labels.pricing"), tone: "gold" };
  }
  if (log.table_name === "devices" && log.action === "UPDATE" && before.status !== after.status) {
    const map: Record<DeviceStatus, Parameters<TFunction>[0]> = {
      active: "audit.s.statusApproved",
      rejected: "audit.s.statusRejected",
      archived: "audit.s.statusArchived",
      pending_review: "audit.s.statusPending",
      draft: "audit.s.statusDraft",
    };
    const key = map[after.status as DeviceStatus] ?? "audit.s.updated";
    return { summary: t(key, { name, entity }), label: t("audit.labels.status"), tone: after.status === "active" ? "success" : "warning" };
  }
  if (log.action === "INSERT") return { summary: t("audit.s.created", { entity, name }).trim(), label: t("audit.labels.created"), tone: "success" };
  if (log.action === "DELETE") return { summary: t("audit.s.deleted", { entity, name }).trim(), label: t("audit.labels.deleted"), tone: "brand" };
  return { summary: t("audit.s.updated", { entity, name }).trim(), label: t("audit.labels.updated"), tone: "neutral" };
}
