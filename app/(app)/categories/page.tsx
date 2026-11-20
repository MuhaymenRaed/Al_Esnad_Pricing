import type { Metadata } from "next";
import { Suspense } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { PageSkeleton } from "@/components/common/skeletons";
import { CategoriesManager } from "@/features/catalogue/components/categories-manager";
import type { DeviceSummary } from "@/features/devices/types";
import { requireSession } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { caps } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Categories" };

export default function CategoriesPage() {
  return (
    <Suspense fallback={<PageSkeleton cards={0} />}>
      <CategoriesContent />
    </Suspense>
  );
}

async function CategoriesContent() {
  const session = await requireSession();
  const { t } = await getT();
  if (!session.effectivePermissions.has("categories.manage") || session.previewRole) return <AccessDenied />;
  const supabase = await createClient();
  const [{ data, error }, summary] = await Promise.all([
    supabase.from("categories").select("*").order("name"),
    caps.readFull(session.permissions) ? supabase.rpc("device_summary", { p_filters: {} }) : Promise.resolve({ data: null }),
  ]);
  if (error) throw error;
  const counts = new Map(((summary.data as DeviceSummary | null)?.categories ?? []).map((c) => [c.id, c.count]));

  return (
    <>
      <PageHeader
        title={t("categories.title")}
        description={t("categories.desc")}
        breadcrumbs={[{ label: t("nav.home"), href: "/dashboard" }, { label: t("nav.categories") }]}
      />
      <CategoriesManager
        timezone={session.settings.timezone}
        categories={(data ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          isActive: c.is_active,
          createdAt: c.created_at,
          deviceCount: summary.data ? (counts.get(c.id) ?? 0) : null,
        }))}
      />
    </>
  );
}
