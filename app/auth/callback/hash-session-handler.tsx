"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/client";

export function HashSessionHandler() {
  const router = useRouter();
  const search = useSearchParams();

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    const type = hash.get("type");
    const errorCode = hash.get("error_code") ?? hash.get("error");

    if (errorCode || !accessToken || !refreshToken) {
      router.replace(`/auth/error?reason=${/expired/i.test(errorCode ?? "") ? "expired" : "invalid"}`);
      return;
    }

    const supabase = createClient();
    supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error }) => {
      // Remove tokens from the address bar and history.
      window.history.replaceState(null, "", window.location.pathname);
      if (error) {
        router.replace("/auth/error?reason=expired");
      } else if (type === "invite") {
        router.replace("/reset-password?mode=invite");
      } else if (type === "recovery") {
        router.replace("/reset-password");
      } else {
        router.replace(safeRedirectPath(search.get("next")));
      }
      router.refresh();
    });
  }, [router, search]);

  return null;
}
