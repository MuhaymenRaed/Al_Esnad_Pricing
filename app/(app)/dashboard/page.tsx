import type { Metadata } from "next";
import {
  Activity,
  ArrowRight,
  BadgeDollarSign,
  CircleCheck,
  ClipboardList,
  Clock,
  Coins,
  FolderTree,
  Layers,
  MailQuestion,
  Percent,
  Plus,
  Smartphone,
  Tags,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Money } from "@/components/common/money";
import { PageHeader } from "@/components/common/page-header";
import { PageSkeleton } from "@/components/common/skeletons";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { describeAudit } from "@/features/audit/describe";
import { fetchDevicePage } from "@/features/devices/queries";
import { requireSession, type SessionContext } from "@/lib/auth/session";
import { brandColor } from "@/lib/brand-colors";
import { formatNumber, formatPercent, formatRelative, type MoneyFormat } from "@/lib/format";
import type { Locale, TFunction } from "@/lib/i18n/core";
import { getT } from "@/lib/i18n/server";
import { ROLES, caps } from "@/lib/permissions";
import { sumAmounts } from "@/lib/pricing/calculate";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, DeviceStatus } from "@/types/database";

export const metadata: Metadata = { title: "Dashboard" };

type Summary = {
  brands?: number;
  categories?: number;
  catalog_devices?: number;
  catalog_added_30d?: number;
  devices_by_status?: Partial<Record<DeviceStatus, number>>;
  devices_total?: number;
  financials?: {
    active_devices: number;
    total_purchase: number;
    total_discount: number;
    total_payback: number;
    total_cost: number;
    total_profit: number;
    total_selling: number;
    avg_margin_pct: number | null;
  };
  users_total?: number;
  users_active?: number;
  users_by_role?: Partial<Record<AppRole, number>>;
  invitations_pending?: number;
  my_submissions?: Partial<Record<DeviceStatus, number>>;
};

type Ctx = { session: SessionContext; t: TFunction; locale: Locale; money: MoneyFormat };

export default function DashboardPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DashboardContent />
    </Suspense>
  );
}

