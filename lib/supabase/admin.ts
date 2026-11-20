import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Service-role client. Bypasses RLS — use ONLY for Supabase Auth admin APIs
 * (inviting, banning and deleting auth users) after the caller's permission has
 * been verified through an RLS-protected RPC. Never import from client code;
 * the `server-only` import makes that a build error.
 */
export function createAdminClient() {
  const { supabaseUrl } = getPublicEnv();
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) is not set. It is required for user invitations.",
    );
  }
  return createClient<Database>(supabaseUrl, secret, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}
