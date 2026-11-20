import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { ReportDocument } = await import("@/components/pdf/report-document");
const { buildSections, columnsFor, coverStatsFor } = await import("./build");
type Row = import("@/features/devices/types").DeviceListRow;

const money = { currency: "IQD", decimals: 0 };

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

function render(variant: "financial" | "catalog", orientation: "portrait" | "landscape") {
  const { sections, grandTotals } = buildSections(rows, variant, money, "Asia/Baghdad", true);
  return renderToBuffer(
    ReportDocument({
      company: { name: "شركة الاسناد لتجارة الهاتف النقال", tagline: "Mobile Phone Trading", footer: "Al-Esnad Company · alisnad.iq" },
      title: variant === "financial" ? "Detailed Financial Report" : "Device Price Catalogue",
      subtitle: "Test",
      generatedAt: "17 Nov 2026, 15:00",
      generatedBy: "Test User",
      scopeLabel: "3 selected devices",
      filters: ["Brand: Apple", "Brand: Samsung"],
      columns: columnsFor(variant, "IQD"),
      sections,
      grandTotals,
      totalRecords: rows.length,
      coverStats: coverStatsFor(variant, rows, money),
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
    const { sections } = buildSections(rows, "catalog", money, "Asia/Baghdad", true);
    expect(sections.map((s) => [s.brandName, s.rows.length])).toEqual([
      ["Apple", 2],
      ["Samsung", 1],
    ]);
  });

  it("computes exact per-brand and grand totals for the financial report", () => {
    const { sections, grandTotals } = buildSections(rows, "financial", money, "Asia/Baghdad", true);
    expect(sections[0].totals?.selling).toBe("6,228,000");
    expect(grandTotals?.selling).toBe("8,823,000");
    expect(grandTotals?.cost).toBe("8,668,000");
  });

  it("Viewer report cells contain only device, brand, category and selling price", () => {
    const cols = columnsFor("catalog", "IQD").map((c) => c.key);
    expect(cols).toEqual(["device", "brand", "category", "selling"]);
    const { sections } = buildSections(rows, "catalog", money, "Asia/Baghdad", true);
    const text = JSON.stringify(sections);
    for (const v of PRIVATE_VALUES) expect(text).not.toContain(v);
    expect(text).toContain("2,812,000");
    expect(JSON.stringify(coverStatsFor("catalog", rows, money))).not.toMatch(/2,800,000|2,762,000|50,000 /);
  });

  it("renders valid PDFs with private-data-free metadata", async () => {
    const outDir = path.join(process.env.REPORT_PREVIEW_DIR ?? path.join(import.meta.dirname, "../../.next/report-previews"));
    mkdirSync(outDir, { recursive: true });
    const financial = await render("financial", "landscape");
    const catalog = await render("catalog", "portrait");
    writeFileSync(path.join(outDir, "financial.pdf"), financial);
    writeFileSync(path.join(outDir, "catalog.pdf"), catalog);

    for (const pdf of [financial, catalog]) {
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      expect(pages).toBeGreaterThanOrEqual(3); // cover + one page per brand
    }
    // The document information dictionary of the Viewer PDF holds no amounts.
    const info = catalog.toString("latin1").match(/\/Title[\s\S]{0,400}/)?.[0] ?? "";
    for (const v of ["2800000", "2,800,000", "50000", "28000"]) expect(info).not.toContain(v);
  }, 30_000);
});
