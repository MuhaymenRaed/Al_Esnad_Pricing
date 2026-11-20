import Decimal from "decimal.js";

/**
 * Pricing formulas — the single TypeScript implementation, used for the live
 * preview in forms. The database trigger `private.compute_device_financials`
 * is the authoritative implementation; both round half away from zero to the
 * currency's minor unit and are covered by matching tests.
 *
 *   Discount Amount = Price × Discount% ÷ 100   (percentage)
 *                   = Fixed discount            (fixed)
 *   Final Cost      = Price − Discount Amount − Payback
 *   Selling Price   = Final Cost + Company Profit
 */

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type DiscountType = "percentage" | "fixed";

export type PricingInput = {
  officialPurchasePrice: string | number | null | undefined;
  discountType: DiscountType;
  discountValue: string | number | null | undefined;
  paybackAmount: string | number | null | undefined;
  companyProfit: string | number | null | undefined;
};

export type PricingIssue =
  | "price_required"
  | "invalid_number"
  | "negative"
  | "percentage_over_100"
  | "discount_exceeds_price"
  | "benefits_exceed_price";

export type PricingResult = {
  officialPurchasePrice: string;
  discountAmount: string;
  paybackAmount: string;
  finalCostBeforeProfit: string;
  companyProfit: string;
  finalSellingPrice: string;
  /** Profit as % of selling price, 2 dp. Null when the selling price is 0. */
  marginPercent: string | null;
  issues: PricingIssue[];
};

/** Parses user input ("2,800,000", " 1.5 ") into a Decimal, or null when blank. */
export function parseAmount(value: string | number | null | undefined): Decimal | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("invalid_number");
    return new D(value);
  }
  const cleaned = value.replace(/[,\s٬،]/g, "").replace(/٫/g, ".");
  if (cleaned === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) throw new Error("invalid_number");
  return new D(cleaned);
}

export function calculatePricing(input: PricingInput, currencyDecimals = 0): PricingResult {
  const issues = new Set<PricingIssue>();
  const read = (v: PricingInput[keyof PricingInput] & unknown) => {
    try {
      return parseAmount(v as string);
    } catch {
      issues.add("invalid_number");
      return null;
    }
  };

  const priceRaw = read(input.officialPurchasePrice);
  if (priceRaw === null && !issues.has("invalid_number")) issues.add("price_required");
  const discountRaw = read(input.discountValue) ?? new D(0);
  const paybackRaw = read(input.paybackAmount) ?? new D(0);
  const profitRaw = read(input.companyProfit) ?? new D(0);
  const priceInput = priceRaw ?? new D(0);

  if ([priceInput, discountRaw, paybackRaw, profitRaw].some((d) => d.isNegative())) issues.add("negative");

  const round = (d: Decimal) => d.toDecimalPlaces(currencyDecimals, Decimal.ROUND_HALF_UP);
  const price = round(priceInput);
  const payback = round(paybackRaw);
  const profit = round(profitRaw);

  let discountAmount: Decimal;
  if (input.discountType === "percentage") {
    if (discountRaw.greaterThan(100)) issues.add("percentage_over_100");
    discountAmount = round(price.times(discountRaw.toDecimalPlaces(4, Decimal.ROUND_HALF_UP)).dividedBy(100));
  } else {
    discountAmount = round(discountRaw);
  }

  if (discountAmount.greaterThan(price)) issues.add("discount_exceeds_price");
  const finalCost = price.minus(discountAmount).minus(payback);
  if (finalCost.isNegative() && !issues.has("discount_exceeds_price")) issues.add("benefits_exceed_price");
  const selling = finalCost.plus(profit);

  const margin = selling.greaterThan(0) ? profit.times(100).dividedBy(selling).toDecimalPlaces(2) : null;

  const fixed = (d: Decimal) => d.toFixed(currencyDecimals);
  return {
    officialPurchasePrice: fixed(price),
    discountAmount: fixed(discountAmount),
    paybackAmount: fixed(payback),
    finalCostBeforeProfit: fixed(finalCost),
    companyProfit: fixed(profit),
    finalSellingPrice: fixed(selling),
    marginPercent: margin ? margin.toFixed(2) : null,
    issues: [...issues],
  };
}

export const PRICING_ISSUE_MESSAGES: Record<PricingIssue, string> = {
  price_required: "Enter the official purchase price.",
  invalid_number: "Use digits only (thousand separators are fine).",
  negative: "Amounts cannot be negative.",
  percentage_over_100: "A percentage discount cannot exceed 100%.",
  discount_exceeds_price: "The discount cannot exceed the official purchase price.",
  benefits_exceed_price: "Discount plus payback cannot exceed the official purchase price.",
};

/** Sums money strings exactly (for report totals). */
export function sumAmounts(values: Array<string | number | null | undefined>, decimals = 0): string {
  return values
    .reduce<Decimal>((acc, v) => (v === null || v === undefined || v === "" ? acc : acc.plus(new D(v))), new D(0))
    .toFixed(decimals);
}
