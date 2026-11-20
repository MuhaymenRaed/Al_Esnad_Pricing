import ar from "@/messages/ar";
import en, { type Messages } from "@/messages/en";

export type Locale = "en" | "ar";
export const LOCALES: Locale[] = ["en", "ar"];
export const LOCALE_COOKIE = "locale";
export const DEFAULT_LOCALE: Locale = "en";

type Paths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Every valid translation key, e.g. "devices.columns.brand". */
export type MessageKey = Paths<Messages>;
export type Vars = Record<string, string | number>;
export type TFunction = (key: MessageKey, vars?: Vars) => string;

const catalogues: Record<Locale, Messages> = { en, ar };

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "ar";
}

export function dirOf(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

function lookup(messages: Messages, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === "string" ? node : undefined;
}

function interpolate(text: string, vars?: Vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function createT(locale: Locale): TFunction {
  const messages = catalogues[locale] ?? en;
  return (key, vars) => interpolate(lookup(messages, key) ?? lookup(en, key) ?? key, vars);
}

/**
 * Translates a string that MAY be a message key (e.g. validation messages
 * produced by Zod schemas); anything else is returned unchanged.
 */
export function translateMaybe(t: TFunction, value: string) {
  return /^[a-z][\w]*(\.[\w-]+)+$/i.test(value) ? t(value as MessageKey) : value;
}

/** Intl locale tag: Arabic text with Latin digits (standard for prices in Iraq). */
export function intlLocale(locale: Locale) {
  return locale === "ar" ? "ar-IQ-u-nu-latn" : "en-GB";
}
