"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowUpDown,
  CheckCircle2,
  ExternalLink,
  FileDown,
  FileSpreadsheet,
  Layers,
  Link2,
  ListChecks,
  Printer,
  RefreshCw,
  RotateCcw,
  SearchX,
  Send,
  Tags,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Money } from "@/components/common/money";
import { FilterChips } from "@/components/filters/filter-chips";
import { FilterSheet } from "@/components/filters/filter-sheet";
import { MultiSelectFilter } from "@/components/filters/multi-select-filter";
import { SearchField } from "@/components/filters/search-field";
import { DeviceTable, RowActionsTrigger } from "@/components/tables/device-table";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { deleteDevicesAction, setDevicesStatusAction } from "@/features/devices/actions";
import { PublishDialog } from "@/features/devices/components/publish-dialog";
import type { SyncCompare } from "@/features/devices/sync-state";
import { autoLinkAction, selectAllDevicesAction } from "@/features/devices/sync-actions";
import type { DevicePageResponse, DeviceListRow, Option, SelectedDevice } from "@/features/devices/types";
import { ReportDialog, type ReportDialogConfig } from "@/features/reports/components/report-dialog";
import { useDeviceQuery } from "@/hooks/use-device-query";
import { useUrlFilters } from "@/hooks/use-url-filters";
import {
  CATALOG_SORTS,
  FULL_SORTS,
  STATUSES,
  describeFilters,
  isFiltered,
  removeChip,
  type DeviceFilters,
  type SortKey,
} from "@/lib/filters/devices";
import { formatMoney, formatNumber, formatPercent, type MoneyFormat } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import type { DataProjection } from "@/lib/permissions";
import type { DeviceStatus } from "@/types/database";

export type WorkspaceCapabilities = {
  canEdit: boolean;
  canArchive: boolean;
  canDelete: boolean;
  canReview: boolean;
  canExport: boolean;
  canFinancialReport: boolean;
  /** Publishing to ERPNext / alisnad.iq: check status, publish prices, link by name. */
  canCheck: boolean;
  canPublish: boolean;
  canLink: boolean;
  /** Role preview: everything visible, nothing writable. */
  readOnly: boolean;
};

/** Price comparison rules and ERPNext price lists (null when neither system is connected). */
export type WorkspaceSync = { compare: SyncCompare; lists: { erpSelling: string | null; erpBuying: string | null } } | null;