async function DashboardContent() {
  const session = await requireSession();
  const { t, locale } = await getT();
  const supabase = await createClient();
  const { data } = await supabase.rpc("dashboard_summary");
  const summary = (data ?? {}) as Summary;
  const role = session.effectiveRole;
  const p = session.effectivePermissions;
  const money: MoneyFormat = { currency: session.settings.currencyCode, decimals: session.settings.currencyDecimals };
  const ctx: Ctx = { session, t, locale, money };
  const name = session.fullName?.split(" ")[0] ?? session.email.split("@")[0];
  const descriptions: Record<AppRole, string> = {
    administrator: t("dashboard.descAdministrator"),
    pricing_manager: t("dashboard.descPricingManager"),
    viewer: t("dashboard.descViewer"),
    data_entry: t("dashboard.descDataEntry"),
  };

  const header = (
    <PageHeader
      eyebrow={t("dashboard.welcome", { name })}
      title={t(`titles.${role}`)}
      description={descriptions[role]}
      actions={
        !session.previewRole && caps.createDevice(p) ? (
          <Button asChild size="lg">
            <Link href="/devices/new">
              <Plus /> {t("nav.newDevice")}
            </Link>
          </Button>
        ) : !session.previewRole && caps.submit(p) && role === "data_entry" ? (
          <Button asChild size="lg">
            <Link href="/devices/new">
              <ClipboardList /> {t("nav.submitDevice")}
            </Link>
          </Button>
        ) : null
      }
    />
  );

  if (session.projection === "submissions") return <>{header}<DataEntryDashboard summary={summary} ctx={ctx} /></>;
  if (session.projection === "catalog") return <>{header}<CatalogDashboard summary={summary} ctx={ctx} /></>;

  const byStatus = summary.devices_by_status ?? {};
  const f = summary.financials;
  const isEmpty = (summary.brands ?? 0) === 0 || (summary.categories ?? 0) === 0;

  return (
    <>
      {header}
      <div className="space-y-6">
        {isEmpty && !session.previewRole ? <GettingStarted summary={summary} ctx={ctx} /> : null}

        {role === "administrator" && summary.users_total !== undefined ? (
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t("dashboard.totalUsers")} value={formatNumber(summary.users_total)} icon={<Users />} href="/users" />
            <StatCard label={t("dashboard.activeUsers")} value={formatNumber(summary.users_active)} icon={<CircleCheck />} tone="success" href="/users" />
            <StatCard label={t("dashboard.pendingInvitations")} value={formatNumber(summary.invitations_pending)} icon={<MailQuestion />} tone="warning" href="/users" />
            <StatCard label={t("dashboard.brands")} value={formatNumber(summary.brands)} hint={t("dashboard.categoriesCount", { count: summary.categories ?? 0 })} icon={<Tags />} href="/brands" />
          </section>
        ) : null}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={t("dashboard.activeDevices")} value={formatNumber(byStatus.active ?? 0)} icon={<Smartphone />} tone="success" href="/devices?status=active" />
          <StatCard
            label={t("dashboard.pendingReview")}
            value={formatNumber(byStatus.pending_review ?? 0)}
            icon={<Clock />}
            tone="warning"
            href="/devices?status=pending_review&sort=oldest"
            hint={byStatus.pending_review ? t("dashboard.waitingForPricing") : t("dashboard.queueClear")}
          />
          <StatCard label={t("dashboard.drafts")} value={formatNumber(byStatus.draft ?? 0)} icon={<Layers />} href="/devices?status=draft" />
          <StatCard label={t("dashboard.rejectedArchived")} value={formatNumber((byStatus.rejected ?? 0) + (byStatus.archived ?? 0))} icon={<XCircle />} href="/devices?status=rejected,archived" />
        </section>

        {f && p.has("financials.read") ? (
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle>{t("dashboard.financialOverview")}</CardTitle>
              <CardDescription>{t("dashboard.financialOverviewDesc", { count: formatNumber(f.active_devices) })}</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Kpi label={t("dashboard.purchaseValue")} icon={<Coins />} value={<Money value={f.total_purchase} format={money} />} />
              <Kpi
                label={t("dashboard.supplierBenefits")}
                icon={<BadgeDollarSign />}
                value={<Money value={sumAmounts([f.total_discount, f.total_payback], money.decimals)} format={money} />}
                hint={t("dashboard.supplierBenefitsHint")}
              />
              <Kpi label={t("dashboard.finalCost")} value={<Money value={f.total_cost} format={money} className="text-gold" />} />
              <Kpi label={t("dashboard.totalProfit")} icon={<TrendingUp />} value={<Money value={f.total_profit} format={money} className="text-success" />} />
              <Kpi label={t("dashboard.sellingValue")} value={<Money value={f.total_selling} format={money} className="text-brand" />} />
              <Kpi label={t("dashboard.avgMargin")} icon={<Percent />} value={f.avg_margin_pct === null ? "—" : formatPercent(f.avg_margin_pct)} hint={t("dashboard.avgMarginHint")} />
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Suspense fallback={<Card className="h-72 animate-pulse shadow-card" />}>
            <PendingQueue ctx={ctx} />
          </Suspense>
          {role === "administrator" && p.has("audit.read") ? (
            <Suspense fallback={<Card className="h-72 animate-pulse shadow-card" />}>
              <RecentActivity ctx={ctx} />
            </Suspense>
          ) : (
            <QuickLinks ctx={ctx} />
          )}
        </div>

        {role === "administrator" && summary.users_by_role ? <UsersByRole counts={summary.users_by_role} t={t} /> : null}
      </div>
    </>
  );
}

function GettingStarted({ summary, ctx }: { summary: Summary; ctx: Ctx }) {
  const { t, session } = ctx;
  const p = session.permissions;
  return (
    <Card className="border-brand/30 bg-brand-soft/40 shadow-card">
      <CardHeader>
        <CardTitle>{t("dashboard.gettingStarted")}</CardTitle>
        <CardDescription>{t("dashboard.gettingStartedBody")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {p.has("brands.manage") ? (
          <Button asChild variant={summary.brands ? "outline" : "default"}>
            <Link href="/brands">
              <Tags /> {t("brands.newBrand")}
            </Link>
          </Button>
        ) : null}
        {p.has("categories.manage") ? (
          <Button asChild variant={summary.categories ? "outline" : "default"}>
            <Link href="/categories">
              <FolderTree /> {t("categories.newCategory")}
            </Link>
          </Button>
        ) : null}
        {caps.createDevice(p) ? (
          <Button asChild variant="outline">
            <Link href="/devices/new">
              <Plus /> {t("nav.newDevice")}
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value, hint, icon }: { label: string; value: React.ReactNode; hint?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-surface-raised p-3.5">
      <p className="flex items-center gap-1.5 text-[0.75rem] font-medium text-muted-foreground [&_svg]:size-3.5">
        {icon}
        {label}
      </p>
      <p className="mt-1.5 font-heading text-lg font-semibold">{value}</p>
      {hint ? <p className="text-[0.7rem] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function ViewAll({ href, label }: { href: string; label: string }) {
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link href={href}>
        {label} <ArrowRight className="rtl:rotate-180" />
      </Link>
    </Button>
  );
}

async function PendingQueue({ ctx }: { ctx: Ctx }) {
  const { t, locale, session, money } = ctx;
  const supabase = await createClient();
  const page = await fetchDevicePage({
    supabase,
    projection: "full",
    filters: { statuses: ["pending_review"], sort: "oldest" },
    timezone: session.settings.timezone,
    limit: 6,
  }).catch(() => null);
  const rows = page?.rows ?? [];
  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle>{t("dashboard.pendingReview")}</CardTitle>
        <CardDescription>{t("dashboard.pendingQueueDesc")}</CardDescription>
        <CardAction>
          <ViewAll href="/devices?status=pending_review&sort=oldest" label={t("common.viewAll")} />
        </CardAction>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <CircleCheck className="size-8 text-success" />
            {t("dashboard.nothingPending")}
          </div>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/devices/${r.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-accent">
                  <span className="h-8 w-1 rounded-full" style={{ backgroundColor: r.brandColor }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {r.brandName} · {t("dashboard.submitted", { time: formatRelative(r.createdAt, locale) })}
                    </span>
                  </span>
                  <span className="text-end">
                    <span className="block text-[0.7rem] text-muted-foreground">{t("dashboard.purchase")}</span>
                    <Money value={r.purchasePrice} format={money} className="text-sm" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

async function RecentActivity({ ctx }: { ctx: Ctx }) {
  const { t, locale } = ctx;
  const supabase = await createClient();
  const { data } = await supabase
    .from("audit_logs")
    .select("id, action, table_name, record_id, created_at, old_data, new_data, actor:profiles!audit_logs_actor_id_fkey(full_name, email)")
    .order("created_at", { ascending: false })
    .limit(8);
  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-4" /> {t("dashboard.recentActivity")}
        </CardTitle>
        <CardAction>
          <ViewAll href="/audit-logs" label={t("dashboard.auditLog")} />
        </CardAction>
      </CardHeader>
      <CardContent>
        {!data?.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("dashboard.noActivity")}</p>
        ) : (
          <ol className="space-y-3">
            {data.map((log) => {
              const actor = Array.isArray(log.actor) ? log.actor[0] : log.actor;
              return (
                <li key={log.id} className="flex gap-3 text-sm">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" />
                  <div className="min-w-0">
                    <p className="truncate">
                      <span className="font-medium">{actor?.full_name ?? actor?.email ?? t("audit.s.system")}</span>{" "}
                      <span className="text-muted-foreground">{describeAudit(log, t).summary}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{formatRelative(log.created_at, locale)}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function UsersByRole({ counts, t }: { counts: Partial<Record<AppRole, number>>; t: TFunction }) {
  const max = Math.max(1, ...ROLES.map((r) => counts[r] ?? 0));
  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle>{t("dashboard.usersByRole")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {ROLES.map((r) => {
            const n = counts[r] ?? 0;
            return (
              <li key={r} className="grid grid-cols-[150px_minmax(0,1fr)_40px] items-center gap-3 text-sm">
                <span className="truncate text-muted-foreground">{t(`roles.${r}`)}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-charcoal" style={{ width: `${(n / max) * 100}%` }} />
                </span>
                <span className="text-end font-medium tabular-nums">{n}</span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function QuickLinks({ ctx }: { ctx: Ctx }) {
  const { t, session } = ctx;
  const p = session.effectivePermissions;
  const links = [
    { href: "/devices", label: t("dashboard.linkDevices"), desc: t("dashboard.linkDevicesDesc"), show: true },
    { href: "/brands", label: t("dashboard.linkBrands"), desc: t("dashboard.linkBrandsDesc"), show: p.has("brands.read") },
    { href: "/reports", label: t("dashboard.linkReports"), desc: t("dashboard.linkReportsDesc"), show: p.has("reports.export") },
    { href: "/categories", label: t("dashboard.linkCategories"), desc: t("dashboard.linkCategoriesDesc"), show: p.has("categories.manage") },
  ].filter((l) => l.show);
  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle>{t("dashboard.quickAccess")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="group flex items-center justify-between rounded-lg border px-3.5 py-3 hover:bg-accent">
            <span>
              <span className="block text-sm font-medium">{l.label}</span>
              <span className="text-xs text-muted-foreground">{l.desc}</span>
            </span>
            <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

async function CatalogDashboard({ summary, ctx }: { summary: Summary; ctx: Ctx }) {
  const { t, session, money } = ctx;
  const supabase = await createClient();
  const [{ data: brands }, recent] = await Promise.all([
    supabase.rpc("brand_overview"),
    fetchDevicePage({ supabase, projection: "catalog", filters: { sort: "newest" }, timezone: session.settings.timezone, limit: 6 }).catch(() => null),
  ]);
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label={t("dashboard.catalogDevices")} value={formatNumber(summary.catalog_devices ?? 0)} icon={<Smartphone />} tone="brand" href="/devices" />
        <StatCard label={t("dashboard.brands")} value={formatNumber(summary.brands ?? 0)} icon={<Tags />} href="/brands" />
        <StatCard label={t("dashboard.added30d")} value={formatNumber(summary.catalog_added_30d ?? 0)} icon={<Plus />} href="/devices?recent=30d&sort=newest" />
      </section>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle>{t("dashboard.browseByBrand")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {(brands ?? []).map((b) => (
              <Link key={b.id} href={`/brands/${b.id}`} className="flex items-center gap-3 rounded-lg border px-3 py-2.5 hover:bg-accent">
                <span className="flex size-8 items-center justify-center rounded-md text-xs font-bold text-white" style={{ backgroundColor: brandColor(b.accent_color, b.name) }}>
                  {b.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{b.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{b.catalog_count}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle>{t("dashboard.recentlyAdded")}</CardTitle>
            <CardAction>
              <ViewAll href="/devices?sort=newest" label={t("common.viewAll")} />
            </CardAction>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {(recent?.rows ?? []).map((r) => (
                <li key={r.id}>
                  <Link href={`/devices/${r.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-accent">
                    <span className="h-8 w-1 rounded-full" style={{ backgroundColor: r.brandColor }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.name}</span>
                      <span className="text-xs text-muted-foreground">{r.brandName}</span>
                    </span>
                    <Money value={r.sellingPrice} format={money} className="text-sm font-semibold text-brand" />
                  </Link>
                </li>
              ))}
              {!recent?.rows.length ? <li className="py-8 text-center text-sm text-muted-foreground">{t("dashboard.noDevicesYet")}</li> : null}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

async function DataEntryDashboard({ summary, ctx }: { summary: Summary; ctx: Ctx }) {
  const { t, locale, session } = ctx;
  const supabase = await createClient();
  const recent = await fetchDevicePage({ supabase, projection: "submissions", filters: {}, timezone: session.settings.timezone, limit: 6 }).catch(() => null);
  const mine = summary.my_submissions ?? {};
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t("dashboard.pendingReview")} value={formatNumber(mine.pending_review ?? 0)} icon={<Clock />} tone="warning" href="/devices" />
        <StatCard label={t("dashboard.approved")} value={formatNumber(mine.active ?? 0)} icon={<CircleCheck />} tone="success" />
        <StatCard label={t("dashboard.rejected")} value={formatNumber(mine.rejected ?? 0)} icon={<XCircle />} href="/devices" />
        <StatCard label={t("dashboard.totalSubmitted")} value={formatNumber(Object.values(mine).reduce((a, b) => a + (b ?? 0), 0))} icon={<ClipboardList />} />
      </section>
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>{t("dashboard.latestSubmissions")}</CardTitle>
          <CardAction>
            <ViewAll href="/devices" label={t("common.viewAll")} />
          </CardAction>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {(recent?.rows ?? []).map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                <span className="h-8 w-1 rounded-full" style={{ backgroundColor: r.brandColor }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.brandName} · {formatRelative(r.createdAt, locale)}
                  </span>
                </span>
                {r.status ? <StatusBadge status={r.status} /> : null}
              </li>
            ))}
            {!recent?.rows.length ? (
              <li className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
                {t("dashboard.noSubmissions")}
                {!session.previewRole ? (
                  <Button asChild size="sm">
                    <Link href="/devices/new">
                      <ClipboardList /> {t("dashboard.submitFirst")}
                    </Link>
                  </Button>
                ) : null}
              </li>
            ) : null}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
