import { z } from "zod";
import { deviceFiltersSchema } from "@/lib/filters/devices";
import { parseAmount } from "@/lib/pricing/calculate";

/**
 * Input schemas shared by client forms and server actions. Messages are
 * translation keys (see messages/en.ts → validation.*); the UI translates them.
 * Server actions always re-validate, and the database enforces the same rules.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "validation.tooLong")
    .optional()
    .transform((v) => (v ? v : undefined));

const httpsUrl = z
  .string()
  .trim()
  .max(500, "validation.tooLong")
  .optional()
  .transform((v) => v || undefined)
  .pipe(z.url({ protocol: /^https$/, message: "validation.httpsUrl" }).optional());

/** A non-negative money string; thousand separators allowed. */
export const moneyString = ({ required = true } = {}) =>
  z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      if (!value) {
        if (required) ctx.addIssue({ code: "custom", message: "validation.amountRequired" });
        return;
      }
      try {
        const d = parseAmount(value);
        if (!d) return;
        if (d.isNegative()) ctx.addIssue({ code: "custom", message: "validation.amountNegative" });
        if (d.greaterThan("9999999999999")) ctx.addIssue({ code: "custom", message: "validation.amountTooLarge" });
        if (d.decimalPlaces() > 3) ctx.addIssue({ code: "custom", message: "validation.amountDecimals" });
      } catch {
        ctx.addIssue({ code: "custom", message: "validation.amountNumber" });
      }
    })
    .transform((v) => (v ? parseAmount(v)!.toFixed() : ""));

export const metadataEntriesSchema = z
  .array(
    z.object({
      key: z.string().trim().min(1, "validation.attrKey").max(40, "validation.tooLong").regex(/^[\p{L}\p{N} _.-]+$/u, "validation.attrChars"),
      value: z.string().trim().max(200, "validation.tooLong"),
    }),
  )
  .max(20, "validation.attrMax")
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    entries.forEach((e, i) => {
      const k = e.key.toLowerCase();
      if (seen.has(k)) ctx.addIssue({ code: "custom", message: "validation.attrDuplicate", path: [i, "key"] });
      seen.add(k);
    });
  });

export function entriesToMetadata(entries: z.infer<typeof metadataEntriesSchema>) {
  return Object.fromEntries(entries.filter((e) => e.key).map((e) => [e.key, e.value]));
}

export function metadataToEntries(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  return Object.entries(metadata as Record<string, unknown>).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
}

export const deviceBasicsSchema = z.object({
  name: z.string().trim().min(1, "validation.deviceNameRequired").max(160, "validation.tooLong"),
  brandId: z.uuid("validation.chooseBrand"),
  categoryId: z.uuid("validation.chooseCategory"),
  sku: optionalText(64),
  modelNumber: optionalText(64),
  metadata: metadataEntriesSchema.default([]),
});

/** Data Entry Operator form — no discount, payback or profit fields exist at all. */
export const deviceSubmissionSchema = deviceBasicsSchema.extend({
  officialPurchasePrice: moneyString(),
});
export type DeviceSubmissionInput = z.input<typeof deviceSubmissionSchema>;

export const financialsSchema = z
  .object({
    officialPurchasePrice: moneyString(),
    discountType: z.enum(["percentage", "fixed"]),
    discountValue: moneyString({ required: false }),
    paybackAmount: moneyString({ required: false }),
    companyProfit: moneyString({ required: false }),
  })
  .superRefine((v, ctx) => {
    const price = parseAmount(v.officialPurchasePrice);
    const discount = parseAmount(v.discountValue || "0")!;
    const payback = parseAmount(v.paybackAmount || "0")!;
    if (!price) return;
    if (v.discountType === "percentage" && discount.greaterThan(100)) {
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: "validation.pctOver100" });
      return;
    }
    const discountAmount = v.discountType === "percentage" ? price.times(discount).dividedBy(100) : discount;
    if (discountAmount.greaterThan(price)) {
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: "validation.discountOverPrice" });
    } else if (discountAmount.plus(payback).greaterThan(price)) {
      ctx.addIssue({ code: "custom", path: ["paybackAmount"], message: "validation.benefitsOverPrice" });
    }
  });

