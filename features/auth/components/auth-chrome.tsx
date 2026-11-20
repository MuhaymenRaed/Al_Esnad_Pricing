"use client";

import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { savePreferencesAction } from "@/features/session/actions";
import { useI18n } from "@/lib/i18n/client";

export function AuthHero() {
  const { t } = useI18n();
  return (
    <aside className="relative hidden overflow-hidden bg-[#1b1c20] text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
      <svg aria-hidden className="pointer-events-none absolute -end-40 -bottom-40 size-[640px] opacity-[0.07]" viewBox="0 0 48 48">
        <path
          d="M24 0 L48 24 L24 48 L0 24 Z M20.808 15.876 L22.769 17.836 L32.302 8.302 L30.342 6.342 Z M30.164 25.232 L32.124 27.192 L41.658 17.658 L39.698 15.698 Z"
          fillRule="evenodd"
          fill="#fff"
        />
      </svg>
      <div className="relative flex items-center gap-3">
        <LogoMark className="size-11" />
        <div className="leading-tight">
          <p className="font-heading text-lg font-semibold">{t("common.company")}</p>
          <p className="text-xs tracking-wide text-white/60 uppercase">{t("common.tagline")}</p>
        </div>
      </div>
      <div className="relative max-w-md space-y-5">
        <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/80">
          <span className="size-1.5 rounded-full bg-[#ff5f6e]" />
          {t("auth.heroBadge")}
        </p>
        <h1 className="font-heading text-4xl leading-[1.15] font-semibold tracking-tight">
          {t("auth.heroTitle1")}
          <br />
          <span className="text-[#ff5f6e]">{t("auth.heroTitle2")}</span>
        </h1>
        <p className="text-[0.95rem] leading-relaxed text-white/65">{t("auth.heroBody")}</p>
      </div>
      <p className="relative text-xs text-white/40" dir="rtl" lang="ar">
        شركة الاسناد لتجارة الهاتف النقال
      </p>
    </aside>
  );
}

export function AuthMobileBrand() {
  const { t } = useI18n();
  return (
    <div className="mb-8 flex items-center gap-3 lg:hidden">
      <LogoMark className="size-10" />
      <div className="leading-tight">
        <p className="font-heading font-semibold">{t("common.company")}</p>
        <p className="text-xs text-muted-foreground">{t("common.appName")}</p>
      </div>
    </div>
  );
}

export function LanguageToggle() {
  const { locale } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await savePreferencesAction({ locale: locale === "ar" ? "en" : "ar" });
          router.refresh();
        })
      }
    >
      <Languages />
      {locale === "ar" ? "English" : "العربية"}
    </Button>
  );
}
