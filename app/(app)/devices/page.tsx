import type { Metadata } from "next";
import { ClipboardList, Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { WorkspaceSkeleton } from "@/components/common/skeletons";
import { Button } from "@/components/ui/button";
import { DevicesWorkspace } from "@/features/devices/components/devices-workspace";
import { ErpImportButton } from "@/features/devices/components/erp-import-dialog";
import { loadWorkspace } from "@/features/devices/load-workspace";
import { requireSession } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { caps } from "@/lib/permissions";
import { syncConfig } from "@/lib/price-sync/targets";

export const metadata: Metadata = { title: "Devices" };

export default function DevicesPage({ searchParams }: PageProps<"/devices">) {
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <DevicesContent searchParams={searchParams} />
    </Suspense>
  );
}

async function DevicesContent({ searchParams }: { searchParams: PageProps<"/devices">["searchParams"] }) {
  const session = await requireSession();
  if (!session.projection) return <AccessDenied />;
  const [data, { t }] = await Promise.all([loadWorkspace(session, await searchParams), getT()]);
  const p = session.effectivePermissions;
  const writable = !session.previewRole;

  const heading =
    data.projection === "full"
      ? { title: t("devices.titleFull"), description: t("devices.descFull"), search: t("devices.searchFull") }
      : data.projection === "catalog"
        ? { title: t("titles.viewer"), description: t("devices.descCatalog"), search: t("devices.searchCatalog") }
        : { title: t("nav.submissions"), description: t("devices.descSubmissions"), search: t("devices.searchSubmissions") };

  return (
    <>
      <PageHeader
        title={heading.title}
        description={heading.description}
        actions={
          writable && caps.createDevice(p) ? (
            <div className="flex flex-wrap items-center gap-2">
              {data.projection === "full" && caps.importDevices(p) && syncConfig().erpnext ? <ErpImportButton money={data.money} /> : null}
              <Button asChild size="lg">
                <Link href="/devices/new">
                  <Plus />
                  {t("nav.newDevice")}
                </Link>
              </Button>
            </div>
          ) : writable && caps.submit(p) && data.projection === "submissions" ? (
            <Button asChild size="lg">
              <Link href="/devices/new">
                <ClipboardList />
                {t("nav.submitDevice")}
              </Link>
            </Button>
          ) : null
        }
      />
      <DevicesWorkspace {...data} searchPlaceholder={heading.search} />
    </>
  );
}
