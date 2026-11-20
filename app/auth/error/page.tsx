import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { getCookieLocale } from "@/lib/i18n/server";
import { createT } from "@/lib/i18n/core";

export const metadata: Metadata = { title: "Link problem" };

export default function AuthErrorPage({ searchParams }: PageProps<"/auth/error">) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <Suspense fallback={<LogoMark className="mx-auto size-12" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/auth/error">["searchParams"] }) {
  const { reason } = await searchParams;
  const t = createT(await getCookieLocale());
  return (
    <div className="w-full max-w-sm space-y-6 text-center">
      <LogoMark className="mx-auto size-12" />
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">{t("auth.linkProblem")}</h1>
        <p className="text-sm text-muted-foreground">
          {reason === "expired" ? t("auth.linkProblemExpired") : t("auth.linkProblemInvalid")} {t("auth.askResend")}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Button asChild size="lg">
          <Link href="/forgot-password">{t("auth.requestNewLink")}</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/login">{t("auth.backToSignIn")}</Link>
        </Button>
      </div>
    </div>
  );
}
