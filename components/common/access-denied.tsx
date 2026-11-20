"use client";

import { LockKeyhole } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useT } from "@/lib/i18n/client";

export function AccessDenied({ description }: { description?: string }) {
  const t = useT();
  return (
    <Empty className="mx-auto my-10 max-w-lg rounded-2xl border border-dashed bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="bg-brand-soft text-brand">
          <LockKeyhole />
        </EmptyMedia>
        <EmptyTitle>{t("errors.accessDenied")}</EmptyTitle>
        <EmptyDescription>{description ?? t("errors.accessDeniedBody")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline">
          <Link href="/dashboard">{t("common.goToDashboard")}</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}
