import "server-only";

import { fail, type ActionResult } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { getSession, type SessionContext } from "@/lib/auth/session";

type GuardOptions = {
  /** Mutations are blocked while previewing another role. Default true. */
  write?: boolean;
};

/**
 * Authorises a Server Action. Always re-reads the session from the request
 * cookies (never trusts client input) and checks the user's REAL permissions.
 * The database re-checks the same permission inside RLS / RPCs.
 */
export async function authorizeAction(
  permission: Permission | Permission[],
  { write = true }: GuardOptions = {},
): Promise<{ session: SessionContext } | { error: ActionResult<never> }> {
  const session = await getSession();
  if (!session) return { error: fail("errors.sessionExpired") };
  if (!session.isActive) return { error: fail("errors.inactive") };
  if (write && session.previewRole) {
    return { error: fail("preview.readOnly") };
  }
  const required = Array.isArray(permission) ? permission : [permission];
  if (!required.every((p) => session.permissions.has(p))) {
    return { error: fail("errors.permission") };
  }
  return { session };
}
