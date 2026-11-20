import type { Metadata } from "next";
import { Suspense } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { FormSkeleton } from "@/components/common/skeletons";
import { ManagedDeviceForm } from "@/features/devices/components/managed-device-form";
import { SubmissionForm } from "@/features/devices/components/submission-form";
import { emptyManagedDevice } from "@/features/devices/defaults";
import { fetchLookups } from "@/features/devices/queries";
import { requireSession } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { caps } from "@/lib/permissions";

export const metadata: Metadata = { title: "New device" };

export default function NewDevicePage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <NewDeviceContent />
    </Suspense>
  );
}

async function NewDeviceContent() {
  const session = await requireSession();
  const { t } = await getT();
  const p = session.effectivePermissions;
  const readOnly = Boolean(session.previewRole);
  const money = { currency: session.settings.currencyCode, decimals: session.settings.currencyDecimals };
  const crumbs = [{ label: t("nav.home"), href: "/dashboard" }];

  if (caps.createDevice(p)) {
    const { brands, categories } = await fetchLookups();
    return (
      <>
        <PageHeader
          title={t("devices.newDevice")}
          description={t("devices.newDeviceDesc")}
          breadcrumbs={[...crumbs, { label: t("nav.devices"), href: "/devices" }, { label: t("devices.newDevice") }]}
        />
        <ManagedDeviceForm initial={emptyManagedDevice()} brands={brands} categories={categories} money={money} canReview={caps.review(p)} readOnly={readOnly} />
      </>
    );
  }

  if (caps.submit(p)) {
    const { brands, categories } = await fetchLookups();
    return (
      <>
        <PageHeader
          title={t("titles.data_entry")}
          eyebrow={t("devices.dataEntryEyebrow")}
          description={t("devices.dataEntryDesc")}
          breadcrumbs={[...crumbs, { label: t("nav.submissions"), href: "/devices" }, { label: t("devices.dataEntryEyebrow") }]}
        />
        <SubmissionForm brands={brands} categories={categories} money={money} readOnly={readOnly} />
      </>
    );
  }

  return <AccessDenied description={t("devices.noAddPermission")} />;
}
