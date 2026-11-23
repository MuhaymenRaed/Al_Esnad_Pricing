import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it, vi } from "vitest";
import { formatDate } from "@/lib/format";
import { createT, type Locale } from "@/lib/i18n/core";

vi.mock("server-only", () => ({}));

const { ReportDocument } = await import("@/components/pdf/report-document");
const { buildSections, columnsFor, coverStatsFor, scopeLabel, titlesFor } = await import("./build");
type Row = import("@/features/devices/types").DeviceListRow;

const money = { currency: "IQD", decimals: 0 };
const en = createT("en");
const ar = createT("ar");

const row = (over: Partial<Row>): Row => ({
  id: crypto.randomUUID(),
  name: "iPhone 18",
  brandId: "apple",
  brandName: "Apple",
  brandColor: "#111827",
  categoryId: "phones",
  categoryName: "Smartphones",
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-02T10:00:00Z",
  status: "active",
  purchasePrice: "2800000",
  discountType: "percentage",
  discountValue: "1",
  discountAmount: "28000",
  paybackAmount: "10000",
  finalCost: "2762000",
  profit: "50000",
  sellingPrice: "2812000",
  ...over,
});

// Scenario 7 shape: two Apple devices + one Samsung device.
const rows: Row[] = [
  row({}),
  row({ name: "iPhone 18 Pro", purchasePrice: "3400000", discountAmount: "34000", finalCost: "3356000", profit: "60000", sellingPrice: "3416000" }),
  row({ name: "Galaxy S26", brandId: "samsung", brandName: "Samsung", brandColor: "#1D4ED8", purchasePrice: "2600000", discountType: "fixed", discountValue: "50000", discountAmount: "50000", paybackAmount: "0", finalCost: "2550000", profit: "45000", sellingPrice: "2595000" }),
];

const PRIVATE_VALUES = ["2,800,000", "28,000", "10,000", "2,762,000", "50,000", "3,400,000", "60,000"];

function render(variant: "financial" | "catalog", orientation: "portrait" | "landscape", locale: Locale) {
  const t = createT(locale);
  const { sections, grandTotals } = buildSections(rows, variant, money, "Asia/Baghdad", true, t, locale);
  const titles = titlesFor(variant, t);
  return renderToBuffer(
    ReportDocument({
      locale,
      company: { name: "شركة الاسناد لتجارة الهاتف النقال", tagline: locale === "ar" ? "منصة تسعير الاسناد" : "Mobile Phone Trading", footer: null },
      title: titles.title,
      subtitle: titles.subtitle,
      generatedAt: "17 Nov 2026, 15:00",
      generatedBy: "Test User",
      scopeLabel: scopeLabel("selected", [], 3, t),
      filters: [t("filters.chips.brand", { value: "Apple" }), t("filters.chips.brand", { value: "Samsung" })],
      columns: columnsFor(variant, t, "IQD"),
      sections,
      grandTotals,
      totalRecords: rows.length,
      coverStats: coverStatsFor(variant, rows, money, t),
      orientation,
      includeCover: true,
      brandPageBreaks: true,
      confidential: variant === "financial",
      truncated: false,
      currency: "IQD",
    }),
  );
}

