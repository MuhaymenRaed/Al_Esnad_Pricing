import type { Metadata } from "next";
import { Suspense } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { PageSkeleton } from "@/components/common/skeletons";
import { fetchLookups } from "@/features/devices/queries";
import { ReportCenter } from "@/features/reports/components/report-center";
import { requireSession } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { caps } from "@/lib/permissions";

export const metadata: Metadata = { title: "Reports" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ReportsPage({ searchParams }: PageProps<"/reports">) {
  return (
    <Suspense fallback={<PageSkeleton cards={3} />}>
      <ReportsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ReportsContent({ searchParams }: { searchParams: PageProps<"/reports">["searchParams"] }) {
  const session = await requireSession();
  const { t } = await getT();
  const p = session.effectivePermissions;
  if (!p.has("reports.export") || !session.projection) return <AccessDenied />;
  const sp = await searchParams;
  const ids = (typeof sp.ids === "string" ? sp.ids.split(",") : []).filter((x) => UUID.test(x)).slice(0, 500);
  const { brands } = session.projection === "submissions" ? { brands: [] } : await fetchLookups();

  return (
    <>
      <PageHeader
        title={t("reports.title")}
        description={t("reports.desc")}
        breadcrumbs={[{ label: t("nav.home"), href: "/dashboard" }, { label: t("nav.reports") }]}
      />
      <ReportCenter projection={session.projection} brands={brands} canFinancial={caps.financialReport(p)} presetIds={ids} />
    </>
  );
}
