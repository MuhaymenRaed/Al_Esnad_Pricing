import type { MessageKey } from "@/lib/i18n/core";

/**
 * Server actions return translation KEYS (e.g. "errors.permission"); the
 * client renders them in the user's language (useI18n().tm). Errors raised by
 * the database are mapped to keys too, so users never see raw SQL text.
 */
type PgLikeError = { code?: string; message?: string; details?: string | null };

const DB_MESSAGES: Array<[RegExp, MessageKey]> = [
  [/brand does not exist or is inactive/i, "errors.db.brandInactive"],
  [/category does not exist or is inactive/i, "errors.db.categoryInactive"],
  [/device name is required/i, "errors.db.nameRequired"],
  [/purchase price is required/i, "errors.db.priceRequired"],
  [/cannot exceed 100/i, "errors.db.pctOver100"],
  [/fixed discount cannot exceed/i, "errors.db.fixedOverPrice"],
  [/discount and payback cannot exceed|discount plus payback/i, "errors.db.benefitsOverPrice"],
  [/cannot be negative/i, "errors.db.negative"],
  [/last active administrator|at least one active administrator/i, "errors.db.lastAdmin"],
  [/your own role|own currently signed-in|deactivate your own/i, "errors.db.ownStatus"],
  [/locked/i, "errors.db.locked"],
  [/financial record is required/i, "errors.db.needsFinancials"],
  [/review submissions/i, "errors.db.notReviewer"],
  [/modified by someone else/i, "errors.db.modified"],
  [/not authorized|permission denied|only an administrator/i, "errors.permission"],
  [/not found/i, "errors.notFound"],
];

export function toUserMessage(error: unknown, fallback: MessageKey = "errors.generic"): MessageKey {
  if (!error) return fallback;
  const e = error as PgLikeError;
  const text = `${e.message ?? ""} ${e.details ?? ""}`;

  if (e.code === "23505") {
    if (/sku/i.test(text)) return "errors.duplicateSku";
    if (/brands_name/i.test(text)) return "brands.duplicate";
    if (/categories_name/i.test(text)) return "categories.duplicate";
    return "errors.duplicate";
  }
  if (e.code === "23503") return "errors.referenced";
  if (e.code === "40001") return "errors.conflict";
  if (e.code === "PGRST301") return "errors.sessionExpired";
  if (e.code === "PGRST116") return "errors.notFound";
  for (const [pattern, key] of DB_MESSAGES) if (pattern.test(text)) return key;
  if (e.code === "42501") return "errors.permission";
  if (e.code === "22P02") return "errors.invalidFormat";
  if (e.code === "23514") return "errors.outOfRange";
  if (error instanceof Error && /fetch failed|network/i.test(error.message)) return "errors.network";
  return fallback;
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

export function ok<T>(data: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

export function fail(error: string, fieldErrors?: Record<string, string[] | undefined>): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}
