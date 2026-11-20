"use client";

import { ArrowLeft, Eye } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { setPreviewRoleAction } from "@/features/session/actions";
import { useI18n } from "@/lib/i18n/client";
import type { PreviewRole } from "@/lib/permissions";

export function PreviewBanner({ role }: { role: PreviewRole }) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  return (
    <div role="status" className="sticky top-14 z-20 border-b border-brand/20 bg-brand-soft/95 backdrop-blur lg:top-0">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6 lg:px-10">
        <p className="flex items-center gap-2 text-sm text-brand">
          <Eye className="size-4" />
          <span>
            <span className="font-semibold">{t("preview.banner", { role: t(`roles.${role}`) })}</span>
            <span className="hidden text-brand/80 sm:inline"> — {t("preview.bannerHint")}</span>
          </span>
        </p>
        <Button
          size="sm"
          variant="outline"
          className="ms-auto h-7 border-brand/30 bg-background/70 text-brand hover:bg-background"
          disabled={pending}
          onClick={() => startTransition(async () => void (await setPreviewRoleAction(null)))}
        >
          {pending ? <Spinner /> : <ArrowLeft className="rtl:rotate-180" />}
          {t("preview.return")}
        </Button>
      </div>
    </div>
  );
}
