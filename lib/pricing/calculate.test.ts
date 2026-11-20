import { describe, expect, it } from "vitest";
import { calculatePricing, parseAmount, sumAmounts } from "./calculate";

describe("calculatePricing", () => {
  it("reproduces the iPhone 18 reference example", () => {
    const r = calculatePricing({
      officialPurchasePrice: "2,800,000",
      discountType: "percentage",
      discountValue: "1",
      paybackAmount: "10,000",
      companyProfit: "50000",
    });
    expect(r).toMatchObject({
      officialPurchasePrice: "2800000",
      discountAmount: "28000",
      finalCostBeforeProfit: "2762000",
      finalSellingPrice: "2812000",
      issues: [],
    });
  });

  it("handles fixed discounts", () => {
    const r = calculatePricing({
      officialPurchasePrice: 1500000,
      discountType: "fixed",
      discountValue: 75000,
      paybackAmount: 5000,
      companyProfit: 40000,
    });
    expect(r.finalCostBeforeProfit).toBe("1420000");
    expect(r.finalSellingPrice).toBe("1460000");
  });

  it("matches the database rounding (half away from zero, 0 dp for IQD)", () => {
    expect(
      calculatePricing({ officialPurchasePrice: 1234567, discountType: "percentage", discountValue: 2.5, paybackAmount: 0, companyProfit: 0 })
        .discountAmount,
    ).toBe("30864");
    expect(
      calculatePricing({ officialPurchasePrice: 999, discountType: "percentage", discountValue: 50, paybackAmount: 0, companyProfit: 0 })
        .discountAmount,
    ).toBe("500");
  });

  it("does not suffer from floating point errors", () => {
    const r = calculatePricing(
      { officialPurchasePrice: "0.3", discountType: "fixed", discountValue: "0.1", paybackAmount: "0.1", companyProfit: "0" },
      2,
    );
    expect(r.finalCostBeforeProfit).toBe("0.10");
  });

  it("supports currencies with minor units", () => {
    const r = calculatePricing(
      { officialPurchasePrice: "100.005", discountType: "percentage", discountValue: "10", paybackAmount: "1.115", companyProfit: "2" },
      2,
    );
    expect(r.officialPurchasePrice).toBe("100.01");
    expect(r.discountAmount).toBe("10.00");
    expect(r.paybackAmount).toBe("1.12");
    expect(r.finalSellingPrice).toBe("90.89");
  });

  it("reports validation issues", () => {
    const base = { officialPurchasePrice: "1000", discountType: "percentage" as const, paybackAmount: "0", companyProfit: "0" };
    expect(calculatePricing({ ...base, discountValue: "120" }).issues).toContain("percentage_over_100");
    expect(calculatePricing({ ...base, discountType: "fixed", discountValue: "1001" }).issues).toContain(
      "discount_exceeds_price",
    );
    expect(calculatePricing({ ...base, discountValue: "50", paybackAmount: "600" }).issues).toContain(
      "benefits_exceed_price",
    );
    expect(calculatePricing({ ...base, discountValue: "-1" }).issues).toContain("negative");
    expect(calculatePricing({ ...base, officialPurchasePrice: "", discountValue: "0" }).issues).toContain("price_required");
    expect(calculatePricing({ ...base, officialPurchasePrice: "12a", discountValue: "0" }).issues).toContain("invalid_number");
  });

  it("computes the profit margin", () => {
    const r = calculatePricing({ officialPurchasePrice: "900", discountType: "fixed", discountValue: "0", paybackAmount: "0", companyProfit: "100" });
    expect(r.marginPercent).toBe("10.00");
  });
});

describe("parseAmount / sumAmounts", () => {
  it("accepts thousand separators and Arabic separators", () => {
    expect(parseAmount("2,812,000")?.toString()).toBe("2812000");
    expect(parseAmount("12٬500٫5")?.toString()).toBe("12500.5");
    expect(parseAmount("  ")).toBeNull();
  });

  it("sums exactly", () => {
    expect(sumAmounts(["0.1", "0.2", null, 0.3], 1)).toBe("0.6");
    expect(sumAmounts(["2812000", "1460000"])).toBe("4272000");
  });
});
