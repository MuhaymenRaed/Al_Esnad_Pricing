"use client";

import { FileSpreadsheet, Filter, Layers, ListChecks, Printer, Tags } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Option } from "@/features/devices/types";
import { useI18n } from "@/lib/i18n/client";
import type { DataProjection } from "@/lib/permissions";
import type { ReportVariant } from "@/lib/validation/schemas";
import { ReportDialog, type ReportDialogConfig } from "./report-dialog";

export function ReportCenter({
  projection,
  brands,
  canFinancial,
  presetIds,
}: {
  projection: DataProjection;
  brands: Option[];
  canFinancial: boolean;
  presetIds: string[];
}) {
  const { t } = useI18n();
  const base: ReportVariant = projection === "full" ? (canFinancial ? "financial" : "catalog") : projection;
  const [config, setConfig] = useState<ReportDialogConfig | null>(
    presetIds.length ? { scope: "selected", variant: base, filters: {}, ids: presetIds, brandIds: [] } : null,
  );
  const open = (c: Partial<ReportDialogConfig>) => setConfig({ scope: "all", variant: base, filters: {}, ids: [], brandIds: [], ...c });

  const cards = [
    projection !== "submissions" && {
      icon: <Printer />,
      title: t("reports.cards.catalogue"),
      body: t("reports.cards.catalogueDesc"),
      action: () => open({ scope: "all", variant: projection === "full" ? "catalog" : base }),
    },
    projection !== "submissions" && {
      icon: <Tags />,
      title: t("reports.cards.brands"),
      body: t("reports.cards.brandsDesc"),
      action: () => open({ scope: "brands" }),
    },
    canFinancial && {
      icon: <FileSpreadsheet />,
      title: t("reports.cards.financial"),
      body: t("reports.cards.financialDesc"),
      action: () => open({ scope: "all", variant: "financial" }),
      highlight: true,
    },
    projection === "submissions" && {
      icon: <ListChecks />,
      title: t("reports.cards.submissions"),
      body: t("reports.cards.submissionsDesc"),
      action: () => open({ scope: "filtered", variant: "submissions" }),
    },
  ].filter(Boolean) as Array<{ icon: React.ReactNode; title: string; body: string; action: () => void; highlight?: boolean }>;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <button
            key={c.title}
            type="button"
            onClick={c.action}
            className={
              "group flex flex-col items-start gap-3 rounded-xl border bg-card p-5 text-start shadow-card transition-colors hover:border-foreground/20 hover:bg-surface-raised" +
              (c.highlight ? " border-brand/30" : "")
            }
          >
            <span className={"flex size-10 items-center justify-center rounded-lg [&_svg]:size-5 " + (c.highlight ? "bg-brand-soft text-brand" : "bg-muted")}>{c.icon}</span>
            <span>
              <span className="block font-heading font-semibold">{c.title}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{c.body}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed bg-card p-5 text-sm">
        <Filter className="size-5 text-muted-foreground" />
        <p className="min-w-0 flex-1 text-muted-foreground">
          {t("reports.cards.filteredHint")}
        </p>
        <Button variant="outline" asChild>
          <Link href="/devices">
            <Layers /> {t("reports.cards.openDevices")}
          </Link>
        </Button>
      </div>
      {config ? (
        <ReportDialog
          open
          onOpenChange={(o) => !o && setConfig(null)}
          initial={config}
          projection={projection}
          brands={brands}
          canFinancial={canFinancial}
          filterChips={[]}
        />
      ) : null}
    </div>
  );
}