describe("PDF reports", () => {
  it("separates brands into sections containing exactly the selected devices", () => {
    const { sections } = buildSections(rows, "catalog", money, "Asia/Baghdad", true, en, "en");
    expect(sections.map((s) => [s.brandName, s.rows.length])).toEqual([
      ["Apple", 2],
      ["Samsung", 1],
    ]);
  });

  it("computes exact per-brand and grand totals for the financial report", () => {
    const { sections, grandTotals } = buildSections(rows, "financial", money, "Asia/Baghdad", true, en, "en");
    expect(sections[0].totals?.selling).toBe("6,228,000");
    expect(grandTotals?.selling).toBe("8,823,000");
    expect(grandTotals?.cost).toBe("8,668,000");
  });

  it("Viewer report cells contain only device, brand, category and selling price", () => {
    const cols = columnsFor("catalog", en, "IQD").map((c) => c.key);
    expect(cols).toEqual(["device", "brand", "category", "selling"]);
    const { sections } = buildSections(rows, "catalog", money, "Asia/Baghdad", true, en, "en");
    const text = JSON.stringify(sections);
    for (const v of PRIVATE_VALUES) expect(text).not.toContain(v);
    expect(text).toContain("2,812,000");
    expect(JSON.stringify(coverStatsFor("catalog", rows, money, en))).not.toMatch(/2,800,000|2,762,000|50,000 /);
  });

  it("speaks the user's language", () => {
    expect(titlesFor("financial", ar).title).toBe("التقرير المالي المفصّل");
    expect(columnsFor("financial", ar, "IQD").map((c) => c.label)).toEqual([
      "الجهاز",
      "سعر الشراء",
      "الخصم",
      "الراجع",
      "التكلفة النهائية",
      "الربح",
      "سعر البيع",
    ]);
    const { sections } = buildSections(rows, "financial", money, "Asia/Baghdad", true, ar, "ar");
    expect(sections[0].countLabel).toBe("2 جهاز");
    expect(titlesFor("financial", en).title).toBe("Detailed Financial Report");
  });

  it("renders valid PDFs in both languages with private-data-free metadata", async () => {
    const outDir = path.join(process.env.REPORT_PREVIEW_DIR ?? path.join(import.meta.dirname, "../../.next/report-previews"));
    mkdirSync(outDir, { recursive: true });
    const files: Array<[string, Buffer]> = [
      ["financial-ar.pdf", await render("financial", "landscape", "ar")],
      ["catalog-ar.pdf", await render("catalog", "portrait", "ar")],
      ["financial-en.pdf", await render("financial", "landscape", "en")],
      ["catalog-en.pdf", await render("catalog", "portrait", "en")],
    ];
    for (const [name, pdf] of files) {
      writeFileSync(path.join(outDir, name), pdf);
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      expect(pages).toBeGreaterThanOrEqual(3); // cover + one page per brand
    }
    // The document information dictionary of the Viewer PDF holds no amounts.
    for (const [name, pdf] of files.filter(([n]) => n.startsWith("catalog"))) {
      const info = pdf.toString("latin1").match(/\/Title[\s\S]{0,400}/)?.[0] ?? "";
      for (const v of ["2800000", "2,800,000", "50000", "28000"]) expect(info, name).not.toContain(v);
    }
  }, 60_000);

  it("paginates long multi-brand reports (Arabic, portrait, continuous)", async () => {
    const brands: Array<[string, string]> = [
      ["Xiaomi", "#C2185B"],
      ["Huawei", "#C8102E"],
      ["Blackview", "#D97706"],
      ["Nothing", "#3F3F46"],
      ["OnePlus", "#9F1239"],
    ];
    const many: Row[] = [
      ...brands.map(([brandName, brandColor], i) => row({ name: `${brandName} device ${i + 1}`, brandId: brandName, brandName, brandColor })),
      ...Array.from({ length: 45 }, (_, i) => row({ name: `Galaxy A${10 + i} 128GB`, brandId: "samsung", brandName: "Samsung", brandColor: "#2563EB" })),
    ];
    const t = ar;
    const { sections, grandTotals } = buildSections(many, "financial", money, "Asia/Baghdad", true, t, "ar");
    const pdf = await renderToBuffer(
      ReportDocument({
        locale: "ar",
        company: { name: "شركة الاسناد لتجارة الهاتف النقال", tagline: "منصة تسعير الاسناد", footer: null },
        ...titlesFor("financial", t),
        generatedAt: formatDate(new Date("2026-11-17T12:00:00Z"), "Asia/Baghdad", "datetime", "ar"),
        generatedBy: "مدير النظام",
        scopeLabel: scopeLabel("all", [], 0, t),
        filters: [],
        columns: columnsFor("financial", t, "IQD"),
        sections,
        grandTotals,
        totalRecords: many.length,
        coverStats: coverStatsFor("financial", many, money, t),
        orientation: "portrait",
        includeCover: true,
        brandPageBreaks: false,
        confidential: true,
        truncated: false,
        currency: "IQD",
      }),
    );
    const outDir = path.join(process.env.REPORT_PREVIEW_DIR ?? path.join(import.meta.dirname, "../../.next/report-previews"));
    writeFileSync(path.join(outDir, "long-ar.pdf"), pdf);
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(3);
  }, 60_000);
});
