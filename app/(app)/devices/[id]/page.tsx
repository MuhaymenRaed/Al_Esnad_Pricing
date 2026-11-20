import type { Metadata } from "next";
import { CalendarClock, History, Printer, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { Money } from "@/components/common/money";
import { PageHeader } from "@/components/common/page-header";
import { FormSkeleton } from "@/components/common/skeletons";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ManagedDeviceForm } from "@/features/devices/components/managed-device-form";
import { SubmissionForm } from "@/features/devices/components/submission-form";
import { fetchCatalogDevice, fetchLookups, fetchManagedDevice, fetchSubmission } from "@/features/devices/queries";
import { requireSession } from "@/lib/auth/session";
import { formatDate, formatRelative } from "@/lib/format";
import type { TFunction } from "@/lib/i18n/core";
import { getT } from "@/lib/i18n/server";
import { caps } from "@/lib/permissions";
import { metadataToEntries } from "@/lib/validation/schemas";
import type { DeviceStatus } from "@/types/database";

export const metadata: Metadata = { title: "Device" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function DevicePage({ params }: PageProps<"/devices/[id]">) {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <DeviceContent params={params} />
    </Suspense>
  );
}

async function DeviceContent({ params }: { params: PageProps<"/devices/[id]">["params"] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const session = await requireSession();
  const { t, locale } = await getT();
  const p = session.effectivePermissions;
  const money = { currency: session.settings.currencyCode, decimals: session.settings.currencyDecimals };
  const tz = session.settings.timezone;
  const home = { label: t("nav.home"), href: "/dashboard" };

  if (session.projection === "full") {
    const [record, lookups] = await Promise.all([fetchManagedDevice(id), fetchLookups({ includeInactive: true })]);
    if (!record) notFound();
    const { device, financials: f } = record;
    return (
      <>
        <PageHeader
          title={device.name}
          eyebrow={
            <span className="flex items-center gap-2 normal-case">
              <span className="size-2 rounded-full" style={{ backgroundColor: lookups.brands.find((b) => b.id === device.brand_id)?.color }} />
              {record.brand.name}
              {record.category ? ` · ${record.category.name}` : ""}
            </span>
          }
          breadcrumbs={[home, { label: t("nav.devices"), href: "/devices" }, { label: device.name }]}
          actions={<StatusBadge status={device.status} className="text-sm" />}
        />
        <ManagedDeviceForm
          initial={{
            id: device.id,
            updatedAt: device.updated_at,
            status: device.status,
            basics: {
              name: device.name,
              brandId: device.brand_id,
              categoryId: device.category_id ?? "",
              modelNumber: device.model_number ?? "",
              sku: device.sku ?? "",
              metadata: metadataToEntries(device.metadata),
            },
            financials: {
              officialPurchasePrice: f ? String(f.official_purchase_price) : "",
              discountType: f?.discount_type ?? "percentage",
              discountValue: f ? String(Number(f.discount_value)) : "",
              paybackAmount: f ? String(f.payback_amount) : "",
              companyProfit: f ? String(f.company_profit) : "",
            },
          }}
          brands={lookups.brands}
          categories={lookups.categories}
          money={money}
          canReview={caps.review(p)}
          readOnly={Boolean(session.previewRole) || !caps.editDevice(p)}
        />
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          {record.history ? (
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="size-4" /> {t("devices.detail.history")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {record.history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("devices.detail.noHistory")}</p>
                ) : (
                  <ol className="relative space-y-4 border-s ps-5">
                    {record.history.map((h) => (
                      <li key={h.id} className="relative">
                        <span className="absolute -start-[25px] top-1 size-2.5 rounded-full border-2 border-background bg-brand" />
                        <p className="text-sm">
                          <span className="font-medium">{h.actor ?? t("devices.detail.system")}</span>{" "}
                          <span className="text-muted-foreground">{describeChange(h, t)}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">{formatDate(h.created_at, tz, "datetime", locale)}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          ) : (
            <div />
          )}
          <Card className="shadow-card">
            <CardContent className="space-y-3 pt-5 text-sm">
              <Meta icon={<UserRound />} label={t("devices.detail.createdBy")} value={record.created_by_name ?? "—"} />
              <Meta icon={<CalendarClock />} label={t("devices.detail.created")} value={formatDate(device.created_at, tz, "datetime", locale)} />
              <Meta icon={<UserRound />} label={t("devices.detail.updatedBy")} value={record.updated_by_name ?? "—"} />
              <Meta
                icon={<CalendarClock />}
                label={t("devices.detail.updated")}
                value={`${formatDate(device.updated_at, tz, "datetime", locale)} (${formatRelative(device.updated_at, locale)})`}
              />
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  if (session.projection === "catalog") {
    const d = await fetchCatalogDevice(id);
    if (!d) notFound();
    return (
      <>
        <PageHeader
          title={d.name}
          breadcrumbs={[home, { label: t("nav.catalogue"), href: "/devices" }, { label: d.name }]}
          actions={
            p.has("reports.export") ? (
              <Button variant="outline" asChild>
                <Link href={`/reports?ids=${d.id}`}>
                  <Printer /> {t("common.print")}
                </Link>
              </Button>
            ) : null
          }
        />
        <Card className="max-w-2xl overflow-hidden shadow-card">
          <div className="h-1.5" style={{ backgroundColor: d.brand_color }} />
          <CardContent className="grid gap-6 pt-6 sm:grid-cols-2">
            <dl className="space-y-4 text-sm">
              <Meta label={t("devices.detail.brand")} value={d.brand_name} />
              <Meta label={t("devices.detail.category")} value={d.category_name ?? "—"} />
              <Meta label={t("devices.detail.updated")} value={formatDate(d.updated_at, tz, "date", locale)} />
            </dl>
            <div className="flex flex-col justify-center rounded-xl bg-brand-soft p-5">
              <span className="text-xs font-semibold tracking-wide text-brand uppercase">{t("form.sellingPrice")}</span>
              <Money value={String(d.final_selling_price)} format={money} className="mt-1 text-3xl font-bold text-brand" />
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  if (session.projection === "submissions") {
    const s = await fetchSubmission(id);
    if (!s) notFound();
    const crumbs = [home, { label: t("nav.submissions"), href: "/devices" }, { label: s.name }];
    const canEdit = p.has("devices.edit_own_submissions") && ["pending_review", "rejected", "draft"].includes(s.status);
    if (canEdit) {
      const { brands, categories } = await fetchLookups();
      return (
        <>
          <PageHeader title={s.name} breadcrumbs={crumbs} actions={<StatusBadge status={s.status} />} description={t("devices.detail.editResubmit")} />
          <SubmissionForm
            brands={brands}
            categories={categories}
            money={money}
            readOnly={Boolean(session.previewRole)}
            editId={s.id}
            initial={{
              name: s.name,
              brandId: s.brand_id,
              categoryId: s.category_id ?? "",
              modelNumber: s.model_number ?? "",
              sku: s.sku ?? "",
              metadata: metadataToEntries(s.metadata),
            }}
          />
        </>
      );
    }
    return (
      <>
        <PageHeader title={s.name} breadcrumbs={crumbs} actions={<StatusBadge status={s.status} />} />
        <Card className="max-w-2xl shadow-card">
          <CardContent className="grid gap-4 pt-6 text-sm sm:grid-cols-2">
            <Meta label={t("devices.detail.brand")} value={s.brand_name} />
            <Meta label={t("devices.detail.category")} value={s.category_name ?? "—"} />
            <Meta label={t("devices.detail.modelNumber")} value={s.model_number ?? "—"} />
            <Meta label={t("devices.detail.sku")} value={s.sku ?? "—"} />
            <Meta label={t("devices.detail.submitted")} value={formatDate(s.created_at, tz, "datetime", locale)} />
            <Meta label={t("devices.detail.updated")} value={formatDate(s.updated_at, tz, "datetime", locale)} />
          </CardContent>
        </Card>
      </>
    );
  }

  return <AccessDenied />;
}

function Meta({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      {icon ? <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{icon}</span> : null}
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-medium">{value}</p>
      </div>
    </div>
  );
}

function describeChange(
  h: { action: string; table_name: string; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null },
  t: TFunction,
) {
  if (h.table_name === "device_financials") return h.action === "INSERT" ? t("devices.detail.historyPricing") : t("devices.detail.historyPricingChanged");
  if (h.action === "INSERT") return t("devices.detail.historyCreated");
  if (h.old_data?.status !== h.new_data?.status) {
    return t("devices.detail.historyStatus", {
      from: t(`status.${h.old_data?.status as DeviceStatus}`),
      to: t(`status.${h.new_data?.status as DeviceStatus}`),
    });
  }
  return t("devices.detail.historyEdited");
}
