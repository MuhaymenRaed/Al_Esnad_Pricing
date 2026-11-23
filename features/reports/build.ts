import "server-only";

import type { ReportColumn, ReportDocumentProps, ReportSection } from "@/components/pdf/report-document";
import type { DeviceListRow } from "@/features/devices/types";
import { formatDate, formatMoney, formatPercent, type MoneyFormat } from "@/lib/format";
import type { Locale, TFunction } from "@/lib/i18n/core";
import { sumAmounts } from "@/lib/pricing/calculate";
import type { ReportScope, ReportVariant } from "@/lib/validation/schemas";

/**
 * Column sets per report variant — each only uses fields the projection
 * contains. Labels come from `t`, so the PDF speaks the user's language.
 */
export function columnsFor(variant: ReportVariant, t: TFunction, currency: string): ReportColumn[] {
  if (variant === "financial") {
    return [
      { key: "device", label: t("pdf.columns.device"), width: 30 },
      { key: "purchase", label: t("pdf.columns.purchase"), unit: currency, width: 14, numeric: true, total: true },
      { key: "discount", label: t("pdf.columns.discount"), width: 12, numeric: true, total: true },
      { key: "payback", label: t("pdf.columns.payback"), width: 11, numeric: true, total: true },
      { key: "cost", label: t("pdf.columns.cost"), width: 14, numeric: true, tone: "gold", total: true },
      { key: "profit", label: t("pdf.columns.profit"), width: 12, numeric: true, tone: "success", total: true },
      { key: "selling", label: t("pdf.columns.selling"), unit: currency, width: 14, numeric: true, tone: "brand", bold: true, total: true },
    ];
  }
  if (variant === "submissions") {
    return [
      { key: "device", label: t("pdf.columns.device"), width: 30 },
      { key: "brand", label: t("pdf.columns.brand"), width: 14 },
      { key: "category", label: t("pdf.columns.category"), width: 14 },
      { key: "identifiers", label: t("pdf.columns.identifiers"), width: 18, tone: "muted" },
      { key: "status", label: t("pdf.columns.status"), width: 12 },
      { key: "submitted", label: t("pdf.columns.submitted"), width: 12 },
    ];
  }
  return [
    { key: "device", label: t("pdf.columns.device"), width: 38 },
    { key: "brand", label: t("pdf.columns.brand"), width: 18 },
    { key: "category", label: t("pdf.columns.category"), width: 20 },
    { key: "selling", label: t("pdf.columns.selling"), unit: currency, width: 24, numeric: true, tone: "brand", bold: true },
  ];
}