export function DevicesWorkspace({
  projection,
  initialFilters,
  initialPage,
  brands,
  categories,
  money,
  timezone,
  capabilities,
  lockedBrandId,
  searchPlaceholder,
  sync = null,
}: {
  projection: DataProjection;
  initialFilters: DeviceFilters;
  initialPage?: DevicePageResponse;
  brands: Option[];
  categories: Option[];
  money: MoneyFormat;
  timezone: string;
  capabilities: WorkspaceCapabilities;
  lockedBrandId?: string;
  searchPlaceholder: string;
  sync?: WorkspaceSync;
}) {
  const { t, tm } = useI18n();
  const locked = useMemo(() => (lockedBrandId ? { brandIds: [lockedBrandId] } : {}), [lockedBrandId]);
  const { filters, setFilters, clear } = useUrlFilters(initialFilters, locked);
  const query = useDeviceQuery(projection, filters, initialPage);
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Map<string, SelectedDevice>>(new Map());
  const [report, setReport] = useState<ReportDialogConfig | null>(null);
  const [pendingStatus, setPendingStatus] = useState<{ ids: string[]; status: DeviceStatus } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SelectedDevice[] | null>(null);
  const [syncDialog, setSyncDialog] = useState<{ ids: string[]; publish: boolean } | null>(null);
  const [, startTransition] = useTransition();
  const [selectingAll, startSelectingAll] = useTransition();
  const [linking, startLinking] = useTransition();

  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.rows) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total ?? null;
  const summary = query.data?.pages[0]?.summary;
  const writable = !capabilities.readOnly;

  const brandLookup = useMemo(() => new Map(brands.map((b) => [b.id, b.name])), [brands]);
  const categoryLookup = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const visibleFilters = lockedBrandId ? { ...filters, brandIds: undefined } : filters;
  const chips = describeFilters(
    visibleFilters,
    { brands: brandLookup, categories: categoryLookup, formatAmount: (v) => formatMoney(v, money) },
    t,
  );

  const update = useCallback((patch: Partial<DeviceFilters>) => setFilters((prev) => ({ ...prev, ...patch })), [setFilters]);
  const onSearch = useCallback((q: string) => update({ q: q || undefined }), [update]);

  const brandOptions = useMemo(() => {
    const counts = new Map(summary?.brands.map((b) => [b.id, b.count]));
    return brands.map((b) => ({ id: b.id, label: b.name, color: b.color, count: summary ? (counts.get(b.id) ?? 0) : undefined }));
  }, [brands, summary]);
  const categoryOptions = useMemo(() => {
    const counts = new Map(summary?.categories.map((c) => [c.id, c.count]));
    return categories.map((c) => ({ id: c.id, label: c.name, count: summary ? (counts.get(c.id) ?? 0) : undefined }));
  }, [categories, summary]);
  const statusOptions = useMemo(() => {
    const counts = new Map(summary?.statuses.map((s) => [s.value, s.count]));
    return STATUSES.filter((s) => projection === "full" || s !== "archived").map((s) => ({
      id: s,
      label: t(`status.${s}`),
      count: summary ? (counts.get(s) ?? 0) : undefined,
    }));
  }, [summary, projection, t]);

  const sorts = projection === "full" ? FULL_SORTS : CATALOG_SORTS;
  const sort = filters.sort ?? (projection === "submissions" ? "newest" : "name_asc");
  const activeFilterCount = chips.filter((c) => c.key !== "q").length;

  const toggleRow = useCallback((row: DeviceListRow) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, row);
      return next;
    });
  }, []);
  const toggleAll = useCallback((list: DeviceListRow[], select: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const r of list) {
        if (select) next.set(r.id, r);
        else next.delete(r.id);
      }
      return next;
    });
  }, []);
  const selectedIds = useMemo(() => new Set(selected.keys()), [selected]);

  const changeStatus = async (ids: string[], status: DeviceStatus) => {
    const result = await setDevicesStatusAction(ids, status);
    if (!result.ok) {
      toast.error(tm(result.error));
      return false;
    }
    const { changed, requested } = result.data;
    toast.success(changed === requested ? t("devices.toast.changed", { count: changed }) : t("devices.toast.partial", { changed, requested }));
    setSelected(new Map());
    await queryClient.invalidateQueries({ queryKey: ["devices"] });
    return true;
  };

  const selectAllMatching = () =>
    startSelectingAll(async () => {
      const result = await selectAllDevicesAction(filters);
      if (!result.ok) {
        toast.error(tm(result.error));
        return;
      }
      setSelected(new Map(result.data.rows.map((r) => [r.id, r])));
      if (result.data.truncated) toast.warning(t("devices.selectAllTruncated", { count: result.data.rows.length }));
    });

  const linkByName = (ids: string[]) =>
    startLinking(async () => {
      const toastId = toast.loading(t("sync.linking"));
      const total = { linked: 0, none: 0, already: 0, taken: 0 };
      for (let i = 0; i < ids.length; i += 40) {
        const result = await autoLinkAction(ids.slice(i, i + 40));
        if (!result.ok) {
          toast.error(tm(result.error), { id: toastId });
          return;
        }
        for (const k of Object.keys(total) as Array<keyof typeof total>) total[k] += result.data[k];
      }
      toast.success(t("sync.linkedSummary", total), { id: toastId });
      await queryClient.invalidateQueries({ queryKey: ["devices"] });
    });

  const deleteDevices = async (ids: string[]) => {
    const result = await deleteDevicesAction(ids);
    if (!result.ok) {
      toast.error(tm(result.error));
      return false;
    }
    const { deleted, requested } = result.data;
    toast.success(deleted === requested ? t("devices.toast.deleted", { count: deleted }) : t("devices.toast.deletedPartial", { deleted, requested }));
    setSelected((prev) => {
      const next = new Map(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    await queryClient.invalidateQueries({ queryKey: ["devices"] });
    return true;
  };

  const defaultVariant = projection === "full" ? "financial" : projection;
  const openReport = (config: Partial<ReportDialogConfig>) =>
    setReport({
      scope: "filtered",
      variant: defaultVariant,
      filters,
      ids: [],
      brandIds: lockedBrandId ? [lockedBrandId] : (filters.brandIds ?? []),
      ...config,
    });

  const rowActions =
    projection === "catalog" || projection === "full"
      ? (row: DeviceListRow) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <RowActionsTrigger aria-label={t("devices.rowActions", { name: row.name })} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem asChild>
                <Link href={`/devices/${row.id}`}>
                  <ExternalLink />
                  {projection === "full" && capabilities.canEdit && writable ? t("devices.openEdit") : t("devices.viewDetails")}
                </Link>
              </DropdownMenuItem>
              {capabilities.canExport ? (
                <DropdownMenuItem onSelect={() => openReport({ scope: "selected", ids: [row.id] })}>
                  <Printer />
                  {t("devices.printThis")}
                </DropdownMenuItem>
              ) : null}
              {projection === "full" && writable ? (
                <>
                  <DropdownMenuSeparator />
                  {capabilities.canReview && row.status !== "active" && row.status !== "archived" ? (
                    <DropdownMenuItem onSelect={() => startTransition(() => void changeStatus([row.id], "active"))}>
                      <CheckCircle2 />
                      {t("devices.approve")}
                    </DropdownMenuItem>
                  ) : null}
                  {capabilities.canReview && row.status === "pending_review" ? (
                    <DropdownMenuItem onSelect={() => setPendingStatus({ ids: [row.id], status: "rejected" })}>
                      <XCircle />
                      {t("devices.reject")}
                    </DropdownMenuItem>
                  ) : null}
                  {capabilities.canArchive && row.status !== "archived" ? (
                    <DropdownMenuItem variant="destructive" onSelect={() => setPendingStatus({ ids: [row.id], status: "archived" })}>
                      <Archive />
                      {t("devices.archive")}
                    </DropdownMenuItem>
                  ) : null}
                  {capabilities.canEdit && row.status === "archived" ? (
                    <DropdownMenuItem onSelect={() => startTransition(() => void changeStatus([row.id], "draft"))}>
                      <RotateCcw />
                      {t("devices.restore")}
                    </DropdownMenuItem>
                  ) : null}
                  {capabilities.canDelete ? (
                    <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete([row])}>
                      <Trash2 />
                      {t("devices.delete")}
                    </DropdownMenuItem>
                  ) : null}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      : undefined;

  const filtered = isFiltered(visibleFilters);

  return (
    <div className="space-y-4">
      {/* Toolbar: search · filters · sort · print */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          value={filters.q ?? ""}
          onChange={onSearch}
          placeholder={searchPlaceholder}
          loading={query.isFetching && !query.isFetchingNextPage}
          className="min-w-[240px] basis-full sm:basis-auto"
        />
        {projection !== "submissions" && !lockedBrandId && brandOptions.length ? (
          <MultiSelectFilter
            label={t("filters.brand")}
            icon={<Tags className="size-4 text-muted-foreground" />}
            options={brandOptions}
            selected={filters.brandIds ?? []}
            onChange={(ids) => update({ brandIds: ids.length ? ids : undefined })}
            searchPlaceholder={t("filters.searchBrands")}
            className="h-11 px-4"
          />
        ) : null}
        {projection !== "submissions" ? (
          <FilterSheet
            filters={filters}
            onChange={update}
            onClear={clear}
            brands={brandOptions}
            categories={categoryOptions}
            statuses={statusOptions}
            showBrand={!lockedBrandId}
            showPrice
            showDate
            showStatus={projection === "full"}
            allowPrivateFields={projection === "full"}
            currency={money.currency}
            total={total}
            activeCount={activeFilterCount}
          />
        ) : null}
        {projection !== "submissions" ? (
          <Select value={sort} onValueChange={(v) => update({ sort: v as SortKey })}>
            <SelectTrigger className="h-11 w-auto gap-2 bg-card" aria-label={t("sort.label")}>
              <ArrowUpDown className="size-4 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectGroup>
                <SelectLabel>{t("sort.label")}</SelectLabel>
                {sorts.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`sort.${s}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}
        {capabilities.canExport ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="h-11 px-4">
                <FileDown />
                <span className="hidden sm:inline">{t("reports.menu.button")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("reports.menu.hint")}</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => openReport({ scope: "filtered" })}>
                <Printer />
                {filtered ? t("reports.menu.printFiltered") : t("reports.menu.printView")}
                {total !== null ? <span className="ms-auto text-xs text-muted-foreground">{formatNumber(total)}</span> : null}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!selected.size} onSelect={() => openReport({ scope: "selected", ids: [...selected.keys()] })}>
                <ListChecks />
                {t("reports.menu.printSelected")}
                <span className="ms-auto text-xs text-muted-foreground">{selected.size}</span>
              </DropdownMenuItem>
              {projection !== "submissions" && !lockedBrandId ? (
                <>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Tags />
                      {t("reports.menu.printOneBrand")}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                      {brands.map((b) => (
                        <DropdownMenuItem key={b.id} onSelect={() => openReport({ scope: "brands", brandIds: [b.id] })}>
                          <span className="size-2.5 rounded-full" style={{ backgroundColor: b.color }} />
                          {b.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem onSelect={() => openReport({ scope: "brands", brandIds: filters.brandIds ?? [] })}>
                    <Layers />
                    {t("reports.menu.printSeveralBrands")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => openReport({ scope: "all" })}>
                    <FileDown />
                    {t("reports.menu.printAll")}
                  </DropdownMenuItem>
                </>
              ) : null}
              {lockedBrandId ? (
                <DropdownMenuItem onSelect={() => openReport({ scope: "brands", brandIds: [lockedBrandId] })}>
                  <Tags />
                  {t("reports.menu.printBrand")}
                </DropdownMenuItem>
              ) : null}
              {capabilities.canFinancialReport ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => openReport({ scope: "filtered", variant: "financial" })}>
                    <FileSpreadsheet />
                    {t("reports.menu.financial")}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <FilterChips chips={chips} onRemove={(chip) => setFilters((prev) => removeChip(prev, chip))} onClearAll={clear} />

      {projection !== "submissions" ? <SummaryStrip projection={projection} summary={summary} money={money} loading={query.isLoading} /> : null}

      {selected.size ? (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-brand/25 bg-card px-3 py-2 shadow-lift lg:top-3">
          <span className="flex items-center gap-2 text-sm font-medium">
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-brand px-1.5 text-xs text-brand-foreground">{selected.size}</span>
            {t("devices.selected", { count: selected.size })}
            <span className="hidden text-xs font-normal text-muted-foreground sm:inline">
              {t("devices.acrossBrands", { count: new Set([...selected.values()].map((r) => r.brandId)).size })}
            </span>
          </span>
          {projection === "full" && total !== null && selected.size < total ? (
            <Button size="sm" variant="link" className="h-auto px-1" onClick={selectAllMatching} disabled={selectingAll}>
              {selectingAll ? t("common.loading") : t("devices.selectAllMatching", { count: formatNumber(total) })}
            </Button>
          ) : null}
          <div className="ms-auto flex flex-wrap items-center gap-1.5">
            {projection === "full" && writable && sync && capabilities.canPublish ? (
              <Button size="sm" onClick={() => setSyncDialog({ ids: [...selected.keys()], publish: true })}>
                <Send />
                {t("sync.publish")}
              </Button>
            ) : null}
            {projection === "full" && writable && sync && (capabilities.canCheck || capabilities.canLink) ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline">
                    <RefreshCw className={linking ? "animate-spin" : undefined} />
                    {t("sync.menu")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  {capabilities.canCheck ? (
                    <DropdownMenuItem onSelect={() => setSyncDialog({ ids: [...selected.keys()], publish: false })}>
                      <RefreshCw />
                      {t("sync.checkSelected")}
                    </DropdownMenuItem>
                  ) : null}
                  {capabilities.canLink ? (
                    <DropdownMenuItem disabled={linking} onSelect={() => linkByName([...selected.keys()])}>
                      <Link2 />
                      {t("sync.linkByName")}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {capabilities.canExport ? (
              <Button size="sm" variant="outline" onClick={() => openReport({ scope: "selected", ids: [...selected.keys()] })}>
                <Printer />
                {t("devices.printSelected")}
              </Button>
            ) : null}
            {projection === "full" && writable && capabilities.canReview ? (
              <Button size="sm" variant="outline" onClick={() => setPendingStatus({ ids: [...selected.keys()], status: "active" })}>
                <CheckCircle2 />
                {t("devices.approveShort")}
              </Button>
            ) : null}
            {projection === "full" && writable && capabilities.canArchive ? (
              <Button size="sm" variant="outline" onClick={() => setPendingStatus({ ids: [...selected.keys()], status: "archived" })}>
                <Archive />
                {t("devices.archive")}
              </Button>
            ) : null}
            {projection === "full" && writable && capabilities.canDelete ? (
              <Button size="sm" variant="destructive" onClick={() => setPendingDelete([...selected.values()])}>
                <Trash2 />
                {t("devices.delete")}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Map())}>
              <X />
              {t("devices.clearSelection")}
            </Button>
          </div>
        </div>
      ) : null}

      {query.isLoading ? (
        <TableSkeleton />
      ) : query.isError ? (
        <Empty className="rounded-xl border border-dashed bg-card">
          <EmptyHeader>
            <EmptyTitle>{t("devices.loadError")}</EmptyTitle>
            <EmptyDescription>{tm(query.error.message)}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => query.refetch()}>
              {t("common.retry")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : rows.length === 0 ? (
        <Empty className="rounded-xl border border-dashed bg-card py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX />
            </EmptyMedia>
            <EmptyTitle>{filtered ? t("devices.emptyFiltered") : t("devices.emptyNone")}</EmptyTitle>
            <EmptyDescription>
              {filtered
                ? t("devices.emptyFilteredHint")
                : projection === "submissions"
                  ? t("devices.emptySubmissionsHint")
                  : t("devices.emptyCatalogHint")}
            </EmptyDescription>
          </EmptyHeader>
          {filtered ? (
            <EmptyContent>
              <Button variant="outline" onClick={clear}>
                {t("filters.clearAll")}
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <DeviceTable
          projection={projection}
          rows={rows}
          money={money}
          timezone={timezone}
          sort={sort}
          onSortChange={projection === "submissions" ? undefined : (s) => update({ sort: s })}
          selectable={capabilities.canExport || (projection === "full" && writable)}
          selectedIds={selectedIds}
          onToggleRow={toggleRow}
          onToggleAll={toggleAll}
          rowActions={rowActions}
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          onLoadMore={() => void query.fetchNextPage()}
          hrefFor={(r) => `/devices/${r.id}`}
          footer={
            <>
              <span className="tabular-nums">
                {total !== null
                  ? t("common.showing", { shown: formatNumber(rows.length), total: formatNumber(total) })
                  : t("common.showingCount", { shown: formatNumber(rows.length) })}
              </span>
              {query.hasNextPage ? (
                <Button size="xs" variant="ghost" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                  {query.isFetchingNextPage ? t("common.loading") : t("common.loadMore")}
                </Button>
              ) : (
                <span>{t("common.endOfResults")}</span>
              )}
            </>
          }
        />
      )}

      <ConfirmDialog
        open={Boolean(pendingStatus)}
        onOpenChange={(o) => !o && setPendingStatus(null)}
        title={
          pendingStatus?.status === "archived"
            ? t("devices.confirm.archiveTitle", { count: pendingStatus.ids.length })
            : pendingStatus?.status === "rejected"
              ? t("devices.confirm.rejectTitle")
              : t("devices.confirm.approveTitle", { count: pendingStatus?.ids.length ?? 0 })
        }
        description={
          pendingStatus?.status === "archived"
            ? t("devices.confirm.archiveBody")
            : pendingStatus?.status === "rejected"
              ? t("devices.confirm.rejectBody")
              : t("devices.confirm.approveBody")
        }
        tone={pendingStatus?.status === "active" ? "default" : "destructive"}
        confirmLabel={
          pendingStatus?.status === "archived"
            ? t("devices.archive")
            : pendingStatus?.status === "rejected"
              ? t("devices.reject")
              : t("devices.approveShort")
        }
        onConfirm={() => (pendingStatus ? changeStatus(pendingStatus.ids, pendingStatus.status) : undefined)}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        tone="destructive"
        title={
          pendingDelete?.length === 1
            ? t("devices.confirm.deleteOneTitle", { name: pendingDelete[0].name })
            : t("devices.confirm.deleteTitle", { count: pendingDelete?.length ?? 0 })
        }
        description={t("devices.confirm.deleteBody")}
        confirmLabel={t("devices.delete")}
        onConfirm={() => (pendingDelete ? deleteDevices(pendingDelete.map((r) => r.id)) : undefined)}
      />

      {syncDialog && sync ? (
        <PublishDialog
          ids={syncDialog.ids}
          open
          onOpenChange={(o) => !o && setSyncDialog(null)}
          money={money}
          compare={sync.compare}
          lists={sync.lists}
          canPublish={syncDialog.publish && capabilities.canPublish && writable}
          onFinished={() => void queryClient.invalidateQueries({ queryKey: ["devices"] })}
        />
      ) : null}

      {report ? (
        <ReportDialog
          open
          onOpenChange={(o) => !o && setReport(null)}
          initial={report}
          projection={projection}
          brands={brands}
          canFinancial={capabilities.canFinancialReport}
          filterChips={chips.map((c) => c.label)}
          lockedBrandId={lockedBrandId}
        />
      ) : null}
    </div>
  );
}

function SummaryStrip({
  projection,
  summary,
  money,
  loading,
}: {
  projection: DataProjection;
  summary: DevicePageResponse["summary"];
  money: MoneyFormat;
  loading: boolean;
}) {
  const { t } = useI18n();
  if (loading || !summary) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: projection === "full" ? 6 : 4 }, (_, i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
    );
  }
  const s = summary.stats;
  const items: Array<{ label: string; value?: string; money?: string | number | null; tone?: string; hint?: string }> =
    projection === "full"
      ? [
          { label: t("devices.stats.devices"), value: formatNumber(s.count), hint: s.pending_count ? t("devices.stats.pending", { count: s.pending_count }) : undefined },
          { label: t("devices.stats.purchaseTotal"), money: s.total_purchase },
          { label: t("devices.stats.costTotal"), money: s.total_cost, tone: "text-gold" },
          { label: t("devices.stats.sellingTotal"), money: s.total_selling, tone: "text-brand" },
          { label: t("devices.stats.profitTotal"), money: s.total_profit, tone: "text-success" },
          { label: t("devices.stats.avgMargin"), value: s.avg_margin_pct === null || s.avg_margin_pct === undefined ? "—" : formatPercent(s.avg_margin_pct) },
        ]
      : [
          { label: t("devices.stats.devices"), value: formatNumber(s.count), hint: s.brand_count ? t("devices.stats.brands", { count: s.brand_count }) : undefined },
          { label: t("devices.stats.lowest"), money: s.min_price },
          { label: t("devices.stats.average"), money: s.avg_price === null || s.avg_price === undefined ? null : String(Math.round(Number(s.avg_price))) },
          { label: t("devices.stats.highest"), money: s.max_price, tone: "text-brand" },
        ];
  return (
    <dl className={projection === "full" ? "grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" : "grid grid-cols-2 gap-2 sm:grid-cols-4"}>
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border bg-card px-3.5 py-2.5 shadow-card">
          <dt className="text-[0.72rem] font-medium text-muted-foreground">{item.label}</dt>
          <dd className={`mt-0.5 truncate text-base font-semibold ${item.tone ?? ""}`}>
            {"money" in item ? <Money value={item.money} format={money} /> : item.value}
          </dd>
          {item.hint ? <dd className="text-[0.7rem] text-muted-foreground">{item.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-card">
      <div className="h-11 border-b bg-surface-raised" />
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b px-4 py-4 last:border-0">
          <Skeleton className="h-8 w-1 rounded-full" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="ms-auto h-4 w-24" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}
