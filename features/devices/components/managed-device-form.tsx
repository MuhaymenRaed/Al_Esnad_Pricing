"use client";

import { useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Calculator, CircleAlert, Equal, Minus, Plus as PlusIcon, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Money } from "@/components/common/money";
import { StatusBadge } from "@/components/common/status-badge";
import { MoneyInput } from "@/components/forms/money-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { saveDeviceAction, type SavedFinancials } from "@/features/devices/actions";
import type { Option } from "@/features/devices/types";
import { formatMoney, formatPercent, type MoneyFormat } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { calculatePricing, type DiscountType } from "@/lib/pricing/calculate";
import { cn } from "@/lib/utils";
import type { DeviceStatus } from "@/types/database";
import { DeviceBasicsFields, useFieldErrors, type DeviceBasics, type FieldErrors } from "./device-basics-fields";

export type ManagedDeviceInitial = {
  id?: string;
  updatedAt?: string;
  status: DeviceStatus;
  basics: DeviceBasics;
  financials: {
    officialPurchasePrice: string;
    discountType: DiscountType;
    discountValue: string;
    paybackAmount: string;
    companyProfit: string;
  };
};

export function ManagedDeviceForm({
  initial,
  brands,
  categories,
  money,
  canReview,
  readOnly,
}: {
  initial: ManagedDeviceInitial;
  brands: Option[];
  categories: Option[];
  money: MoneyFormat;
  canReview: boolean;
  readOnly: boolean;
}) {
  const { t, tm } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [basics, setBasics] = useState(initial.basics);
  const [fin, setFin] = useState(initial.financials);
  const [status, setStatus] = useState<DeviceStatus>(initial.status);
  const [updatedAt, setUpdatedAt] = useState(initial.updatedAt);
  const [errors, setErrors] = useState<FieldErrors>();
  const errorsOf = useFieldErrors(errors);
  const [verified, setVerified] = useState<SavedFinancials | null>(null);
  const [pending, startTransition] = useTransition();
  const isNew = !initial.id;

  const calc = useMemo(
    () =>
      calculatePricing(
        {
          officialPurchasePrice: fin.officialPurchasePrice,
          discountType: fin.discountType,
          discountValue: fin.discountValue,
          paybackAmount: fin.paybackAmount,
          companyProfit: fin.companyProfit,
        },
        money.decimals,
      ),
    [fin, money.decimals],
  );
  const blocking = calc.issues.filter((i) => i !== "price_required" || fin.officialPurchasePrice !== "");

  const statusOptions: DeviceStatus[] = isNew
    ? ["draft", "pending_review", "active"]
    : canReview
      ? ["draft", "pending_review", "active", "rejected", "archived"]
      : ["draft", "pending_review", "archived"];

  const submit = () => {
    setErrors(undefined);
    startTransition(async () => {
      const result = await saveDeviceAction({
        id: initial.id,
        expectedUpdatedAt: updatedAt,
        status,
        device: {
          name: basics.name,
          brandId: basics.brandId,
          categoryId: basics.categoryId,
          sku: basics.sku,
          modelNumber: basics.modelNumber,
          metadata: basics.metadata.filter((m) => m.key.trim()),
        },
        financials: {
          officialPurchasePrice: fin.officialPurchasePrice,
          discountType: fin.discountType,
          discountValue: fin.discountValue,
          paybackAmount: fin.paybackAmount,
          companyProfit: fin.companyProfit,
        },
      });
      if (!result.ok) {
        const flat: FieldErrors = {};
        for (const [k, v] of Object.entries(result.fieldErrors ?? {})) flat[k.split(".").pop()!] = v;
        setErrors(flat);
        toast.error(tm(result.error));
        return;
      }
      toast.success(tm(result.message ?? "common.saved"), {
        description: result.data.financials
          ? t("devices.toast.verified", { price: formatMoney(result.data.financials.finalSellingPrice, money) })
          : undefined,
      });
      setVerified(result.data.financials);
      setUpdatedAt(result.data.updatedAt);
      setStatus(result.data.status);
      await queryClient.invalidateQueries({ queryKey: ["devices"] });
      if (isNew) router.replace(`/devices/${result.data.id}`);
      else router.refresh();
    });
  };

  const disabled = readOnly || pending;

  return (
    <form
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"
      onSubmit={(e) => {
        e.preventDefault();
        if (!readOnly) submit();
      }}
      noValidate
    >
      <div className="space-y-6">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle>{t("form.deviceDetails")}</CardTitle>
            <CardDescription>{t("form.deviceDetailsDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <DeviceBasicsFields
              value={basics}
              onChange={(patch) => setBasics((b) => ({ ...b, ...patch }))}
              brands={brands}
              categories={categories}
              errors={errors}
              disabled={disabled}
            />
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader>
            <SectionTitle step="1" title={t("form.step1")} />
            <CardDescription>{t("form.step1Desc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Field data-invalid={Boolean(errors?.officialPurchasePrice) || undefined}>
              <FieldLabel htmlFor="purchase">{t("form.purchasePrice")}</FieldLabel>
              <MoneyInput
                id="purchase"
                value={fin.officialPurchasePrice}
                onChange={(v) => setFin((f) => ({ ...f, officialPurchasePrice: v }))}
                suffix={money.currency}
                decimals={money.decimals}
                disabled={disabled}
                invalid={Boolean(errors?.officialPurchasePrice)}
                placeholder="0"
              />
              <FieldError errors={errorsOf("officialPurchasePrice")} />
            </Field>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader>
            <SectionTitle step="2" title={t("form.step2")} />
            <CardDescription>{t("form.step2Desc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
              <Field>
                <FieldLabel>{t("form.discountType")}</FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={fin.discountType}
                  disabled={disabled}
                  onValueChange={(v) => v && setFin((f) => ({ ...f, discountType: v as DiscountType, discountValue: "" }))}
                >
                  <ToggleGroupItem value="percentage" className="px-4">
                    {t("form.percentage")}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="fixed" className="px-4">
                    {t("form.fixed")}
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <Field data-invalid={Boolean(errors?.discountValue) || undefined}>
                <FieldLabel htmlFor="discount">{t("form.discountValue")}</FieldLabel>
                {fin.discountType === "percentage" ? (
                  <InputGroup className="h-10 bg-card">
                    <InputGroupInput
                      id="discount"
                      inputMode="decimal"
                      dir="ltr"
                      value={fin.discountValue}
                      disabled={disabled}
                      placeholder="0"
                      onChange={(e) => setFin((f) => ({ ...f, discountValue: e.target.value.replace(/[^\d.]/g, "").slice(0, 8) }))}
                      className="money"
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>%</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                ) : (
                  <MoneyInput
                    id="discount"
                    value={fin.discountValue}
                    onChange={(v) => setFin((f) => ({ ...f, discountValue: v }))}
                    suffix={money.currency}
                    decimals={money.decimals}
                    disabled={disabled}
                    placeholder="0"
                  />
                )}
                <FieldError errors={errorsOf("discountValue")} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>{t("form.discountAmount")}</FieldLabel>
                <div className="flex h-10 items-center justify-between rounded-lg border border-dashed bg-muted/50 px-3">
                  <Money value={calc.discountAmount} format={money} />
                  <span className="truncate ps-2 text-xs text-muted-foreground">
                    {fin.discountType === "percentage" && fin.discountValue
                      ? t("form.percentOfPrice", { value: formatPercent(fin.discountValue || 0, 4) })
                      : t("form.calculated")}
                  </span>
                </div>
              </Field>
              <Field data-invalid={Boolean(errors?.paybackAmount) || undefined}>
                <FieldLabel htmlFor="payback">{t("form.payback")}</FieldLabel>
                <MoneyInput
                  id="payback"
                  value={fin.paybackAmount}
                  onChange={(v) => setFin((f) => ({ ...f, paybackAmount: v }))}
                  suffix={money.currency}
                  decimals={money.decimals}
                  disabled={disabled}
                  placeholder="0"
                />
                <FieldDescription>{t("form.paybackDesc")}</FieldDescription>
                <FieldError errors={errorsOf("paybackAmount")} />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader>
            <SectionTitle step="3" title={t("form.step3")} />
            <CardDescription>{t("form.step3Desc")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <EmphasisAmount label={t("form.finalCost")} hint={t("form.calculatedAutomatically")} value={calc.finalCostBeforeProfit} money={money} tone="gold" />
            <Field data-invalid={Boolean(errors?.companyProfit) || undefined}>
              <FieldLabel htmlFor="profit">{t("form.profit")}</FieldLabel>
              <MoneyInput
                id="profit"
                value={fin.companyProfit}
                onChange={(v) => setFin((f) => ({ ...f, companyProfit: v }))}
                suffix={money.currency}
                decimals={money.decimals}
                disabled={disabled}
                placeholder="0"
              />
              <FieldError errors={errorsOf("companyProfit")} />
            </Field>
            <EmphasisAmount label={t("form.sellingPrice")} hint={t("form.calculatedAutomatically")} value={calc.finalSellingPrice} money={money} tone="brand" />
          </CardContent>
        </Card>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Card className="overflow-hidden shadow-lift">
          <div className="flex items-center gap-2 border-b bg-[#1b1c20] px-5 py-3.5 text-white">
            <Calculator className="size-4 text-[#ff5f6e]" />
            <span className="font-heading text-sm font-semibold">{t("form.liveCalc")}</span>
            {verified ? (
              <span className="ms-auto flex items-center gap-1 text-[0.7rem] text-emerald-300">
                <BadgeCheck className="size-3.5" /> {t("form.verifiedByDb")}
              </span>
            ) : (
              <span className="ms-auto text-[0.7rem] text-white/60">{t("form.updatesAsYouType")}</span>
            )}
          </div>
          <CardContent className="space-y-1 pt-4 text-sm">
            <CalcLine label={t("form.purchasePrice")} value={calc.officialPurchasePrice} money={money} />
            <CalcLine
              label={fin.discountType === "percentage" ? t("form.discountPct", { value: fin.discountValue || 0 }) : t("form.discountFixed")}
              value={calc.discountAmount}
              money={money}
              op="minus"
            />
            <CalcLine label={t("form.payback")} value={calc.paybackAmount} money={money} op="minus" />
            <CalcLine label={t("form.finalCost")} value={calc.finalCostBeforeProfit} money={money} op="equal" strong tone="text-gold" />
            <CalcLine label={t("form.profit")} value={calc.companyProfit} money={money} op="plus" />
            <div className="mt-2 rounded-lg bg-brand-soft px-3 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold tracking-wide text-brand uppercase">{t("form.sellingPrice")}</span>
                {calc.marginPercent ? <span className="text-[0.7rem] text-brand/80">{t("form.margin", { value: calc.marginPercent })}</span> : null}
              </div>
              <Money value={calc.finalSellingPrice} format={money} className="mt-1 block text-2xl font-bold text-brand" />
            </div>
            {blocking.length ? (
              <ul className="mt-3 space-y-1.5" role="alert">
                {blocking.map((issue) => (
                  <li key={issue} className="flex items-start gap-2 text-xs text-destructive">
                    <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                    {t(`pricingIssues.${issue}`)}
                  </li>
                ))}
              </ul>
            ) : null}
            {verified && verified.finalSellingPrice !== calc.finalSellingPrice ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("form.lastSaved")} <Money value={verified.finalSellingPrice} format={money} />
              </p>
            ) : null}
            <p className="pt-3 text-[0.72rem] leading-relaxed text-muted-foreground">{t("form.previewNote")}</p>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardContent className="space-y-4 pt-5">
            <Field>
              <FieldLabel>{t("form.status")}</FieldLabel>
              <Select value={status} onValueChange={(v) => setStatus(v as DeviceStatus)} disabled={disabled}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      <StatusBadge status={s} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>{t(`form.statusHints.${status}`)}</FieldDescription>
            </Field>
            <Button type="submit" size="lg" className="h-11 w-full" disabled={disabled || blocking.length > 0}>
              {pending ? <Spinner /> : <Save />}
              {readOnly ? t("common.readOnlyPreview") : isNew ? t("form.createDevice") : t("common.saveChanges")}
            </Button>
            {!isNew ? (
              <Button type="button" variant="ghost" className="w-full" onClick={() => router.back()} disabled={pending}>
                {t("common.cancel")}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </aside>
    </form>
  );
}

function SectionTitle({ step, title }: { step: string; title: string }) {
  return (
    <CardTitle className="flex items-center gap-2.5">
      <span className="flex size-6 items-center justify-center rounded-full bg-charcoal text-xs font-semibold text-background">{step}</span>
      {title}
    </CardTitle>
  );
}

function EmphasisAmount({ label, hint, value, money, tone }: { label: string; hint: string; value: string; money: MoneyFormat; tone: "gold" | "brand" }) {
  return (
    <div className={cn("flex flex-col justify-center rounded-xl border px-4 py-3", tone === "gold" ? "border-gold/25 bg-gold-soft" : "border-brand/25 bg-brand-soft")}>
      <span className={cn("text-[0.72rem] font-semibold tracking-wide uppercase", tone === "gold" ? "text-gold" : "text-brand")}>{label}</span>
      <Money value={value} format={money} className={cn("mt-1 text-xl font-bold", tone === "gold" ? "text-gold" : "text-brand")} />
      <span className="mt-0.5 text-[0.7rem] text-muted-foreground">{hint}</span>
    </div>
  );
}

function CalcLine({
  label,
  value,
  money,
  op,
  strong,
  tone,
}: {
  label: string;
  value: string;
  money: MoneyFormat;
  op?: "minus" | "plus" | "equal";
  strong?: boolean;
  tone?: string;
}) {
  const Icon = op === "minus" ? Minus : op === "plus" ? PlusIcon : op === "equal" ? Equal : null;
  return (
    <div className={cn("flex items-center justify-between gap-3 py-1.5", op === "equal" && "mt-1 border-t pt-2.5")}>
      <span className={cn("flex items-center gap-2 text-muted-foreground", strong && "font-medium text-foreground")}>
        <span className="flex size-4 items-center justify-center">{Icon ? <Icon className="size-3.5" /> : null}</span>
        {label}
      </span>
      <Money value={value} format={money} className={cn(strong && "font-semibold", tone)} />
    </div>
  );
}
