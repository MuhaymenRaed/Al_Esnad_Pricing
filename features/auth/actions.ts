"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSiteUrl } from "@/lib/env";
import { PREVIEW_COOKIE } from "@/lib/permissions";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";
import { loginSchema, passwordSchema } from "@/lib/validation/schemas";

export type FormState = { error?: string; success?: string; fieldErrors?: Record<string, string[] | undefined> } | null;

async function originFromRequest() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : undefined;
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Uniform message: do not reveal whether the account exists.
    if (/email not confirmed/i.test(error.message)) {
      return { error: "auth.errors.notConfirmed" };
    }
    if (/banned/i.test(error.message)) return { error: "auth.errors.banned" };
    return { error: "auth.errors.invalidCredentials" };
  }

  (await cookies()).delete(PREVIEW_COOKIE);
  redirect(safeRedirectPath(formData.get("next")));
}

export async function requestPasswordResetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim();
  const parsed = loginSchema.shape.email.safeParse(email);
  if (!parsed.success) return { fieldErrors: { email: ["validation.email"] } };

  const supabase = await createClient();
  const siteUrl = getSiteUrl(await originFromRequest());
  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${siteUrl}/auth/confirm?next=/reset-password`,
  });
  // Same response whether or not the account exists (no user enumeration).
  return { success: "auth.resetSent" };
}

export async function updatePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = passwordSchema.safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) {
    return { error: "auth.errors.expiredLink" };
  }
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (/should be different/i.test(error.message)) return { error: "auth.errors.samePassword" };
    if (/weak|pwned|leaked/i.test(error.message)) return { error: "auth.errors.weakPassword" };
    return { error: "auth.errors.updateFailed" };
  }
  redirect("/dashboard?welcome=1");
}

export async function signOutAction(reason?: string) {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  (await cookies()).delete(PREVIEW_COOKIE);
  redirect(reason ? `/login?reason=${encodeURIComponent(reason)}` : "/login");
}
