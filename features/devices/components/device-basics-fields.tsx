"use client";

import { MetadataEditor, type MetadataEntry } from "@/components/forms/metadata-editor";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Option } from "@/features/devices/types";
import { useI18n } from "@/lib/i18n/client";

export type DeviceBasics = {
  name: string;
  brandId: string;
  categoryId: string;
  modelNumber: string;
  sku: string;
  metadata: MetadataEntry[];
};

export type FieldErrors = Record<string, string[] | undefined>;

/** Field errors are translation keys; this renders them in the current language. */
export function useFieldErrors(errors: FieldErrors | undefined) {
  const { tm } = useI18n();
  return (key: string) => {
    const list = errors?.[key];
    return list?.length ? list.map((message) => ({ message: tm(message) })) : undefined;
  };
}

/** Name, brand, category, identifiers and attributes — shared by every device form. */
export function DeviceBasicsFields({
  value,
  onChange,
  brands,
  categories,
  errors,
  disabled,
  showMetadata = true,
}: {
  value: DeviceBasics;
  onChange: (patch: Partial<DeviceBasics>) => void;
  brands: Option[];
  categories: Option[];
  errors?: FieldErrors;
  disabled?: boolean;
  showMetadata?: boolean;
}) {
  const { t } = useI18n();
  const errorsOf = useFieldErrors(errors);
  const optional = <span className="font-normal text-muted-foreground">({t("common.optional")})</span>;
  return (
    <FieldGroup className="gap-4">
      <Field data-invalid={Boolean(errors?.name)}>
        <FieldLabel htmlFor="device-name">{t("form.deviceName")}</FieldLabel>
        <Input
          id="device-name"
          value={value.name}
          maxLength={160}
          disabled={disabled}
          placeholder={t("form.deviceNamePlaceholder")}
          onChange={(e) => onChange({ name: e.target.value })}
          className="h-11"
          aria-invalid={Boolean(errors?.name) || undefined}
        />
        <FieldError errors={errorsOf("name")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={Boolean(errors?.brandId)}>
          <FieldLabel>{t("form.brand")}</FieldLabel>
          <Select value={value.brandId} onValueChange={(v) => onChange({ brandId: v })} disabled={disabled}>
            <SelectTrigger className="h-11 w-full" aria-invalid={Boolean(errors?.brandId) || undefined}>
              <SelectValue placeholder={t("form.chooseBrand")} />
            </SelectTrigger>
            <SelectContent>
              {brands.map((b) => (
                <SelectItem key={b.id} value={b.id} disabled={b.isActive === false}>
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: b.color }} />
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError errors={errorsOf("brandId")} />
        </Field>
        <Field data-invalid={Boolean(errors?.categoryId)}>
          <FieldLabel>{t("form.category")}</FieldLabel>
          <Select value={value.categoryId} onValueChange={(v) => onChange({ categoryId: v })} disabled={disabled}>
            <SelectTrigger className="h-11 w-full" aria-invalid={Boolean(errors?.categoryId) || undefined}>
              <SelectValue placeholder={t("form.chooseCategory")} />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id} disabled={c.isActive === false}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError errors={errorsOf("categoryId")} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="device-model">
            {t("form.modelNumber")} {optional}
          </FieldLabel>
          <Input id="device-model" dir="ltr" value={value.modelNumber} maxLength={64} disabled={disabled} onChange={(e) => onChange({ modelNumber: e.target.value })} />
        </Field>
        <Field>
          <FieldLabel htmlFor="device-sku">
            {t("form.sku")} {optional}
          </FieldLabel>
          <Input id="device-sku" dir="ltr" value={value.sku} maxLength={64} disabled={disabled} onChange={(e) => onChange({ sku: e.target.value })} />
        </Field>
      </div>
      {showMetadata ? (
        <Field data-invalid={Boolean(errors?.metadata)}>
          <FieldLabel>
            {t("form.attributes")} {optional}
          </FieldLabel>
          <FieldDescription>{t("form.attributesDesc")}</FieldDescription>
          <MetadataEditor entries={value.metadata} onChange={(metadata) => onChange({ metadata })} disabled={disabled} />
          <FieldError errors={errorsOf("metadata")} />
        </Field>
      ) : null}
    </FieldGroup>
  );
}
