"use client";

import { CheckCircle2, ClipboardList, ListChecks, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { MoneyInput } from "@/components/forms/money-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { submitDeviceAction, updateSubmissionAction } from "@/features/devices/actions";
import type { Option } from "@/features/devices/types";
import type { MoneyFormat } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { DeviceBasicsFields, useFieldErrors, type DeviceBasics, type FieldErrors } from "./device-basics-fields";

const EMPTY: DeviceBasics = { name: "", brandId: "", categoryId: "", modelNumber: "", sku: "", metadata: [] };

/**
 * Data Entry Operator form. It intentionally has NO discount, payback or
 * profit fields — and the server action / database RPC accept none.
 */
export function SubmissionForm({
  brands,
  categories,
  money,
  readOnly,
  editId,
  initial,
}: {
  brands: Option[];
  categories: Option[];
  money: MoneyFormat;
  readOnly: boolean;
  editId?: string;
  initial?: DeviceBasics;
}) {
  const { t, tm } = useI18n();
  const router = useRouter();
  const [basics, setBasics] = useState<DeviceBasics>(initial ?? EMPTY);
  const [price, setPrice] = useState("");
  const [errors, setErrors] = useState<FieldErrors>();
  const errorsOf = useFieldErrors(errors);
  const [submitted, setSubmitted] = useState<{ name: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const disabled = readOnly || pending;

  const submit = () => {
    setErrors(undefined);
    startTransition(async () => {
      const payload = {
        name: basics.name,
        brandId: basics.brandId,
        categoryId: basics.categoryId,
        sku: basics.sku,
        modelNumber: basics.modelNumber,
        metadata: basics.metadata.filter((m) => m.key.trim()),
        officialPurchasePrice: price,
      };
      const result = editId ? await updateSubmissionAction(editId, payload) : await submitDeviceAction(payload);
      if (!result.ok) {
        setErrors(result.fieldErrors);
        toast.error(tm(result.error));
        return;
      }
      toast.success(tm(result.message ?? "common.saved"));
      if (editId) {
        router.push("/devices");
        return;
      }
      setSubmitted({ name: basics.name });
      setBasics((b) => ({ ...EMPTY, brandId: b.brandId, categoryId: b.categoryId }));
      setPrice("");
    });
  };

  if (submitted) {
    return (
      <Card className="mx-auto max-w-xl text-center shadow-lift">
        <CardContent className="space-y-5 py-10">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-success-soft text-success">
            <CheckCircle2 className="size-7" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-xl font-semibold">{t("form.submittedTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("form.submittedBody", { name: submitted.name })}</p>
          </div>
          <div className="flex flex-col justify-center gap-2 sm:flex-row">
            <Button onClick={() => setSubmitted(null)}>
              <ClipboardList />
              {t("form.submitAnother")}
            </Button>
            <Button variant="outline" asChild>
              <Link href="/devices">
                <ListChecks />
                {t("form.viewSubmissions")}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <form
      className="mx-auto max-w-3xl"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!readOnly) submit();
      }}
    >
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>{editId ? t("form.editSubmission") : t("form.newDevice")}</CardTitle>
          <CardDescription>{t("form.submissionDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <DeviceBasicsFields
            value={basics}
            onChange={(patch) => setBasics((b) => ({ ...b, ...patch }))}
            brands={brands}
            categories={categories}
            errors={errors}
            disabled={disabled}
          />
          <Field data-invalid={Boolean(errors?.officialPurchasePrice) || undefined}>
            <FieldLabel htmlFor="purchase">{t("form.purchasePrice")}</FieldLabel>
            <MoneyInput
              id="purchase"
              value={price}
              onChange={setPrice}
              suffix={money.currency}
              decimals={money.decimals}
              disabled={disabled}
              invalid={Boolean(errors?.officialPurchasePrice)}
              placeholder="0"
            />
            <FieldDescription>{t("form.priceHiddenNote")}</FieldDescription>
            <FieldError errors={errorsOf("officialPurchasePrice")} />
          </Field>
          <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" asChild>
              <Link href="/devices">{t("common.cancel")}</Link>
            </Button>
            <Button type="submit" size="lg" disabled={disabled}>
              {pending ? <Spinner /> : <Send className="rtl:rotate-180" />}
              {readOnly ? t("common.readOnlyPreview") : editId ? t("form.saveResubmit") : t("form.submitForReview")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
