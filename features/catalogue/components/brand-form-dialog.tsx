"use client";

import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveBrandAction } from "@/features/catalogue/actions";
import { BRAND_PALETTE } from "@/lib/brand-colors";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export type BrandFormValue = {
  id?: string;
  name: string;
  description: string;
  logoUrl: string;
  accentColor: string;
  isActive: boolean;
  sortOrder: number;
};

export function BrandFormDialog({ trigger, initial }: { trigger: ReactNode; initial?: BrandFormValue }) {
  const { t, tm } = useI18n();
  const [open, setOpen] = useState(false);
  const blank: BrandFormValue = { name: "", description: "", logoUrl: "", accentColor: BRAND_PALETTE[0], isActive: true, sortOrder: 0 };
  const [value, setValue] = useState<BrandFormValue>(initial ?? blank);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>();
  const [pending, startTransition] = useTransition();
  const set = (patch: Partial<BrandFormValue>) => setValue((v) => ({ ...v, ...patch }));
  const err = (k: string) => (errors?.[k]?.length ? errors[k]!.map((m) => ({ message: tm(m) })) : undefined);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setValue(initial ?? blank);
          setErrors(undefined);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial?.id ? t("brands.editBrand") : t("brands.newBrand")}</DialogTitle>
          <DialogDescription>{t("brands.formDesc")}</DialogDescription>
        </DialogHeader>
        <form
          id="brand-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await saveBrandAction({
                ...value,
                description: value.description,
                logoUrl: value.logoUrl,
              });
              if (!result.ok) {
                setErrors(result.fieldErrors);
                toast.error(tm(result.error));
                return;
              }
              toast.success(result.message ? tm(result.message) : t("common.saved"));
              setOpen(false);
            });
          }}
        >
          <FieldGroup className="gap-4">
            <Field data-invalid={Boolean(errors?.name) || undefined}>
              <FieldLabel htmlFor="brand-name">{t("brands.name")}</FieldLabel>
              <Input id="brand-name" value={value.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} autoFocus />
              <FieldError errors={err("name")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="brand-description">{t("brands.description")}</FieldLabel>
              <Textarea id="brand-description" rows={3} value={value.description} maxLength={1000} onChange={(e) => set({ description: e.target.value })} />
            </Field>
            <Field data-invalid={Boolean(errors?.logoUrl) || undefined}>
              <FieldLabel htmlFor="brand-logo">{t("brands.logoUrl")}</FieldLabel>
              <Input id="brand-logo" type="url" dir="ltr" placeholder="https://…" value={value.logoUrl} onChange={(e) => set({ logoUrl: e.target.value })} />
              <FieldDescription>{t("brands.logoHint")}</FieldDescription>
              <FieldError errors={err("logoUrl")} />
            </Field>
            <Field data-invalid={Boolean(errors?.accentColor) || undefined}>
              <FieldLabel>{t("brands.accentColor")}</FieldLabel>
              <div className="flex flex-wrap items-center gap-2">
                {BRAND_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => set({ accentColor: c })}
                    aria-label={c}
                    className={cn(
                      "size-7 rounded-full ring-offset-2 ring-offset-background transition",
                      value.accentColor.toLowerCase() === c.toLowerCase() && "ring-2 ring-foreground",
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <Input
                  aria-label={t("brands.accentColor")}
                  dir="ltr"
                  value={value.accentColor}
                  onChange={(e) => set({ accentColor: e.target.value })}
                  className="h-8 w-28 font-mono text-xs"
                />
              </div>
              <FieldDescription>{t("brands.accentHint")}</FieldDescription>
              <FieldError errors={err("accentColor")} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="brand-order">{t("brands.order")}</FieldLabel>
                <Input id="brand-order" type="number" min={0} value={value.sortOrder} onChange={(e) => set({ sortOrder: Number(e.target.value) || 0 })} />
              </Field>
              <Field orientation="horizontal" className="items-end justify-between">
                <FieldLabel htmlFor="brand-active">{t("brands.active")}</FieldLabel>
                <Switch id="brand-active" checked={value.isActive} onCheckedChange={(v) => set({ isActive: v })} />
              </Field>
            </div>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="brand-form" disabled={pending}>
            {pending ? <Spinner /> : null}
            {initial?.id ? t("brands.saveBrand") : t("brands.createBrand")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
