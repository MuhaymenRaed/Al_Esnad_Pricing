"use server";

import { refresh, revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth/guard";
import { fail, ok, toUserMessage, type ActionResult } from "@/lib/errors";
import { PERMISSIONS, isAppRole } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

/** Toggle one configurable cell; the database rejects locked cells. */
export async function setRolePermissionAction(role: string, key: string, allowed: boolean): Promise<ActionResult> {
  const auth = await authorizeAction("roles.manage");
  if ("error" in auth) return auth.error;
  if (!isAppRole(role) || role === "administrator") return fail("errors.permission");
  if (!(PERMISSIONS as readonly string[]).includes(key)) return fail("errors.notFound");

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_role_permission", { p_role: role, p_key: key, p_allowed: allowed });
  if (error) return fail(toUserMessage(error));
  revalidatePath("/roles-and-permissions");
  refresh();
  return ok(undefined, allowed ? "permissions.granted" : "permissions.revoked");
}
