"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useT } from "@/lib/i18n/client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Empty className="mx-auto my-10 max-w-lg rounded-2xl border border-dashed bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="bg-warning-soft text-warning">
          <AlertTriangle />
        </EmptyMedia>
        <EmptyTitle>{t("errors.pageTitle")}</EmptyTitle>
        <EmptyDescription>
          {t("errors.pageBody")}
          {error.digest ? <span className="mt-1 block font-mono text-xs">{t("errors.reference", { digest: error.digest })}</span> : null}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center gap-2">
        <Button onClick={reset}>
          <RotateCcw /> {t("common.retry")}
        </Button>
        <Button variant="outline" asChild>
          <Link href="/dashboard">{t("common.goToDashboard")}</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}
