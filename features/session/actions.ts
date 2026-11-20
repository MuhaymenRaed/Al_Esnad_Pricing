"use server";

import { refresh, revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { fail, ok, toUserMessage, type ActionResult } from "@/lib/errors";
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n/core";
import { PREVIEW_COOKIE, isPreviewRole } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

const COOKIE_OPTIONS = { sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 24 * 365 };

/**
 * Starts or ends "View As". The cookie only selects which interface is
 * rendered; every query still runs with the user's real JWT.
 */
export async function setPreviewRoleAction(role: string | null): Promise<ActionResult> {
  const session = await getSession();
  if (!session?.isActive) return fail("errors.sessionExpired");
  const store = await cookies();

  if (role === null) {
    store.delete(PREVIEW_COOKIE);
  } else {
    if (!session.permissions.has("roles.preview")) return fail("errors.permission");
    if (!isPreviewRole(role)) return fail("errors.invalidFormat");
    store.set(PREVIEW_COOKIE, role, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 8 });
  }
  revalidatePath("/", "layout");
  refresh();
  return ok(undefined);
}

/** Saves theme / language to the profile; language also goes to a cookie. */
export async function savePreferencesAction(input: {
  theme?: "light" | "dark" | "system";
  locale?: "en" | "ar";
}): Promise<ActionResult> {
  const theme = input.theme && ["light", "dark", "system"].includes(input.theme) ? input.theme : null;
  const locale = isLocale(input.locale) ? input.locale : null;
  if (!theme && !locale) return ok(undefined);

  if (locale) (await cookies()).set(LOCALE_COOKIE, locale, COOKIE_OPTIONS);

  const session = await getSession();
  if (session?.isActive) {
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_my_preferences", { p_theme: theme, p_locale: locale });
    if (error) return fail(toUserMessage(error));
  }
  if (locale) {
    revalidatePath("/", "layout");
    refresh();
  }
  return ok(undefined);
}

export async function updateProfileAction(fullName: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session?.isActive) return fail("errors.sessionExpired");
  const name = fullName.trim();
  if (name.length < 2 || name.length > 120) return fail("validation.nameRequired");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_profile", { p_full_name: name });
  if (error) return fail(toUserMessage(error));
  revalidatePath("/", "layout");
  refresh();
  return ok(undefined, "settings.profileUpdated");
}
