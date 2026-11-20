"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown, MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Money } from "@/components/common/money";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { DeviceListRow } from "@/features/devices/types";
import type { SortKey } from "@/lib/filters/devices";
import { formatDate, formatPercent, type MoneyFormat } from "@/lib/format";
import type { DataProjection } from "@/lib/permissions";
import { useI18n, useT } from "@/lib/i18n/client";
import type { Locale, TFunction } from "@/lib/i18n/core";
import { cn } from "@/lib/utils";

type Column = {
  id: string;
  header: string;
  align?: "start" | "end";
  sort?: [SortKey, SortKey];
  className?: string;
  cell: (row: DeviceListRow) => ReactNode;
};

function columnsFor(projection: DataProjection, money: MoneyFormat, timezone: string, t: TFunction, locale: Locale): Column[] {
  const device: Column = {
    id: "device",
    header: t("devices.columns.device"),
    sort: ["name_asc", "name_desc"],
    className: "min-w-56",
    cell: (r) => (
      <div className="flex min-w-0 items-center gap-3">
        <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: r.brandColor }} aria-hidden />
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground">{r.name}</div>
          {r.sku || r.modelNumber ? (
            <div className="truncate text-xs text-muted-foreground">{[r.modelNumber, r.sku].filter(Boolean).join(" · ")}</div>
          ) : null}
        </div>
      </div>
    ),
  };
  const brand: Column = { id: "brand", header: t("devices.columns.brand"), cell: (r) => <span className="whitespace-nowrap">{r.brandName}</span> };
  const category: Column = {
    id: "category",
    header: t("devices.columns.category"),
    cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{r.categoryName ?? "—"}</span>,
  };
  const selling: Column = {
    id: "selling",
    header: t("devices.columns.selling"),
    align: "end",
    sort: ["price_asc", "price_desc"],
    cell: (r) => <Money value={r.sellingPrice} format={money} className="font-semibold text-brand" />,
  };

  if (projection === "catalog") {
    return [
      device,
      brand,
      category,
      { ...selling, header: t("devices.columns.finalSelling") },
      {
        id: "added",
        header: t("devices.columns.added"),
        sort: ["oldest", "newest"],
        cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(r.createdAt, timezone, "date", locale)}</span>,
      },
    ];
  }

  if (projection === "submissions") {
    return [
      device,
      brand,
      category,
      {
        id: "identifiers",
        header: t("devices.columns.identifiers"),
        cell: (r) => (
          <span className="whitespace-nowrap text-muted-foreground">{[r.modelNumber, r.sku].filter(Boolean).join(" · ") || "—"}</span>
        ),
      },
      { id: "status", header: t("devices.columns.status"), cell: (r) => (r.status ? <StatusBadge status={r.status} /> : null) },
      {
        id: "submitted",
        header: t("devices.columns.submitted"),
        cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(r.createdAt, timezone, "date", locale)}</span>,
      },
    ];
  }

  return [
    device,
    brand,
    category,
    {
      id: "status",
      header: t("devices.columns.status"),
      cell: (r) => (r.status ? <StatusBadge status={r.status} /> : null),
    },
    {
      id: "purchase",
      header: t("devices.columns.purchase"),
      align: "end",
      sort: ["purchase_asc", "purchase_desc"],
      cell: (r) => <Money value={r.purchasePrice} format={money} currency={false} />,
    },
    {
      id: "discount",
      header: t("devices.columns.discount"),
      align: "end",
      cell: (r) => (
        <div className="flex flex-col items-end leading-tight">
          <Money value={r.discountAmount} format={money} currency={false} muted={!Number(r.discountAmount)} />
          {r.discountType === "percentage" && Number(r.discountValue) ? (
            <span className="text-[0.7rem] text-muted-foreground">{formatPercent(r.discountValue, 4)}</span>
          ) : null}
        </div>
      ),
    },
    {
      id: "payback",
      header: t("devices.columns.payback"),
      align: "end",
      cell: (r) => <Money value={r.paybackAmount} format={money} currency={false} muted={!Number(r.paybackAmount)} />,
    },
    {
      id: "cost",
      header: t("devices.columns.cost"),
      align: "end",
      sort: ["cost_asc", "cost_desc"],
      cell: (r) => <Money value={r.finalCost} format={money} currency={false} className="font-medium text-gold" />,
    },
    {
      id: "profit",
      header: t("devices.columns.profit"),
      align: "end",
      sort: ["profit_asc", "profit_desc"],
      cell: (r) => <Money value={r.profit} format={money} currency={false} className="text-success" />,
    },
    { ...selling, cell: (r) => <Money value={r.sellingPrice} format={money} className="font-semibold text-brand" /> },
  ];
}

