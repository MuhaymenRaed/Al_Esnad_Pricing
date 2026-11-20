import "server-only";

import { cookies } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, LOCALE_COOKIE, createT, isLocale, type Locale } from "./core";

/** Locale for the current request: the user's profile, else the cookie. */
export async function getLocale(): Promise<Locale> {
  const session = await getSession().catch(() => null);
  if (session?.locale && isLocale(session.locale)) return session.locale;
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(cookie) ? cookie : DEFAULT_LOCALE;
}

export async function getT() {
  const locale = await getLocale();
  return { t: createT(locale), locale };
}

/** Locale from the cookie only (pages without a session, e.g. sign-in). */
export async function getCookieLocale(): Promise<Locale> {
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(cookie) ? cookie : DEFAULT_LOCALE;
}
