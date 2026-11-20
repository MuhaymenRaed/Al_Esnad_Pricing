"use client";

import { ChevronDown, ScrollText, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import { ToneBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { changedFields, describeAudit } from "@/features/audit/describe";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export type AuditEntry = {
  id: string;
  action: string;
  table_name: string;
  record_id: string | null;
  created_at: string;
  old_data: unknown;
  new_data: unknown;
  actor: { full_name: string | null; email: string } | null;
};

const TABLES = ["devices", "device_financials", "brands", "categories", "profiles", "role_permissions", "company_settings"] as const;

const ACTIONS = ["INSERT", "UPDATE", "DELETE", "ROLE_CHANGED", "USER_INVITED", "USER_INVITE_RESENT", "USER_ACTIVATED", "USER_DEACTIVATED"] as const;

export function AuditLogTable({
  entries,
  total,
  page,
  pageSize,
  timezone,
}: {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  timezone: string;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [open, setOpen] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in patch)) next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next}`, { scroll: false }));
  };
  const href = (p: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(p));
    return `${pathname}?${next}`;
  };

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          go({ q: q.trim() || null });
        }}
      >
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("audit.search")} className="h-10 bg-card ps-9" aria-label={t("audit.search")} />
        </div>
        <Select value={params.get("table") ?? "all"} onValueChange={(v) => go({ table: v === "all" ? null : v })}>
          <SelectTrigger className="h-10 w-44 bg-card" aria-label={t("audit.allAreas")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("audit.allAreas")}</SelectItem>
            {TABLES.map((v) => (
              <SelectItem key={v} value={v}>
                {t(`audit.areas.${v}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={params.get("action") ?? "all"} onValueChange={(v) => go({ action: v === "all" ? null : v })}>
          <SelectTrigger className="h-10 w-48 bg-card" aria-label={t("audit.allActions")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("audit.allActions")}</SelectItem>
            {ACTIONS.map((a) => (
              <SelectItem key={a} value={a}>
                {t(`audit.actions.${a}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" aria-label={t("audit.fromDate")} className="h-10 w-40 bg-card" defaultValue={params.get("from") ?? ""} onChange={(e) => go({ from: e.target.value || null })} />
        <Input type="date" aria-label={t("audit.toDate")} className="h-10 w-40 bg-card" defaultValue={params.get("to") ?? ""} onChange={(e) => go({ to: e.target.value || null })} />
        {params.toString() ? (
          <Button type="button" variant="ghost" onClick={() => {
            setQ("");
            startTransition(() => router.replace(pathname));
          }}>
            {t("common.clear")}
          </Button>
        ) : null}
        <span className="ms-auto text-xs text-muted-foreground">{t("audit.entries", { count: total.toLocaleString("en-US") })}</span>
      </form>

      {entries.length === 0 ? (
        <Empty className="rounded-xl border border-dashed bg-card py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ScrollText />
            </EmptyMedia>
            <EmptyTitle>{t("audit.noneTitle")}</EmptyTitle>
            <EmptyDescription>{t("audit.noneHint")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className={cn("overflow-x-auto rounded-xl border bg-card shadow-card transition-opacity", pending && "opacity-60")}>
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-surface-raised">
              <tr className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <th className="border-b px-4 py-3 text-start">{t("audit.columns.when")}</th>
                <th className="border-b px-3 py-3 text-start">{t("audit.columns.actor")}</th>
                <th className="border-b px-3 py-3 text-start">{t("audit.columns.action")}</th>
                <th className="border-b px-3 py-3 text-start">{t("audit.columns.details")}</th>
                <th className="w-10 border-b" />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const d = describeAudit(e, t);
                const isOpen = open === e.id;
                return (
                  <Fragment key={e.id}>
                    <tr className="cursor-pointer border-b hover:bg-accent/50" onClick={() => setOpen(isOpen ? null : e.id)}>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatDate(e.created_at, timezone, "datetime", locale)}</td>
                      <td className="px-3 py-3">
                        <span className="font-medium">{e.actor?.full_name ?? e.actor?.email ?? t("audit.s.system")}</span>
                        {e.actor?.full_name ? <span className="block text-xs text-muted-foreground">{e.actor.email}</span> : null}
                      </td>
                      <td className="px-3 py-3">
                        <ToneBadge tone={d.tone}>{d.label}</ToneBadge>
                      </td>
                      <td className="max-w-md px-3 py-3">
                        <span className="line-clamp-2">{d.summary}</span>
                      </td>
                      <td className="px-2">
                        <button type="button" aria-expanded={isOpen} aria-label={t("audit.toggle")} className="rounded p-1 hover:bg-accent">
                          <ChevronDown className={cn("size-4 transition-transform", isOpen && "rotate-180")} />
                        </button>
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr className="border-b bg-muted/30">
                        <td colSpan={5} className="px-4 py-4">
                          <Diff entry={e} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 ? (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious text={t("common.previous")} href={page > 1 ? href(page - 1) : undefined} aria-disabled={page <= 1} className={cn(page <= 1 && "pointer-events-none opacity-50")} />
            </PaginationItem>
            {Array.from({ length: pages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === pages || Math.abs(p - page) <= 2)
              .map((p, i, arr) => (
                <Fragment key={p}>
                  {i > 0 && p - arr[i - 1] > 1 ? <PaginationItem className="px-1 text-muted-foreground">…</PaginationItem> : null}
                  <PaginationItem>
                    <PaginationLink href={href(p)} isActive={p === page}>
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                </Fragment>
              ))}
            <PaginationItem>
              <PaginationNext text={t("common.next")} href={page < pages ? href(page + 1) : undefined} aria-disabled={page >= pages} className={cn(page >= pages && "pointer-events-none opacity-50")} />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}
    </div>
  );
}

function Diff({ entry }: { entry: AuditEntry }) {
  const { t } = useI18n();
  const before = (entry.old_data ?? {}) as Record<string, unknown>;
  const after = (entry.new_data ?? {}) as Record<string, unknown>;
  const keys = entry.action === "UPDATE" || entry.action === "ROLE_CHANGED" || entry.action.startsWith("USER_")
    ? changedFields(entry)
    : Object.keys({ ...before, ...after }).filter((k) => !["updated_at", "created_at"].includes(k));
  const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <div className="space-y-2 text-xs">
      <p className="text-muted-foreground">
        {entry.table_name} · {t("audit.record")} <span className="font-mono">{entry.record_id ?? "—"}</span>
      </p>
      {keys.length ? (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full">
            <thead className="bg-surface-raised text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t("audit.field")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("audit.before")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("audit.after")}</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k} className="border-t">
                  <td className="px-3 py-1.5 font-mono">{k}</td>
                  <td className="max-w-xs truncate px-3 py-1.5 text-muted-foreground line-through decoration-destructive/40">{show(before[k])}</td>
                  <td className="max-w-xs truncate px-3 py-1.5 font-medium">{show(after[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted-foreground">{t("audit.noFieldChanges")}</p>
      )}
    </div>
  );
}
