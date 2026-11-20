"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

let browserClient: ReturnType<typeof createBrowserClient<Database>> | undefined;

/** Singleton browser client (auth state listener, sign-out). */
export function createClient() {
  if (!browserClient) {
    const { supabaseUrl, supabaseKey } = getPublicEnv();
    browserClient = createBrowserClient<Database>(supabaseUrl, supabaseKey);
  }
  return browserClient;
}
