import type { Metadata } from "next";
import { Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { WorkspaceSkeleton } from "@/components/common/skeletons";
import { ToneBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { BrandFormDialog } from "@/features/catalogue/components/brand-form-dialog";
import { DevicesWorkspace } from "@/features/devices/components/devices-workspace";
import { loadWorkspace } from "@/features/devices/load-workspace";
import { requireSession } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { brandColor } from "@/lib/brand-colors";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Brand" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function BrandPage({ params, searchParams }: PageProps<"/brands/[id]">) {
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <BrandContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function BrandContent({
  params,
  searchParams,
}: {
  params: PageProps<"/brands/[id]">["params"];
  searchParams: PageProps<"/brands/[id]">["searchParams"];
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const session = await requireSession();
  const { t } = await getT();
  if (session.projection !== "full" && session.projection !== "catalog") return <AccessDenied />;

  const supabase = await createClient();
  const { data: brand } = await supabase.from("brands").select("*").eq("id", id).maybeSingle();
  if (!brand) notFound();

  const data = await loadWorkspace(session, await searchParams, { lockedBrandId: id });
  const color = brandColor(brand.accent_color, brand.name);
  const canManage = session.effectivePermissions.has("brands.manage") && !session.previewRole;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t("nav.home"), href: "/dashboard" }, { label: t("nav.brands"), href: "/brands" }, { label: brand.name }]}
        title={
          <span className="flex items-center gap-3">
            {brand.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-provided https logo
              <img src={brand.logo_url} alt="" className="size-10 rounded-lg border bg-white object-contain p-1" />
            ) : (
              <span className="flex size-10 items-center justify-center rounded-lg font-heading text-sm font-bold text-white" style={{ backgroundColor: color }}>
                {brand.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            {brand.name}
            {!brand.is_active ? <ToneBadge tone="warning">{t("common.inactive")}</ToneBadge> : null}
          </span>
        }
        description={brand.description ?? undefined}
        actions={
          canManage ? (
            <BrandFormDialog
              initial={{
                id: brand.id,
                name: brand.name,
                description: brand.description ?? "",
                logoUrl: brand.logo_url ?? "",
                accentColor: brand.accent_color ?? color,
                isActive: brand.is_active,
                sortOrder: brand.sort_order,
              }}
              trigger={
                <Button variant="outline">
                  <Pencil /> {t("brands.editBrand")}
                </Button>
              }
            />
          ) : null
        }
      />
      <div className="mb-5 h-1 rounded-full" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
      <DevicesWorkspace {...data} lockedBrandId={id} searchPlaceholder={t("brands.searchDevices", { brand: brand.name })} />
    </>
  );
}
