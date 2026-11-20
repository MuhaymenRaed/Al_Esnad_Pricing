import type { Metadata } from "next";
import { Lock, ShieldCheck } from "lucide-react";
import { Suspense } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { PageSkeleton } from "@/components/common/skeletons";
import { Card, CardContent } from "@/components/ui/card";
import { PermissionMatrix } from "@/features/users/components/permission-matrix";
import { requireSession } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { ROLES } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Roles & permissions" };

export default function RolesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RolesContent />
    </Suspense>
  );
}

async function RolesContent() {
  const session = await requireSession();
  if (!session.effectivePermissions.has("roles.manage")) return <AccessDenied />;
  const { t } = await getT();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("permission_matrix");
  if (error) throw error;

  return (
    <>
      <PageHeader title={t("permissions.title")} description={t("permissions.desc")} />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ROLES.map((r) => (
          <Card key={r} className="shadow-card">
            <CardContent className="space-y-1.5 pt-5">
              <p className="flex items-center gap-2 font-heading font-semibold">
                <ShieldCheck className="size-4 text-brand" />
                {t(`roles.${r}`)}
              </p>
              <p className="text-xs text-muted-foreground">{t(`roleDescriptions.${r}`)}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Lock className="size-3.5" />
        {t("permissions.lockedNote")}
      </p>
      <PermissionMatrix rows={data ?? []} readOnly={Boolean(session.previewRole)} />
    </>
  );
}
