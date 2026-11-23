"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, CircleAlert, DownloadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { previewErpImportAction, runErpImportAction, type ImportPlan, type ImportRow } from "@/features/devices/import-actions";
import { formatMoney, formatNumber, type MoneyFormat } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/**
 * "Import from ERPNext": reads the device Items of ERPNext with their purchase
 * price, sorts each into its brand and category, and shows what importing
 * would do. Nothing is written until the admin confirms; new devices arrive
 * as "pending review" with zero discount, payback and profit to be completed.
 */
export function ErpImportButton({ money }: { money: MoneyFormat }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="lg" variant="outline" onClick={() => setOpen(true)}>
        <DownloadCloud />
        {t("import.button")}
      </Button>
      {open ? <ErpImportDialog open onOpenChange={setOpen} money={money} /> : null}
    </>
  );
}

function ErpImportDialog({ open, onOpenChange, money }: { open: boolean; onOpenChange: (open: boolean) => void; money: MoneyFormat }) {
  const { t, tm } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [create, setCreate] = useState<Set<string>>(new Set());
  const [prices, setPrices] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    startLoading(async () => {
      const result = await previewErpImportAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPlan(result.data);
      setCreate(new Set(result.data.rows.filter((r) => r.kind === "new" || r.kind === "link").map((r) => r.code)));
    });
  }, []);

  const rows = plan?.rows ?? [];
  const of = (...kinds: ImportRow["kind"][]) => rows.filter((r) => kinds.includes(r.kind));
  const m = (v: number | null | undefined) => (v === null || v === undefined ? t("import.noPrice") : formatMoney(v, money));
  const chosen = create.size + prices.size;

  const run = () =>
    startSaving(async () => {
      const result = await runErpImportAction({ create: [...create], updatePrices: [...prices] });
      if (!result.ok) {
        toast.error(tm(result.error));
        return;
      }
      toast.success(t("import.done", result.data));
      await queryClient.invalidateQueries({ queryKey: ["devices"] });
      router.refresh();
      onOpenChange(false);
    });

  const toggle = (set: Set<string>, update: (s: Set<string>) => void, code: string) => {
    const next = new Set(set);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    update(next);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DownloadCloud className="size-4" /> {t("import.title")}
          </DialogTitle>
          <DialogDescription>
            {plan ? t("import.desc", { company: plan.company, groups: plan.groups.join("، "), list: plan.buyingList }) : t("import.descShort")}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner className="size-4" /> {t("import.loading")}
          </p>
        ) : null}
        {error ? (
          <p className="flex items-start gap-2 rounded-lg bg-destructive/8 px-3 py-2 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" /> {tm(error)}
          </p>
        ) : null}

        {plan ? (
          <div className="space-y-3 sm:max-h-[60dvh] sm:overflow-y-auto sm:pe-1">
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <Stat label={t("import.found")} value={rows.length} />
              <Stat label={t("import.new")} value={of("new").length} tone="text-brand" />
              <Stat label={t("import.linkable")} value={of("link").length} tone="text-brand" />
              <Stat label={t("import.upToDate")} value={of("up_to_date").length} tone="text-success" />
            </dl>

            <Section
              title={t("import.sectionNew", { count: of("new", "link").length })}
              hint={t("import.sectionNewHint")}
              rows={of("new", "link")}
              open
              render={(r) => (
                <Line
                  key={r.code}
                  checked={create.has(r.code)}
                  onToggle={() => toggle(create, setCreate, r.code)}
                  name={r.name}
                  code={r.code}
                  meta={`${r.brand} · ${t(`import.category.${r.category!}`)}${r.kind === "link" ? ` · ${t("import.willLink")}` : ""}`}
                  value={m(r.purchase)}
                  note={r.erpRate !== undefined ? t("import.rounded", { rate: String(r.erpRate) }) : undefined}
                />
              )}
              selectAll={(on) => setCreate(on ? new Set(of("new", "link").map((r) => r.code)) : new Set())}
              allSelected={of("new", "link").every((r) => create.has(r.code))}
            />
            <Section
              title={t("import.sectionPrices", { count: of("price_differs").length })}
              hint={t("import.sectionPricesHint")}
              rows={of("price_differs")}
              open
              render={(r) => (
                <Line
                  key={r.code}
                  checked={prices.has(r.code)}
                  onToggle={() => toggle(prices, setPrices, r.code)}
                  name={r.device?.name ?? r.name}
                  code={r.code}
                  meta={t("import.priceHere", { price: m(r.device?.purchase) })}
                  value={m(r.purchase)}
                />
              )}
              selectAll={(on) => setPrices(on ? new Set(of("price_differs").map((r) => r.code)) : new Set())}
              allSelected={of("price_differs").length > 0 && of("price_differs").every((r) => prices.has(r.code))}
            />
            <Section
              title={t("import.sectionAttention", { count: of("unknown", "brand_missing").length })}
              hint={t("import.sectionAttentionHint")}
              rows={of("unknown", "brand_missing")}
              open
              render={(r) => (
                <Line key={r.code} name={r.name} code={r.code} meta={r.kind === "brand_missing" ? t("import.brandMissing", { brand: r.brand ?? "" }) : t("import.unknownBrand")} value={m(r.purchase)} />
              )}
            />
            <Section
              title={t("import.sectionSkipped", { count: of("skip").length })}
              hint={t("import.sectionSkippedHint")}
              rows={of("skip")}
              render={(r) => <Line key={r.code} name={r.name} code={r.code} meta={t(`import.reason.${r.reason!}`)} value={m(r.purchase)} />}
            />
            <Section
              title={t("import.sectionLinked", { count: of("up_to_date").length })}
              rows={of("up_to_date")}
              render={(r) => <Line key={r.code} name={r.device?.name ?? r.name} code={r.code} meta={t("import.alreadyLinked")} value={m(r.purchase)} />}
            />

            {chosen ? (
              <label className="flex items-start gap-2.5 rounded-lg border border-brand/30 bg-brand-soft/50 px-3 py-2.5 text-sm">
                <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} className="mt-0.5" />
                <span>{t("import.confirm", { create: create.size, prices: prices.size })}</span>
              </label>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("common.cancel")}
          </Button>
          {plan ? (
            <Button onClick={run} disabled={!confirmed || !chosen || saving}>
              {saving ? <Spinner className="size-4" /> : <DownloadCloud />}
              {t("import.run", { count: chosen })}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <dt className="text-[0.7rem] text-muted-foreground">{label}</dt>
      <dd className={cn("text-base font-semibold tabular-nums", tone)}>{formatNumber(value)}</dd>
    </div>
  );
}

function Section({
  title,
  hint,
  rows,
  render,
  open: initiallyOpen = false,
  selectAll,
  allSelected,
}: {
  title: string;
  hint?: string;
  rows: ImportRow[];
  render: (row: ImportRow) => React.ReactNode;
  open?: boolean;
  selectAll?: (on: boolean) => void;
  allSelected?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(initiallyOpen);
  if (!rows.length) return null;
  return (
    <section className="rounded-lg border">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-start text-sm font-medium" onClick={() => setOpen(!open)} aria-expanded={open}>
          <ChevronDown className={cn("size-4 shrink-0 transition-transform", !open && "-rotate-90 rtl:rotate-90")} />
          <span className="truncate">{title}</span>
        </button>
        {selectAll ? (
          <Button size="xs" variant="ghost" onClick={() => selectAll(!allSelected)}>
            {allSelected ? t("import.selectNone") : t("import.selectAll")}
          </Button>
        ) : null}
      </div>
      {open ? (
        <>
          {hint ? <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">{hint}</p> : null}
          <ul className="divide-y border-t">{rows.map(render)}</ul>
        </>
      ) : null}
    </section>
  );
}

function Line({
  name,
  code,
  meta,
  value,
  note,
  checked,
  onToggle,
}: {
  name: string;
  code: string;
  meta: string;
  value: string;
  note?: string;
  checked?: boolean;
  onToggle?: () => void;
}) {
  const content = (
    <>
      {onToggle ? <Checkbox checked={checked} onCheckedChange={onToggle} className="mt-0.5" /> : null}
      <span className="min-w-0 flex-1">
        <span className="block font-medium break-words sm:truncate" dir="auto">
          {name}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          <span dir="ltr">{code}</span> · {meta}
        </span>
      </span>
      <span className="shrink-0 text-end">
        <span className="block font-semibold tabular-nums">{value}</span>
        {note ? <span className="block text-[0.68rem] text-muted-foreground">{note}</span> : null}
      </span>
    </>
  );
  return onToggle ? (
    <li>
      <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2 text-sm hover:bg-accent/50">{content}</label>
    </li>
  ) : (
    <li className="flex items-start gap-2.5 px-3 py-2 text-sm">{content}</li>
  );
}
