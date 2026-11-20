import "server-only";

import type { ReportColumn, ReportDocumentProps, ReportSection } from "@/components/pdf/report-document";
import type { DeviceListRow } from "@/features/devices/types";
import { formatDate, formatMoney, formatPercent, type MoneyFormat } from "@/lib/format";
import { STATUS_LABELS } from "@/lib/filters/devices";
import { sumAmounts } from "@/lib/pricing/calculate";
import type { ReportScope, ReportVariant } from "@/lib/validation/schemas";

/** Column sets per report variant — each only uses fields the projection contains. */
export function columnsFor(variant: ReportVariant, currency: string): ReportColumn[] {
  if (variant === "financial") {
    return [
      { key: "device", label: "Device", width: 30 },
      { key: "purchase", label: `Purchase (${currency})`, width: 14, align: "right" },
      { key: "discount", label: "Discount", width: 12, align: "right", total: true },
      { key: "payback", label: "Payback", width: 11, align: "right", total: true },
      { key: "cost", label: "Final cost", width: 14, align: "right", tone: "gold", total: true },
      { key: "profit", label: "Profit", width: 12, align: "right", tone: "success", total: true },
      { key: "selling", label: "Selling price", width: 14, align: "right", tone: "brand", bold: true, total: true },
    ];
  }
  if (variant === "submissions") {
    return [
      { key: "device", label: "Device", width: 30 },
      { key: "brand", label: "Brand", width: 14 },
      { key: "category", label: "Category", width: 14 },
      { key: "identifiers", label: "Model · SKU", width: 18, tone: "muted" },
      { key: "status", label: "Status", width: 12 },
      { key: "submitted", label: "Submitted", width: 12 },
    ];
  }
  return [
    { key: "device", label: "Device", width: 38 },
    { key: "brand", label: "Brand", width: 18 },
    { key: "category", label: "Category", width: 20 },
    { key: "selling", label: `Final selling price (${currency})`, width: 24, align: "right", tone: "brand", bold: true },
  ];
}

export function buildSections(
  rows: DeviceListRow[],
  variant: ReportVariant,
  money: MoneyFormat,
  timezone: string,
  groupByBrand: boolean,
): { sections: ReportSection[]; grandTotals?: Record<string, string> } {
  const m = (v: string | null | undefined) => formatMoney(v, money, { withCurrency: false });
  const groups = new Map<string, { name: string; color: string; rows: DeviceListRow[] }>();
  for (const r of rows) {
    const key = groupByBrand ? r.brandId : "all";
    if (!groups.has(key)) groups.set(key, { name: groupByBrand ? r.brandName : "All devices", color: groupByBrand ? r.brandColor : "#23262C", rows: [] });
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
      countLabel: `${g.rows.length} device${g.rows.length === 1 ? "" : "s"}`,
      totals: variant === "financial" ? totalsFor(g.rows) : undefined,
      rows: g.rows.map((r): ReportSection["rows"][number] => {
        const ids = [r.modelNumber, r.sku].filter(Boolean).join(" · ");
        if (variant === "financial") {
          return {
            id: r.id,
            cells: {
              device: { text: r.name, sub: [r.categoryName, ids, r.status && r.status !== "active" ? STATUS_LABELS[r.status] : null].filter(Boolean).join(" · ") || undefined },
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
              status: { text: r.status ? STATUS_LABELS[r.status] : "—" },
              submitted: { text: formatDate(r.createdAt, timezone) },
            },
          };
        }
        return {
          id: r.id,
          cells: {
            device: { text: r.name },
            brand: { text: r.brandName },
            category: { text: r.categoryName ?? "—" },
            selling: { text: m(r.sellingPrice) },
          },
        };
      }),
    }));

  return { sections, grandTotals: variant === "financial" ? totalsFor(rows) : undefined };
}

export const VARIANT_TITLES: Record<ReportVariant, { title: string; subtitle: string }> = {
  catalog: { title: "Device Price Catalogue", subtitle: "Final selling prices" },
  financial: { title: "Detailed Financial Report", subtitle: "Purchase, supplier benefits, cost, profit and selling price" },
  submissions: { title: "My Device Submissions", subtitle: "Submitted devices and their review status" },
};

export function scopeLabel(scope: ReportScope, brandNames: string[], selectedCount: number) {
  switch (scope) {
    case "filtered":
      return "Filtered results";
    case "selected":
      return `${selectedCount} selected device${selectedCount === 1 ? "" : "s"}`;
    case "brands":
      return brandNames.length === 1 ? `Brand: ${brandNames[0]}` : `Brands: ${brandNames.join(", ")}`;
    case "all":
      return "All devices — all brands";
  }
}

export function coverStatsFor(variant: ReportVariant, rows: DeviceListRow[], money: MoneyFormat): ReportDocumentProps["coverStats"] {
  const fmt = (v: string) => formatMoney(v, money);
  if (variant === "financial") {
    const selling = sumAmounts(rows.map((r) => r.sellingPrice), money.decimals);
    const profit = sumAmounts(rows.map((r) => r.profit), money.decimals);
    const margin = Number(selling) > 0 ? ((Number(profit) / Number(selling)) * 100).toFixed(2) : null;
    return [
      { label: "Total purchase", value: fmt(sumAmounts(rows.map((r) => r.purchasePrice), money.decimals)) },
      { label: "Total discount + payback", value: fmt(sumAmounts(rows.flatMap((r) => [r.discountAmount, r.paybackAmount]), money.decimals)) },
      { label: "Total final cost", value: fmt(sumAmounts(rows.map((r) => r.finalCost), money.decimals)) },
      { label: "Total profit", value: fmt(profit) },
      { label: "Total selling value", value: fmt(selling) },
      { label: "Average margin", value: margin ? `${margin}%` : "—" },
    ];
  }
  if (variant === "catalog" && rows.length) {
    const prices = rows.map((r) => Number(r.sellingPrice ?? 0));
    return [
      { label: "Lowest price", value: fmt(String(Math.min(...prices))) },
      { label: "Highest price", value: fmt(String(Math.max(...prices))) },
      { label: "Categories", value: String(new Set(rows.map((r) => r.categoryId)).size) },
    ];
  }
  return [];
}
