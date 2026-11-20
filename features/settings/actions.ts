"use server";

import { refresh, revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth/guard";
import { getSession } from "@/lib/auth/session";
import { fail, ok, toUserMessage, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { companySettingsSchema, passwordSchema, type CompanySettingsInput } from "@/lib/validation/schemas";

export async function updateCompanySettingsAction(input: CompanySettingsInput): Promise<ActionResult> {
  const auth = await authorizeAction("settings.manage");
  if ("error" in auth) return auth.error;
  const parsed = companySettingsSchema.safeParse(input);
  if (!parsed.success) return fail("errors.fixFields", parsed.error.flatten().fieldErrors);
  const v = parsed.data;

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("company_settings")
    .update(
      {
        company_name: v.companyName,
        company_tagline: v.companyTagline ?? null,
        company_logo_url: v.companyLogoUrl ?? null,
        currency_code: v.currencyCode,
        currency_decimal_places: v.currencyDecimals,
        timezone_name: v.timezone,
        default_locale: v.defaultLocale,
        report_footer: v.reportFooter ?? null,
        idle_timeout_minutes: v.idleTimeoutMinutes,
      },
      { count: "exact" },
    )
    .eq("id", true);
  if (error) return fail(toUserMessage(error));
  if (!count) return fail("errors.permission");
  revalidatePath("/", "layout");
  refresh();
  return ok(undefined, "settings.companySaved");
}

export async function changePasswordAction(input: { password: string; confirm: string }): Promise<ActionResult> {
  const session = await getSession();
  if (!session?.isActive) return fail("errors.sessionExpired");
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) return fail("errors.fixFields", parsed.error.flatten().fieldErrors);
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (/reauthentication|recent/i.test(error.message)) return fail("auth.errors.reauth");
    if (/should be different/i.test(error.message)) return fail("auth.errors.samePassword");
    return fail("auth.errors.updateFailed");
  }
  return ok(undefined, "settings.passwordChanged");
}
