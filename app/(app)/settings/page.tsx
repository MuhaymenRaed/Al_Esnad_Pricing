import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/common/page-header";
import { PageSkeleton } from "@/components/common/skeletons";
import { SettingsPanels, type SecurityCheck } from "@/features/settings/components/settings-panels";
import { requireSession } from "@/lib/auth/session";
import { getPublicEnv } from "@/lib/env";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton cards={0} />}>
      <SettingsContent />
    </Suspense>
  );
}

async function signupDisabled(): Promise<boolean | null> {
  try {
    const { supabaseUrl, supabaseKey } = getPublicEnv();
    const res = await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: supabaseKey }, cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { disable_signup?: boolean };
    return Boolean(body.disable_signup);
  } catch {
    return null;
  }
}

async function SettingsContent() {
  const session = await requireSession();
  const { t } = await getT();
  const canManageCompany = session.permissions.has("settings.manage");

  const checks: SecurityCheck[] = [];
  if (canManageCompany) {
    const disabled = await signupDisabled();
    checks.push(
      disabled
        ? { label: "settings.checks.signupOff", ok: true, detail: "settings.checks.signupOffDetail" }
        : { label: "settings.checks.signupOn", ok: false, detail: "settings.checks.signupOnDetail" },
      {
        label: "settings.checks.serviceKey",
        ok: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY),
        detail: "settings.checks.serviceKeyDetail",
      },
      { label: "settings.checks.rls", ok: true, detail: "settings.checks.rlsDetail" },
      { label: "settings.checks.audit", ok: true, detail: "settings.checks.auditDetail" },
      {
        label: "settings.checks.https",
        ok: (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.URL ?? "").startsWith("https://"),
        detail: "settings.checks.httpsDetail",
      },
    );
  }

  return (
    <>
      <PageHeader title={t("settings.title")} description={canManageCompany ? t("settings.descAdmin") : t("settings.desc")} />
      <SettingsPanels
        profile={{ fullName: session.fullName ?? "", email: session.email, role: session.role }}
        company={session.settings}
        canManageCompany={canManageCompany && !session.previewRole}
        securityChecks={checks}
        readOnly={Boolean(session.previewRole)}
      />
    </>
  );
}
