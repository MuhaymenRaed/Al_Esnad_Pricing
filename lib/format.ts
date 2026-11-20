import Decimal from "decimal.js";
import { intlLocale, type Locale } from "@/lib/i18n/core";

export type MoneyFormat = { currency: string; decimals: number };

function groupDigits(value: Decimal, decimals: number) {
  const fixed = value.toFixed(decimals);
  const negative = fixed.startsWith("-");
  const [int, frac] = fixed.replace("-", "").split(".");
  // Latin digits with comma grouping in every language (standard for prices).
  const grouped = new Intl.NumberFormat("en-US", { useGrouping: true }).format(BigInt(int));
  return `${negative ? "-" : ""}${grouped}${frac ? `.${frac}` : ""}`;
}

/** Formats an exact decimal amount: "2,812,000 IQD". Never uses floats. */
export function formatMoney(
  value: string | number | null | undefined,
  { currency, decimals }: MoneyFormat,
  options: { withCurrency?: boolean; empty?: string } = {},
) {
  if (value === null || value === undefined || value === "") return options.empty ?? "—";
  let d: Decimal;
  try {
    d = new Decimal(value);
  } catch {
    return options.empty ?? "—";
  }
  const text = groupDigits(d, decimals);
  return options.withCurrency === false ? text : `${text} ${currency}`;
}

export function formatNumber(value: string | number | null | undefined, decimals = 0) {
  if (value === null || value === undefined || value === "") return "—";
  return groupDigits(new Decimal(value), decimals);
}

export function formatPercent(value: string | number | null | undefined, decimals = 2) {
  if (value === null || value === undefined || value === "") return "—";
  return `${new Decimal(value).toDecimalPlaces(decimals).toString()}%`;
}

/** Deterministic date formatting (same on server and client): explicit locale and time zone. */
export function formatDate(
  value: string | Date | null | undefined,
  timeZone = "Asia/Baghdad",
  style: "date" | "datetime" | "time" = "date",
  locale: Locale = "en",
) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const options: Intl.DateTimeFormatOptions =
    style === "date"
      ? { year: "numeric", month: "short", day: "2-digit", timeZone }
      : style === "time"
        ? { hour: "2-digit", minute: "2-digit", timeZone }
        : { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone };
  return new Intl.DateTimeFormat(intlLocale(locale), options).format(date);
}

export function formatRelative(value: string | null | undefined, locale: Locale = "en", now = new Date()) {
  if (!value) return "—";
  const diff = (new Date(value).getTime() - now.getTime()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale === "ar" ? "ar" : "en", { numeric: "auto" });
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), "month");
  return rtf.format(Math.round(diff / (86400 * 365)), "year");
}

export function initials(name: string | null | undefined, fallback = "?") {
  if (!name) return fallback;
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "").concat(parts[1]?.[0] ?? "").toUpperCase() || fallback;
}
