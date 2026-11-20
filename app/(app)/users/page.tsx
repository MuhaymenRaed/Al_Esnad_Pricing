import type { Metadata } from "next";
import { Suspense } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { PageSkeleton } from "@/components/common/skeletons";
import { UsersManager } from "@/features/users/components/users-manager";
import { requireSession } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Users" };

export default function UsersPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <UsersContent />
    </Suspense>
  );
}

async function UsersContent() {
  const session = await requireSession();
  if (!session.effectivePermissions.has("users.manage") || session.role !== "administrator") return <AccessDenied />;
  const { t } = await getT();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active, email_confirmed_at, last_sign_in_at, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (
    <>
      <PageHeader title={t("users.title")} description={t("users.desc")} />
      <UsersManager
        currentUserId={session.userId}
        timezone={session.settings.timezone}
        users={(data ?? []).map((u) => ({
          id: u.id,
          email: u.email,
          fullName: u.full_name,
          role: u.role,
          isActive: u.is_active,
          confirmed: Boolean(u.email_confirmed_at || u.last_sign_in_at),
          lastSignInAt: u.last_sign_in_at,
          createdAt: u.created_at,
        }))}
      />
    </>
  );
}
