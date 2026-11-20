"use client";

import { Check, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { RECENT_WINDOWS, PRICE_FIELDS, type DeviceFilters, type PriceField, type RecentWindow } from "@/lib/filters/devices";
import { formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/core";
import { cn } from "@/lib/utils";
import type { DeviceStatus } from "@/types/database";

export type CountOption = { id: string; label: string; count?: number; color?: string };

const PRESETS: Array<{ key: MessageKey; min?: string; max?: string }> = [
  { key: "filters.presets.under500", max: "500000" },
  { key: "filters.presets.r500_1m", min: "500000", max: "1000000" },
  { key: "filters.presets.r1_2m", min: "1000000", max: "2000000" },
  { key: "filters.presets.r2_3m", min: "2000000", max: "3000000" },
  { key: "filters.presets.above3m", min: "3000000" },
];

const digits = (v: string) => v.replace(/[^\d.]/g, "");

/**
 * All filters in one side panel. Changes apply immediately (the table updates
 * behind the panel); the footer shows the live result count.
 */
export function FilterSheet({
  filters,
  onChange,
  onClear,
  brands,
  categories,
  statuses,
  showBrand,
  showPrice,
  showDate,
  showStatus,
  allowPrivateFields,
  currency,
  total,
  activeCount,
}: {
  filters: DeviceFilters;
  onChange: (patch: Partial<DeviceFilters>) => void;
  onClear: () => void;
  brands: CountOption[];
  categories: CountOption[];
  statuses: CountOption[];
  showBrand: boolean;
  showPrice: boolean;
  showDate: boolean;
  showStatus: boolean;
  allowPrivateFields: boolean;
  currency: string;
  total: number | null;
  activeCount: number;
}) {
  const { t, dir } = useI18n();
  const [open, setOpen] = useState(false);
  const invalidRange = Boolean(filters.priceMin && filters.priceMax && Number(filters.priceMin) > Number(filters.priceMax));

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className={cn("h-11 gap-2 bg-card px-4", activeCount > 0 && "border-brand/40 text-brand")}>
          <SlidersHorizontal className="size-4" />
          {t("filters.title")}
          {activeCount > 0 ? (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[0.7rem] text-brand-foreground">
              {activeCount}
            </span>
          ) : null}
        </Button>
      </SheetTrigger>
      <SheetContent side={dir === "rtl" ? "left" : "right"} className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>{t("filters.title")}</SheetTitle>
          <SheetDescription className="sr-only">{t("filters.title")}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-7 overflow-y-auto px-5 py-5">
          {showBrand && brands.length ? (
            <CheckList
              title={t("filters.brand")}
              options={brands}
              selected={filters.brandIds ?? []}
              onChange={(ids) => onChange({ brandIds: ids.length ? ids : undefined })}
              searchPlaceholder={t("filters.searchBrands")}
            />
          ) : null}

          {categories.length && showPrice ? (
            <CheckList
              title={t("filters.category")}
              options={categories}
              selected={filters.categoryIds ?? []}
              onChange={(ids) => onChange({ categoryIds: ids.length ? ids : undefined })}
              searchPlaceholder={t("filters.searchCategories")}
            />
          ) : null}

          {showStatus ? (
            <CheckList
              title={t("filters.status")}
              options={statuses}
              selected={filters.statuses ?? []}
              onChange={(ids) => onChange({ statuses: ids.length ? (ids as DeviceStatus[]) : undefined })}
            />
          ) : null}

          {showPrice ? (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">{t("filters.price")}</h3>
              {allowPrivateFields ? (
                <Select value={filters.priceField ?? "selling"} onValueChange={(v) => onChange({ priceField: v as PriceField })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRICE_FIELDS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {t(`priceField.${f}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <AmountBox label={t("filters.minimum")} value={filters.priceMin} placeholder="0" onChange={(v) => onChange({ priceMin: v || undefined })} />
                <AmountBox label={t("filters.maximum")} value={filters.priceMax} placeholder={t("filters.noLimit")} onChange={(v) => onChange({ priceMax: v || undefined })} />
              </div>
              {invalidRange ? <p className="text-xs text-destructive">{t("filters.minAboveMax")}</p> : null}
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => {
                  const active = (filters.priceMin ?? "") === (p.min ?? "") && (filters.priceMax ?? "") === (p.max ?? "");
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => onChange(active ? { priceMin: undefined, priceMax: undefined } : { priceMin: p.min, priceMax: p.max })}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition-colors",
                        active ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                      )}
                    >
                      {t(p.key)}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">{t("filters.amountsIn", { currency })}</p>
            </section>
          ) : null}

          {showDate ? (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">{t("filters.date")}</h3>
              <ToggleGroup
                type="single"
                variant="outline"
                className="w-full"
                value={filters.dateField ?? "created"}
                onValueChange={(v) => v && onChange({ dateField: v as "created" | "updated" })}
              >
                <ToggleGroupItem value="created" className="flex-1 text-xs">
                  {t("filters.recentlyAdded")}
                </ToggleGroupItem>
                <ToggleGroupItem value="updated" className="flex-1 text-xs">
                  {t("filters.recentlyUpdated")}
                </ToggleGroupItem>
              </ToggleGroup>
              <div className="flex flex-wrap gap-1.5">
                {RECENT_WINDOWS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() =>
                      onChange({ recent: filters.recent === w ? undefined : (w as RecentWindow), dateFrom: undefined, dateTo: undefined })
                    }
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      filters.recent === w ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                    )}
                  >
                    {t(`recent.${w}`)}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5 text-xs font-medium">
                  {t("filters.from")}
                  <Input type="date" value={filters.dateFrom ?? ""} onChange={(e) => onChange({ dateFrom: e.target.value || undefined, recent: undefined })} />
                </label>
                <label className="space-y-1.5 text-xs font-medium">
                  {t("filters.to")}
                  <Input type="date" value={filters.dateTo ?? ""} onChange={(e) => onChange({ dateTo: e.target.value || undefined, recent: undefined })} />
                </label>
              </div>
            </section>
          ) : null}
        </div>

        <SheetFooter className="flex-row gap-2 border-t px-5 py-4">
          <Button variant="ghost" className="flex-1" onClick={onClear}>
            {t("filters.clearAll")}
          </Button>
          <Button className="flex-1" onClick={() => setOpen(false)}>
            {total === null ? t("filters.showAll") : t("filters.showResults", { count: formatNumber(total) })}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function AmountBox({ label, value, placeholder, onChange }: { label: string; value?: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <label className="space-y-1.5 text-xs font-medium">
      {label}
      <Input
        inputMode="decimal"
        dir="ltr"
        placeholder={placeholder}
        value={value ? formatNumber(value) : ""}
        onChange={(e) => onChange(digits(e.target.value))}
        className="money"
      />
    </label>
  );
}

function CheckList({
  title,
  options,
  selected,
  onChange,
  searchPlaceholder,
}: {
  title: string;
  options: CountOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  searchPlaceholder?: string;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const set = useMemo(() => new Set(selected), [selected]);
  const visible = options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()));
  const all = options.length > 0 && options.every((o) => set.has(o.id));
  const toggle = (id: string) => onChange(set.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => onChange(all ? [] : options.map((o) => o.id))}>
          {all ? t("filters.clearSelection") : t("filters.selectAll")}
        </button>
      </div>
      {searchPlaceholder && options.length > 6 ? (
        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchPlaceholder} className="h-8 ps-8 text-xs" />
        </div>
      ) : null}
      <ul className="max-h-56 space-y-0.5 overflow-y-auto">
        {visible.map((o) => {
          const checked = set.has(o.id);
          return (
            <li key={o.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                onClick={() => toggle(o.id)}
                className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-start text-sm transition-colors hover:bg-accent", checked && "bg-accent")}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input",
                    checked && "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {checked ? <Check className="size-3" strokeWidth={3} /> : null}
                </span>
                {o.color ? <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: o.color }} /> : null}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.count !== undefined ? <span className="text-xs text-muted-foreground tabular-nums">{o.count}</span> : null}
              </button>
            </li>
          );
        })}
        {visible.length === 0 ? <li className="px-2 py-2 text-xs text-muted-foreground">{t("filters.noMatches")}</li> : null}
      </ul>
    </section>
  );
}
