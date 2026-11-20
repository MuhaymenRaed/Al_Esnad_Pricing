import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Notice, SetPasswordForm } from "@/features/auth/components/auth-forms";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Set password" };

export default function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  return (
    <Suspense fallback={<Skeleton className="h-72 w-full" />}>
      <ResetPasswordContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ResetPasswordContent({ searchParams }: { searchParams: PageProps<"/reset-password">["searchParams"] }) {
  const params = await searchParams;
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  const { t } = await getT();

  if (!data?.claims?.sub || !email) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("auth.linkExpiredTitle")}</h1>
        <Notice tone="warning">{t("auth.linkExpired")}</Notice>
        <Button asChild className="w-full" size="lg">
          <Link href="/forgot-password">{t("auth.requestNewLink")}</Link>
        </Button>
      </div>
    );
  }

  return <SetPasswordForm mode={params.mode === "invite" ? "invite" : "reset"} email={email} />;
}
