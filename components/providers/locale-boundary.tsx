import { I18nProvider } from "@/lib/i18n/client";
import { getCookieLocale } from "@/lib/i18n/server";

/** Provides the language for pages outside the signed-in app (must sit inside <Suspense>). */
export async function LocaleBoundary({ children }: { children: React.ReactNode }) {
  const locale = await getCookieLocale();
  return <I18nProvider locale={locale}>{children}</I18nProvider>;
}