export const managedDeviceSchema = z.object({
  id: z.uuid().optional(),
  expectedUpdatedAt: z.string().optional(),
  status: z.enum(["draft", "pending_review", "active", "rejected", "archived"]),
  device: deviceBasicsSchema,
  financials: financialsSchema,
});
export type ManagedDeviceInput = z.input<typeof managedDeviceSchema>;

export const brandSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "validation.nameRequired").max(80, "validation.tooLong"),
  description: optionalText(1000),
  logoUrl: httpsUrl,
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "validation.hexColor"),
  isActive: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(10000),
});
export type BrandInput = z.input<typeof brandSchema>;

export const categorySchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "validation.nameRequired").max(80, "validation.tooLong"),
  description: optionalText(1000),
  isActive: z.boolean(),
});
export type CategoryInput = z.input<typeof categorySchema>;

export const roleSchema = z.enum(["administrator", "pricing_manager", "viewer", "data_entry"]);

export const passwordRules = z
  .string()
  .min(10, "validation.passwordMin")
  .max(72, "validation.passwordMax")
  .regex(/[a-z]/, "validation.passwordLower")
  .regex(/[A-Z]/, "validation.passwordUpper")
  .regex(/\d/, "validation.passwordNumber");

export const inviteSchema = z.object({
  email: z.email("validation.email").max(254, "validation.tooLong").transform((v) => v.toLowerCase()),
  fullName: optionalText(120),
  role: roleSchema,
});
export type InviteInput = z.input<typeof inviteSchema>;

/** Admin creates an account directly with a password (no e-mail needed). */
export const createUserSchema = inviteSchema.extend({ password: passwordRules });
export type CreateUserInput = z.input<typeof createUserSchema>;

export const companySettingsSchema = z.object({
  companyName: z.string().trim().min(1, "validation.nameRequired").max(120, "validation.tooLong"),
  companyTagline: optionalText(200),
  companyLogoUrl: httpsUrl,
  currencyCode: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "validation.currencyCode"),
  currencyDecimals: z.coerce.number().int().min(0).max(4),
  timezone: z.string().trim().min(1, "validation.required").max(64).refine(isValidTimeZone, "validation.timezone"),
  defaultLocale: z.enum(["en", "ar"]),
  reportFooter: optionalText(300),
  idleTimeoutMinutes: z.coerce.number().int().min(5).max(1440),
});
export type CompanySettingsInput = z.input<typeof companySettingsSchema>;

function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const passwordSchema = z
  .object({ password: passwordRules, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "validation.passwordMatch" });

export const loginSchema = z.object({
  email: z.email("validation.email"),
  password: z.string().min(1, "validation.passwordRequired"),
});

export const REPORT_SCOPES = ["filtered", "selected", "brands", "all"] as const;
export const REPORT_VARIANTS = ["catalog", "financial", "submissions"] as const;
export type ReportScope = (typeof REPORT_SCOPES)[number];
export type ReportVariant = (typeof REPORT_VARIANTS)[number];

export const reportRequestSchema = z
  .object({
    scope: z.enum(REPORT_SCOPES),
    variant: z.enum(REPORT_VARIANTS),
    filters: deviceFiltersSchema.default({}),
    ids: z.array(z.uuid()).max(5000).optional(),
    brandIds: z.array(z.uuid()).max(500).optional(),
    orientation: z.enum(["portrait", "landscape"]).default("portrait"),
    title: z.string().trim().max(120).optional(),
    groupByBrand: z.boolean().default(true),
    includeCover: z.boolean().default(true),
    brandPageBreaks: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.scope === "selected" && !v.ids?.length) {
      ctx.addIssue({ code: "custom", path: ["ids"], message: "validation.selectDevices" });
    }
    if (v.scope === "brands" && !v.brandIds?.length) {
      ctx.addIssue({ code: "custom", path: ["brandIds"], message: "validation.chooseBrands" });
    }
  });
export type ReportRequest = z.input<typeof reportRequestSchema>;