export function buildSections(
  rows: DeviceListRow[],
  variant: ReportVariant,
  money: MoneyFormat,
  timezone: string,
  groupByBrand: boolean,
  t: TFunction,
  locale: Locale,
): { sections: ReportSection[]; grandTotals?: Record<string, string> } {
  const m = (v: string | null | undefined) => formatMoney(v, money, { withCurrency: false });
  const groups = new Map<string, { name: string; color: string; rows: DeviceListRow[] }>();
  for (const r of rows) {
    const key = groupByBrand ? r.brandId : "all";
    if (!groups.has(key)) {
      groups.set(key, { name: groupByBrand ? r.brandName : t("pdf.allDevices"), color: groupByBrand ? r.brandColor : "#23262C", rows: [] });
    }
    groups.get(key)!.rows.push(r);
  }

  const totalsFor = (list: DeviceListRow[]) => ({
    purchase: m(sumAmounts(list.map((r) => r.purchasePrice), money.decimals)),
    discount: m(sumAmounts(list.map((r) => r.discountAmount), money.decimals)),
    payback: m(sumAmounts(list.map((r) => r.paybackAmount), money.decimals)),
    cost: m(sumAmounts(list.map((r) => r.finalCost), money.decimals)),
    profit: m(sumAmounts(list.map((r) => r.profit), money.decimals)),
    selling: m(sumAmounts(list.map((r) => r.sellingPrice), money.decimals)),
  });

  const sections = [...groups.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map<ReportSection>((g) => ({
      brandName: g.name,
      brandColor: g.color,
      isBrand: groupByBrand,
      countLabel: t("pdf.deviceCount", { count: g.rows.length }),
      totals: variant === "financial" ? totalsFor(g.rows) : undefined,
      rows: g.rows.map((r): ReportSection["rows"][number] => {
        const ids = [r.modelNumber, r.sku].filter(Boolean).join(" · ");
        if (variant === "financial") {
          return {
            id: r.id,
            cells: {
              device: {
                text: r.name,
                sub: [r.categoryName, ids, r.status && r.status !== "active" ? t(`status.${r.status}`) : null].filter(Boolean).join(" · ") || undefined,
              },
              purchase: { text: m(r.purchasePrice) },
              discount: {
                text: m(r.discountAmount),
                sub: r.discountType === "percentage" && Number(r.discountValue) ? formatPercent(r.discountValue, 4) : undefined,
              },
              payback: { text: m(r.paybackAmount) },
              cost: { text: m(r.finalCost) },
              profit: { text: m(r.profit) },
              selling: { text: m(r.sellingPrice) },
            },
          };
        }
        if (variant === "submissions") {
          return {
            id: r.id,
            cells: {
              device: { text: r.name },
              brand: { text: r.brandName },
              category: { text: r.categoryName ?? "—" },
              identifiers: { text: ids || "—" },
              status: { text: r.status ? t(`status.${r.status}`) : "—" },
              submitted: { text: formatDate(r.createdAt, timezone, "date", locale) },
            },
          };
        }
        return {
          id: r.id,
          cells: {
            device: { text: r.name, sub: ids || undefined },
            brand: { text: r.brandName },
            category: { text: r.categoryName ?? "—" },
            selling: { text: m(r.sellingPrice) },
          },
        };
      }),
    }));

  return { sections, grandTotals: variant === "financial" ? totalsFor(rows) : undefined };
}

export function titlesFor(variant: ReportVariant, t: TFunction) {
  return { title: t(`pdf.titles.${variant}`), subtitle: t(`pdf.titles.${variant}Sub`) };
}

export function scopeLabel(scope: ReportScope, brandNames: string[], selectedCount: number, t: TFunction) {
  switch (scope) {
    case "filtered":
      return t("pdf.scopes.filtered");
    case "selected":
      return t("pdf.scopes.selected", { count: selectedCount });
    case "brands":
      return brandNames.length === 1 ? t("pdf.scopes.brand", { name: brandNames[0] }) : t("pdf.scopes.brands", { names: brandNames.join(t("pdf.listSeparator")) });
    case "all":
      return t("pdf.scopes.all");
  }
}

export function coverStatsFor(variant: ReportVariant, rows: DeviceListRow[], money: MoneyFormat, t: TFunction): ReportDocumentProps["coverStats"] {
  const fmt = (v: string) => formatMoney(v, money);
  if (variant === "financial") {
    const selling = sumAmounts(rows.map((r) => r.sellingPrice), money.decimals);
    const profit = sumAmounts(rows.map((r) => r.profit), money.decimals);
    const margin = Number(selling) > 0 ? ((Number(profit) / Number(selling)) * 100).toFixed(2) : null;
    return [
      { label: t("pdf.stats.totalPurchase"), value: fmt(sumAmounts(rows.map((r) => r.purchasePrice), money.decimals)) },
      { label: t("pdf.stats.totalBenefits"), value: fmt(sumAmounts(rows.flatMap((r) => [r.discountAmount, r.paybackAmount]), money.decimals)) },
      { label: t("pdf.stats.totalCost"), value: fmt(sumAmounts(rows.map((r) => r.finalCost), money.decimals)), tone: "gold" },
      { label: t("pdf.stats.totalSelling"), value: fmt(selling), tone: "brand" },
      { label: t("pdf.stats.totalProfit"), value: fmt(profit), tone: "success" },
      { label: t("pdf.stats.avgMargin"), value: margin ? `${margin}%` : "—" },
    ];
  }
  if (variant === "catalog" && rows.length) {
    const prices = rows.map((r) => Number(r.sellingPrice ?? 0));
    return [
      { label: t("pdf.stats.lowest"), value: fmt(String(Math.min(...prices))) },
      { label: t("pdf.stats.highest"), value: fmt(String(Math.max(...prices))), tone: "brand" },
      { label: t("pdf.stats.categories"), value: String(new Set(rows.map((r) => r.categoryId)).size) },
    ];
  }
  return [];
}
