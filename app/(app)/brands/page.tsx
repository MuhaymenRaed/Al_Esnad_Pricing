import type { Metadata } from "next";
import { Suspense } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { PageSkeleton } from "@/components/common/skeletons";
import { BrandsGrid } from "@/features/catalogue/components/brands-grid";
import { requireSession } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { brandColor } from "@/lib/brand-colors";
import { caps } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Brands" };

export default function BrandsPage() {
  return (
    <Suspense fallback={<PageSkeleton cards={6} />}>
      <BrandsContent />
    </Suspense>
  );
}

async function BrandsContent() {
  const session = await requireSession();
  const { t } = await getT();
  const p = session.effectivePermissions;
  if (!p.has("brands.read") || (session.projection !== "full" && session.projection !== "catalog")) return <AccessDenied />;
  const canManage = p.has("brands.manage") && !session.previewRole;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("brand_overview", { p_include_inactive: canManage });
  if (error) throw error;

  return (
    <>
      <PageHeader
        title={t("brands.title")}
        description={t("brands.desc")}
        breadcrumbs={[{ label: t("nav.home"), href: "/dashboard" }, { label: t("nav.brands") }]}
      />
      <BrandsGrid
        brands={(data ?? []).map((b) => ({
          id: b.id,
          name: b.name,
          description: b.description,
          logoUrl: b.logo_url,
          color: brandColor(b.accent_color, b.name),
          rawColor: b.accent_color,
          isActive: b.is_active,
          sortOrder: b.sort_order,
          catalogCount: Number(b.catalog_count),
          totalCount: session.projection === "full" && b.total_count !== null ? Number(b.total_count) : null,
          pendingCount: session.projection === "full" && b.pending_count !== null ? Number(b.pending_count) : null,
        }))}
        canManage={canManage}
        canExport={p.has("reports.export")}
        canFinancial={caps.financialReport(p)}
        projection={session.projection}
      />
    </>
  );
}
