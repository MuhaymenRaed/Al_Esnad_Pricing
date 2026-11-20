"use client";

import { Direction } from "radix-ui";
import { createContext, use, useEffect, useMemo, type ReactNode } from "react";
import { createT, dirOf, intlLocale, translateMaybe, type Locale, type TFunction } from "./core";

type I18nValue = {
  locale: Locale;
  dir: "rtl" | "ltr";
  t: TFunction;
  /** Translates a value that may be a message key (server action errors, validation). */
  tm: (value: string | undefined | null) => string;
  intl: string;
};

function build(locale: Locale): I18nValue {
  const t = createT(locale);
  return { locale, dir: dirOf(locale), t, tm: (v) => (v ? translateMaybe(t, v) : ""), intl: intlLocale(locale) };
}

const I18nContext = createContext<I18nValue>(build("en"));

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => build(locale), [locale]);

  // Keep <html lang/dir> in sync (the inline script handles the first paint).
  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = dirOf(locale);
  }, [locale]);

  return (
    <I18nContext value={value}>
      <Direction.Provider dir={value.dir}>{children}</Direction.Provider>
    </I18nContext>
  );
}

export function useI18n() {
  return use(I18nContext);
}

export function useT() {
  return use(I18nContext).t;
}
