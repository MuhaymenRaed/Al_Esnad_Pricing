"use server";

import { refresh, revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { authorizeAction } from "@/lib/auth/guard";
import { getSiteUrl } from "@/lib/env";
import { fail, ok, toUserMessage, type ActionResult } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  createUserSchema,
  inviteSchema,
  passwordRules,
  roleSchema,
  type CreateUserInput,
  type InviteInput,
} from "@/lib/validation/schemas";
import type { AppRole } from "@/types/database";

/**
 * User administration (returns translation keys for messages).
 *  - Every action first requires an ACTIVE ADMINISTRATOR; the baseline admin_*
 *    RPCs check this again inside the database.
 *  - The service-role client is used only for Supabase Auth Admin APIs.
 */

async function requireAdministrator() {
  const auth = await authorizeAction("users.manage");
  if ("error" in auth) return auth;
  if (auth.session.role !== "administrator") return { error: fail("users.errors.onlyAdmin") };
  return auth;
}

function adminClient() {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

async function redirectUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${getSiteUrl(host ? `${proto}://${host}` : undefined)}/auth/confirm?next=${encodeURIComponent("/reset-password?mode=invite")}`;
}

function done() {
  revalidatePath("/users");
  revalidatePath("/dashboard");
  refresh();
}

async function emailTaken(email: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, email_confirmed_at, last_sign_in_at").ilike("email", email).maybeSingle();
  return data;
}

/** Applies role + activation with the ADMIN's session (audited), then logs the new user. */
async function finishNewUser(userId: string, email: string, role: AppRole) {
  const supabase = await createClient();
  const { error: activeError } = await supabase.rpc("admin_set_user_active", { p_target_user_id: userId, p_is_active: true });
  if (activeError) return toUserMessage(activeError);
  if (role !== "viewer") {
    const { error } = await supabase.rpc("admin_set_user_role", { p_target_user_id: userId, p_new_role: role });
    if (error) return toUserMessage(error);
  }
  await supabase.rpc("admin_log_user_invited", { p_user_id: userId, p_email: email, p_role: role, p_resent: false });
  return null;
}

/** Creates the account immediately with a password — no e-mail required. */
export async function createUserAction(input: CreateUserInput): Promise<ActionResult<{ userId: string }>> {
  const auth = await requireAdministrator();
  if ("error" in auth) return auth.error;
  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) return fail("errors.fixFields", parsed.error.flatten().fieldErrors);
  const { email, fullName, role, password } = parsed.data;

  if (await emailTaken(email)) return fail("users.errors.exists", { email: ["users.errors.exists"] });
  const admin = adminClient();
  if (!admin) return fail("users.errors.serviceKey");

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : undefined,
  });
  if (error || !data.user) {
    if (/already|exists|registered/i.test(error?.message ?? "")) return fail("users.errors.exists", { email: ["users.errors.exists"] });
    if (/password/i.test(error?.message ?? "")) return fail("auth.errors.weakPassword", { password: ["auth.errors.weakPassword"] });
    return fail(toUserMessage(error));
  }

  const problem = await finishNewUser(data.user.id, email, role);
  if (problem) return fail(problem);
  done();
  return ok({ userId: data.user.id }, "users.add.created");
}

/** Sends a Supabase invitation e-mail (requires Brevo SMTP). */
export async function inviteUserAction(input: InviteInput): Promise<ActionResult<{ userId: string }>> {
  const auth = await requireAdministrator();
  if ("error" in auth) return auth.error;
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return fail("errors.fixFields", parsed.error.flatten().fieldErrors);
  const { email, fullName, role } = parsed.data;

  const existing = await emailTaken(email);
  if (existing?.email_confirmed_at || existing?.last_sign_in_at) return fail("users.errors.exists", { email: ["users.errors.exists"] });
  const admin = adminClient();
  if (!admin) return fail("users.errors.serviceKey");

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: await redirectUrl(),
    data: fullName ? { full_name: fullName } : undefined,
  });
  if (error || !data.user) {
    const msg = error?.message ?? "";
    if (/rate limit/i.test(msg)) return fail("users.errors.rateLimit");
    if (/already|exists|registered/i.test(msg)) return fail("users.errors.exists");
    return fail("users.errors.smtp");
  }
  const problem = await finishNewUser(data.user.id, email, role);
  if (problem) return fail(problem);
  done();
  return ok({ userId: data.user.id }, "users.add.invited");
}

export async function resendInvitationAction(userId: string): Promise<ActionResult> {
  const auth = await requireAdministrator();
  if ("error" in auth) return auth.error;
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("email, role, email_confirmed_at").eq("id", userId).maybeSingle();
  if (!profile) return fail("users.errors.notFound");
  if (profile.email_confirmed_at) return fail("users.errors.alreadyAccepted");
  const admin = adminClient();
  if (!admin) return fail("users.errors.serviceKey");
  const { error } = await admin.auth.admin.inviteUserByEmail(profile.email, { redirectTo: await redirectUrl() });
  if (error) return fail(/rate limit/i.test(error.message) ? "users.errors.rateLimit" : "users.errors.smtp");
  await supabase.rpc("admin_log_user_invited", { p_user_id: userId, p_email: profile.email, p_role: profile.role, p_resent: true });
  done();
  return ok(undefined, "common.done");
}

export async function setUserRoleAction(userId: string, role: AppRole): Promise<ActionResult> {
  const auth = await requireAdministrator();
  if ("error" in auth) return auth.error;
  if (!roleSchema.safeParse(role).success) return fail("errors.invalidFormat");
  if (userId === auth.session.userId) return fail("users.errors.ownRole");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_user_role", { p_target_user_id: userId, p_new_role: role });
  if (error) return fail(toUserMessage(error));
  done();
  return ok(undefined, "users.toast.roleUpdated");
}

export async function setUserActiveAction(userId: string, active: boolean): Promise<ActionResult> {
  const auth = await requireAdministrator();
  if ("error" in auth) return auth.error;
  if (userId === auth.session.userId) return fail("users.errors.ownDeactivate");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_user_active", { p_target_user_id: userId, p_is_active: active });
  if (error) return fail(toUserMessage(error));
  // Also block (or restore) sign-in at the Auth level; RLS already denies all data.
  await adminClient()?.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
  done();
  return ok(undefined, active ? "users.toast.activated" : "users.toast.deactivated");
}

/** Removes an account that has never signed in (e.g. a mistyped e-mail). */
export async function revokeInvitationAction(userId: string): Promise<ActionResult> {
  const auth = await requireAdministrator();
  if ("error" in auth) return auth.error;
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("email, last_sign_in_at").eq("id", userId).maybeSingle();
  if (!profile) return fail("users.errors.notFound");
  if (profile.last_sign_in_at) return fail("users.errors.alreadyAccepted");
  const { error } = await supabase.rpc("admin_set_user_active", { p_target_user_id: userId, p_is_active: false });
  if (error) return fail(toUserMessage(error));
  const admin = adminClient();
  if (!admin) return fail("users.errors.serviceKey");
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) return fail(toUserMessage(deleteError));
  done();
  return ok(undefined, "users.toast.removed");
}

/** Administrator sets a new password for a user (e.g. forgotten password, no e-mail). */
export async function setUserPasswordAction(userId: string, password: string): Promise<ActionResult> {
  const auth = await requireAdministrator();
  if ("error" in auth) return auth.error;
  const parsed = passwordRules.safeParse(password);
  if (!parsed.success) return fail("errors.fixFields", { password: parsed.error.issues.map((i) => i.message) });
  const admin = adminClient();
  if (!admin) return fail("users.errors.serviceKey");
  const { error } = await admin.auth.admin.updateUserById(userId, { password: parsed.data });
  if (error) return fail(/password/i.test(error.message) ? "auth.errors.weakPassword" : toUserMessage(error));
  return ok(undefined, "users.passwordDialog.done");
}

export async function updateUserNameAction(userId: string, fullName: string): Promise<ActionResult> {
  const auth = await requireAdministrator();
  if ("error" in auth) return auth.error;
  const name = fullName.trim();
  if (name.length < 2 || name.length > 120) return fail("validation.nameRequired", { fullName: ["validation.nameRequired"] });
  const admin = adminClient();
  if (!admin) return fail("users.errors.serviceKey");
  // Profiles have no direct update grant; the admin was verified above.
  const { error } = await admin.from("profiles").update({ full_name: name }).eq("id", userId);
  if (error) return fail(toUserMessage(error));
  done();
  return ok(undefined, "users.toast.nameUpdated");
}