function useIsDesktop() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(min-width: 768px)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(min-width: 768px)").matches,
    () => true,
  );
}

export type DeviceTableProps = {
  projection: DataProjection;
  rows: DeviceListRow[];
  money: MoneyFormat;
  timezone: string;
  sort?: SortKey;
  onSortChange?: (sort: SortKey) => void;
  selectable?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggleRow?: (row: DeviceListRow) => void;
  onToggleAll?: (rows: DeviceListRow[], select: boolean) => void;
  rowActions?: (row: DeviceListRow) => ReactNode;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  hrefFor?: (row: DeviceListRow) => string | null;
  footer?: ReactNode;
};

export function DeviceTable(props: DeviceTableProps) {
  const isDesktop = useIsDesktop();
  return isDesktop ? <DesktopTable {...props} /> : <MobileList {...props} />;
}

function DesktopTable({
  projection,
  rows,
  money,
  timezone,
  sort,
  onSortChange,
  selectable,
  selectedIds,
  onToggleRow,
  onToggleAll,
  rowActions,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  hrefFor,
  footer,
}: DeviceTableProps) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { t, locale } = useI18n();
  const columns = columnsFor(projection, money, timezone, t, locale);
  const colCount = columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns non-memoizable functions by design.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 57,
    overscan: 12,
    // Lets the server render the first rows (no empty flash before hydration).
    initialRect: { width: 1280, height: 900 },
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items.length ? items[items.length - 1].index : -1;

  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && lastIndex >= rows.length - 15) onLoadMore?.();
  }, [lastIndex, rows.length, hasNextPage, isFetchingNextPage, onLoadMore]);

  const paddingTop = items.length ? items[0].start : 0;
  const paddingBottom = items.length ? virtualizer.getTotalSize() - items[items.length - 1].end : 0;
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds?.has(r.id));
  const someSelected = !allSelected && rows.some((r) => selectedIds?.has(r.id));

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-card">
      <div
        ref={scrollRef}
        className="scrollbar-thin relative max-h-[min(72dvh,960px)] min-h-[320px] overflow-auto"
        role="region"
        aria-label={t("nav.devices")}
        tabIndex={0}
      >
        <table className="w-full caption-bottom border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              {selectable ? (
                <th className="w-11 border-b bg-surface-raised ps-4 text-start">
                  <Checkbox
                    aria-label={t("devices.selectAll")}
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={(v) => onToggleAll?.(rows, v === true)}
                  />
                </th>
              ) : null}
              {columns.map((col) => (
                <th
                  key={col.id}
                  scope="col"
                  aria-sort={
                    col.sort && sort === col.sort[0] ? "ascending" : col.sort && sort === col.sort[1] ? "descending" : undefined
                  }
                  className={cn(
                    "h-11 border-b bg-surface-raised px-3 text-xs font-semibold tracking-wide whitespace-nowrap text-muted-foreground uppercase first:ps-4",
                    col.align === "end" ? "text-end" : "text-start",
                  )}
                >
                  {col.sort && onSortChange ? (
                    <button
                      type="button"
                      className={cn(
                        "inline-flex items-center gap-1 rounded uppercase hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                        (sort === col.sort[0] || sort === col.sort[1]) && "text-foreground",
                      )}
                      onClick={() => onSortChange(sort === col.sort![0] ? col.sort![1] : col.sort![0])}
                    >
                      {col.header}
                      {sort === col.sort[0] ? (
                        <ArrowUp className="size-3" />
                      ) : sort === col.sort[1] ? (
                        <ArrowDown className="size-3" />
                      ) : (
                        <ArrowUpDown className="size-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
              {rowActions ? <th className="w-12 border-b bg-surface-raised pe-3" aria-label={t("common.actions")} /> : null}
            </tr>
          </thead>
          <tbody>
            {paddingTop > 0 ? (
              <tr aria-hidden>
                <td colSpan={colCount} style={{ height: paddingTop }} />
              </tr>
            ) : null}
            {items.map((item) => {
              const row = rows[item.index];
              const selected = selectedIds?.has(row.id) ?? false;
              const href = hrefFor?.(row) ?? null;
              return (
                <tr
                  key={row.id}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  data-state={selected ? "selected" : undefined}
                  onClick={(e) => {
                    if (!href) return;
                    const target = e.target as HTMLElement;
                    if (target.closest("button, a, input, [role=checkbox], [role=menuitem]")) return;
                    if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
                    else router.push(href);
                  }}
                  className={cn(
                    "group transition-colors hover:bg-accent/60 data-[state=selected]:bg-brand-soft/60",
                    href && "cursor-pointer",
                  )}
                >
                  {selectable ? (
                    <td className="border-b border-border/70 ps-4">
                      <Checkbox
                        aria-label={t("devices.selectRow", { name: row.name })}
                        checked={selected}
                        onCheckedChange={() => onToggleRow?.(row)}
                      />
                    </td>
                  ) : null}
                  {columns.map((col) => (
                    <td
                      key={col.id}
                      className={cn(
                        "h-14 border-b border-border/70 px-3 align-middle first:ps-4",
                        col.align === "end" && "text-end",
                        col.className,
                      )}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                  {rowActions ? <td className="border-b border-border/70 pe-3 text-end">{rowActions(row)}</td> : null}
                </tr>
              );
            })}
            {paddingBottom > 0 ? (
              <tr aria-hidden>
                <td colSpan={colCount} style={{ height: paddingBottom }} />
              </tr>
            ) : null}
          </tbody>
        </table>
        {isFetchingNextPage ? (
          <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-brand" /> {t("devices.loadingMore")}
          </div>
        ) : null}
      </div>
      {footer ? <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-surface-raised px-4 py-2.5 text-xs text-muted-foreground">{footer}</div> : null}
    </div>
  );
}

function MobileList({
  projection,
  rows,
  money,
  timezone,
  selectable,
  selectedIds,
  onToggleRow,
  rowActions,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  hrefFor,
  footer,
}: DeviceTableProps) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !isFetchingNextPage) onLoadMore?.();
    }, { rootMargin: "400px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, onLoadMore]);

  return (
    <div className="space-y-2">
      <ul className="space-y-2" aria-label={t("nav.devices")}>
        {rows.map((r) => {
          const selected = selectedIds?.has(r.id) ?? false;
          const href = hrefFor?.(r) ?? null;
          return (
            <li
              key={r.id}
              data-state={selected ? "selected" : undefined}
              className="rounded-xl border bg-card p-3.5 shadow-card data-[state=selected]:border-brand/40 data-[state=selected]:bg-brand-soft/50"
              onClick={(e) => {
                if (!href || (e.target as HTMLElement).closest("button, a, [role=checkbox], [role=menuitem]")) return;
                router.push(href);
              }}
            >
              <div className="flex items-start gap-3">
                {selectable ? (
                  <Checkbox className="mt-0.5" aria-label={t("devices.selectRow", { name: r.name })} checked={selected} onCheckedChange={() => onToggleRow?.(r)} />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.name}</p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="size-2 rounded-full" style={{ backgroundColor: r.brandColor }} />
                        {r.brandName}
                        {r.categoryName ? ` · ${r.categoryName}` : ""}
                      </p>
                    </div>
                    {rowActions ? <div className="-me-1.5 -mt-1">{rowActions(r)}</div> : null}
                  </div>
                  <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
                    {r.status ? <StatusBadge status={r.status} /> : <span className="text-xs text-muted-foreground">{formatDate(r.createdAt, timezone, "date", locale)}</span>}
                    {projection === "submissions" ? (
                      <span className="text-xs text-muted-foreground">{formatDate(r.createdAt, timezone, "date", locale)}</span>
                    ) : (
                      <Money value={r.sellingPrice} format={money} className="text-base font-semibold text-brand" />
                    )}
                  </div>
                  {projection === "full" ? (
                    <dl className="mt-3 grid grid-cols-3 gap-2 border-t pt-3 text-xs">
                      <div>
                        <dt className="text-muted-foreground">{t("devices.columns.purchase")}</dt>
                        <dd><Money value={r.purchasePrice} format={money} currency={false} /></dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{t("devices.columns.cost")}</dt>
                        <dd><Money value={r.finalCost} format={money} currency={false} className="text-gold" /></dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{t("devices.columns.profit")}</dt>
                        <dd><Money value={r.profit} format={money} currency={false} className="text-success" /></dd>
                      </div>
                    </dl>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <div ref={sentinel} />
      {hasNextPage ? (
        <Button variant="outline" className="w-full" onClick={onLoadMore} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? t("common.loading") : t("common.loadMore")}
        </Button>
      ) : null}
      {footer ? <div className="flex flex-wrap justify-between gap-2 px-1 text-xs text-muted-foreground">{footer}</div> : null}
    </div>
  );
}

export function RowActionsTrigger(props: React.ComponentProps<typeof Button>) {
  const t = useT();
  return (
    <Button variant="ghost" size="icon-sm" className="text-muted-foreground opacity-70 group-hover:opacity-100" {...props}>
      <MoreHorizontal />
      <span className="sr-only">{t("common.actions")}</span>
    </Button>
  );
}
