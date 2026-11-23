"use client";

import { Check, Pencil, Plus, Printer, Search, Tags } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Option } from "@/features/devices/types";
import { ReportDialog } from "@/features/reports/components/report-dialog";
import { useI18n } from "@/lib/i18n/client";
import type { DataProjection } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand/brand-logo";
import { BrandFormDialog } from "./brand-form-dialog";

export type BrandCard = {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  color: string;
  rawColor: string | null;
  isActive: boolean;
  sortOrder: number;
  catalogCount: number;
  totalCount: number | null;
  pendingCount: number | null;
};

export function BrandsGrid({
  brands,
  canManage,
  canExport,
  canFinancial,
  projection,
}: {
  brands: BrandCard[];
  canManage: boolean;
  canExport: boolean;
  canFinancial: boolean;
  projection: DataProjection;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"all" | "active" | "inactive">("active");
  const [selected, setSelected] = useState<string[]>([]);
  const [printing, setPrinting] = useState(false);

  const visible = useMemo(
    () =>
      brands.filter(
        (b) =>
          b.name.toLowerCase().includes(query.trim().toLowerCase()) &&
          (state === "all" || (state === "active" ? b.isActive : !b.isActive)),
      ),
    [brands, query, state],
  );
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const options: Option[] = brands.map((b) => ({ id: b.id, name: b.name, color: b.color }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("brands.search")} className="h-10 bg-card ps-9" aria-label={t("brands.search")} />
        </div>
        {canManage ? (
          <ToggleGroup type="single" variant="outline" value={state} onValueChange={(v) => v && setState(v as typeof state)}>
            <ToggleGroupItem value="active">{t("common.active")}</ToggleGroupItem>
            <ToggleGroupItem value="inactive">{t("common.inactive")}</ToggleGroupItem>
            <ToggleGroupItem value="all">{t("common.all")}</ToggleGroupItem>
          </ToggleGroup>
        ) : null}
        <div className="ms-auto flex flex-wrap gap-2">
          {canExport ? (
            <Button variant="outline" disabled={!selected.length} onClick={() => setPrinting(true)}>
              <Printer />
              {selected.length ? t("brands.printSelected", { count: selected.length }) : t("brands.printSelectedEmpty")}
            </Button>
          ) : null}
          {canManage ? (
            <BrandFormDialog
              trigger={
                <Button>
                  <Plus /> {t("brands.newBrand")}
                </Button>
              }
            />
          ) : null}
        </div>
      </div>

      {visible.length === 0 ? (
        <Empty className="rounded-xl border border-dashed bg-card py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Tags />
            </EmptyMedia>
            <EmptyTitle>{brands.length ? t("brands.noneMatch") : t("brands.noneYet")}</EmptyTitle>
            <EmptyDescription>{brands.length ? t("brands.tryAnother") : canManage ? t("brands.createFirst") : t("brands.appearHere")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((b) => {
            const isSelected = selected.includes(b.id);
            return (
              <li
                key={b.id}
                className={cn(
                  "group relative overflow-hidden rounded-xl border bg-card shadow-card transition-colors hover:border-foreground/15",
                  isSelected && "border-brand/40 ring-2 ring-brand/15",
                  !b.isActive && "opacity-70",
                )}
              >
                <div className="h-1" style={{ backgroundColor: b.color }} />
                <div className="flex items-start gap-3 p-4">
                  <BrandLogo name={b.name} color={b.color} logoUrl={b.logoUrl} />

                  <div className="min-w-0 flex-1">
                    <Link href={`/brands/${b.id}`} className="font-heading font-semibold after:absolute after:inset-0 hover:underline">
                      {b.name}
                    </Link>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{b.description || (b.isActive ? t("brands.noDescription") : t("common.inactive"))}</p>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <span>
                        <span className="font-semibold tabular-nums">{b.catalogCount}</span> <span className="text-muted-foreground">{t("brands.inCatalogue")}</span>
                      </span>
                      {b.totalCount !== null ? (
                        <span>
                          <span className="font-semibold tabular-nums">{b.totalCount}</span> <span className="text-muted-foreground">{t("brands.total")}</span>
                        </span>
                      ) : null}
                      {b.pendingCount ? (
                        <span className="text-warning">
                          <span className="font-semibold tabular-nums">{b.pendingCount}</span> {t("brands.pending")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="relative z-10 flex flex-col gap-1">
                    {canExport ? (
                      <button
                        type="button"
                        onClick={() => toggle(b.id)}
                        aria-pressed={isSelected}
                        aria-label={t("brands.selectForPrint", { name: b.name })}
                        className={cn(
                          "flex size-7 items-center justify-center rounded-md border transition-colors",
                          isSelected ? "border-brand bg-brand text-brand-foreground" : "text-transparent hover:text-muted-foreground",
                        )}
                      >
                        <Check className="size-4" />
                      </button>
                    ) : null}
                    {canManage ? (
                      <BrandFormDialog
                        initial={{
                          id: b.id,
                          name: b.name,
                          description: b.description ?? "",
                          logoUrl: b.logoUrl ?? "",
                          accentColor: b.rawColor ?? b.color,
                          isActive: b.isActive,
                          sortOrder: b.sortOrder,
                        }}
                        trigger={
                          <button type="button" aria-label={`${t("common.edit")} ${b.name}`} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                            <Pencil className="size-3.5" />
                          </button>
                        }
                      />
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {printing ? (
        <ReportDialog
          open
          onOpenChange={(o) => !o && setPrinting(false)}
          initial={{ scope: "brands", variant: projection === "full" && canFinancial ? "financial" : "catalog", filters: {}, ids: [], brandIds: selected }}
          projection={projection}
          brands={options}
          canFinancial={canFinancial}
          filterChips={[]}
        />
      ) : null}
    </div>
  );
}
