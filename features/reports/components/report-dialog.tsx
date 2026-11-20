"use client";

import { AlertTriangle, Download, ExternalLink, FileText, LoaderCircle, Printer, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { MultiSelectFilter } from "@/components/filters/multi-select-filter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Option } from "@/features/devices/types";
import type { DeviceFilters } from "@/lib/filters/devices";
import { useI18n } from "@/lib/i18n/client";
import type { DataProjection } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { ReportScope, ReportVariant } from "@/lib/validation/schemas";

export type ReportDialogConfig = {
  scope: ReportScope;
  variant: ReportVariant;
  filters: DeviceFilters;
  ids: string[];
  brandIds: string[];
};

type Result = { url: string; pages: number; records: number; truncated: boolean; filename: string };

export function ReportDialog({
  open,
  onOpenChange,
  initial,
  projection,
  brands,
  canFinancial,
  filterChips,
  lockedBrandId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: ReportDialogConfig;
  projection: DataProjection;
  brands: Option[];
  canFinancial: boolean;
  filterChips: string[];
  lockedBrandId?: string;
}) {
  const { t, tm } = useI18n();
  const [scope, setScope] = useState<ReportScope>(initial.scope);
  const [variant, setVariant] = useState<ReportVariant>(initial.variant);
  const [brandIds, setBrandIds] = useState<string[]>(initial.brandIds);
  const [orientation, setOrientation] = useState<"portrait" | "landscape">(initial.variant === "financial" ? "landscape" : "portrait");
  const [title, setTitle] = useState("");
  const [includeCover, setIncludeCover] = useState(true);
  const [brandPageBreaks, setBrandPageBreaks] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => () => (result ? URL.revokeObjectURL(result.url) : undefined), [result]);

  const variants = useMemo(() => {
    if (projection === "full") return (canFinancial ? ["financial", "catalog"] : ["catalog"]) as ReportVariant[];
    return [projection] as ReportVariant[];
  }, [projection, canFinancial]);

  const scopes: ReportScope[] =
    projection === "submissions" ? ["filtered", "selected"] : lockedBrandId ? ["filtered", "selected", "brands"] : ["filtered", "selected", "brands", "all"];

  const invalid =
    (scope === "selected" && initial.ids.length === 0) || (scope === "brands" && brandIds.length === 0);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope,
          variant,
          filters: initial.filters,
          ids: scope === "selected" ? initial.ids : undefined,
          brandIds: scope === "brands" ? brandIds : undefined,
          orientation,
          title: title.trim() || undefined,
          includeCover,
          brandPageBreaks,
          groupByBrand: true,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(tm(typeof body.error === "string" ? body.error : "reports.failed"));
      }
      const blob = await response.blob();
      if (result) URL.revokeObjectURL(result.url);
      setResult({
        url: URL.createObjectURL(blob),
        pages: Number(response.headers.get("x-report-pages") ?? 0),
        records: Number(response.headers.get("x-report-records") ?? 0),
        truncated: response.headers.get("x-report-truncated") === "1",
        filename: response.headers.get("x-report-filename") ?? "report.pdf",
      });
    } catch (e) {
      // fetch() rejects with a TypeError when the network is unreachable.
      const message = e instanceof TypeError ? t("errors.network") : (e as Error).message;
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const print = () => {
    const frame = iframeRef.current;
    try {
      frame?.contentWindow?.focus();
      frame?.contentWindow?.print();
    } catch {
      if (result) window.open(result.url, "_blank", "noopener");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] w-[min(1200px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5 text-brand" />
            {t("reports.dialogTitle")}
          </DialogTitle>
          <DialogDescription>{t("reports.dialogDesc")}</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 md:grid-cols-[340px_minmax(0,1fr)]">
          <div className="min-h-0 space-y-5 overflow-y-auto border-b p-5 md:border-e md:border-b-0">
            {variants.length > 1 ? (
              <Field>
                <FieldLabel>{t("reports.type")}</FieldLabel>
                <ToggleGroup type="single" variant="outline" value={variant} onValueChange={(v) => v && setVariant(v as ReportVariant)} className="w-full">
                  {variants.map((v) => (
                    <ToggleGroupItem key={v} value={v} className="flex-1 text-xs">
                      {v === "financial" ? t("reports.financial") : t("reports.sellingPrices")}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <p className="text-xs text-muted-foreground">
                  {variant === "financial"
                    ? t("reports.typeFinancial")
                    : variant === "catalog"
                      ? t("reports.typeCatalog")
                      : t("reports.typeSubmissions")}
                </p>
              </Field>
            ) : null}

            <Field>
              <FieldLabel>{t("reports.whatToPrint")}</FieldLabel>
              <RadioGroup value={scope} onValueChange={(v) => setScope(v as ReportScope)} className="gap-2">
                {scopes.map((sc) => {
                  const disabled = sc === "selected" && initial.ids.length === 0;
                  return (
                    <label
                      key={sc}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors has-[[data-state=checked]]:border-foreground/30 has-[[data-state=checked]]:bg-accent",
                        disabled && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <RadioGroupItem value={sc} disabled={disabled} className="mt-0.5" />
                      <span>
                        <span className="font-medium">{t(`reports.scopes.${sc}`)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {sc === "filtered"
                            ? filterChips.length
                              ? filterChips.join(" · ")
                              : t("reports.scopeHints.noFilters")
                            : sc === "selected"
                              ? t("reports.scopeHints.selected", { count: initial.ids.length })
                              : sc === "brands"
                                ? t("reports.scopeHints.brands")
                                : t("reports.scopeHints.all")}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </RadioGroup>
            </Field>

            {scope === "brands" && !lockedBrandId ? (
              <Field>
                <FieldLabel>{t("reports.brandsLabel")}</FieldLabel>
                <MultiSelectFilter
                  label={t("reports.brandsLabel")}
                  options={brands.map((b) => ({ id: b.id, label: b.name, color: b.color }))}
                  selected={brandIds}
                  onChange={setBrandIds}
                  className="w-full"
                />
              </Field>
            ) : null}

            <Field>
              <FieldLabel htmlFor="report-title">
                {t("reports.titleLabel")} <span className="font-normal text-muted-foreground">({t("common.optional")})</span>
              </FieldLabel>
              <Input id="report-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={t("reports.defaultTitle")} />
            </Field>

            <Field>
              <FieldLabel>{t("reports.layout")}</FieldLabel>
              <ToggleGroup type="single" variant="outline" value={orientation} onValueChange={(v) => v && setOrientation(v as "portrait" | "landscape")} className="w-full">
                <ToggleGroupItem value="portrait" className="flex-1 text-xs">
                  {t("reports.portrait")}
                </ToggleGroupItem>
                <ToggleGroupItem value="landscape" className="flex-1 text-xs">
                  {t("reports.landscape")}
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>

            <div className="space-y-3">
              <label className="flex items-center justify-between gap-3 text-sm">
                {t("reports.cover")}
                <Switch checked={includeCover} onCheckedChange={setIncludeCover} />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                {t("reports.brandBreaks")}
                <Switch checked={brandPageBreaks} onCheckedChange={setBrandPageBreaks} />
              </label>
            </div>

            <Button className="w-full" size="lg" onClick={generate} disabled={loading || invalid}>
              {loading ? <LoaderCircle className="animate-spin" /> : result ? <RefreshCw /> : <FileText />}
              {loading ? t("reports.generating") : result ? t("reports.regenerate") : t("reports.generate")}
            </Button>
            {invalid ? (
              <p className="text-xs text-destructive">
                {scope === "selected" ? t("reports.selectFirst") : t("reports.chooseBrand")}
              </p>
            ) : null}
          </div>

          <div className="flex min-h-[420px] flex-col bg-muted/50">
            {result ? (
              <>
                <div className="flex flex-wrap items-center gap-2 border-b bg-card px-4 py-2.5">
                  <span className="text-sm">
                    {t("reports.resultSummary", { records: result.records.toLocaleString("en-US"), pages: result.pages })}
                  </span>
                  {result.truncated ? (
                    <span className="flex items-center gap-1 text-xs text-warning">
                      <AlertTriangle className="size-3.5" /> {t("reports.truncated")}
                    </span>
                  ) : null}
                  <div className="ms-auto flex gap-1.5">
                    <Button size="sm" variant="outline" onClick={print}>
                      <Printer />
                      {t("common.print")}
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <a href={result.url} target="_blank" rel="noopener">
                        <ExternalLink />
                        {t("common.open")}
                      </a>
                    </Button>
                    <Button size="sm" asChild>
                      <a href={result.url} download={result.filename}>
                        <Download />
                        {t("common.download")}
                      </a>
                    </Button>
                  </div>
                </div>
                <iframe ref={iframeRef} src={result.url} title={t("reports.dialogTitle")} className="min-h-[60dvh] w-full flex-1 bg-white" />
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                <div className="flex size-14 items-center justify-center rounded-2xl bg-card shadow-card">
                  {loading ? <LoaderCircle className="size-6 animate-spin text-brand" /> : <FileText className="size-6 text-muted-foreground" />}
                </div>
                <p className="max-w-sm text-sm text-muted-foreground">
                  {error ?? t("reports.serverNote")}
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
