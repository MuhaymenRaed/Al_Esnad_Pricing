"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { signOutAction } from "@/features/auth/actions";
import { createClient } from "@/lib/supabase/client";

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;

/**
 * - Applies the theme saved on the user's profile once per page load.
 * - Redirects to sign-in if the session ends elsewhere (other tab, expiry).
 * - Signs the user out after the company's inactivity timeout.
 */
export function SessionWatcher({
  idleTimeoutMinutes,
  themePreference,
}: {
  idleTimeoutMinutes: number;
  themePreference: "light" | "dark" | "system";
}) {
  const { setTheme } = useTheme();
  const synced = useRef(false);

  useEffect(() => {
    if (synced.current) return;
    synced.current = true;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem("theme");
    } catch {
      /* storage unavailable */
    }
    if (stored !== themePreference) setTheme(themePreference);
  }, [themePreference, setTheme]);

  useEffect(() => {
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      // Full reload on purpose: wipes every in-memory cache (incl. financial data).
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      if (event === "SIGNED_OUT") window.location.assign("/login?reason=signed_out");
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const limit = idleTimeoutMinutes * 60_000;
    let last = Date.now();
    const mark = () => {
      last = Date.now();
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const check = () => {
      if (Date.now() - last >= limit) void signOutAction("idle");
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") check();
    }, 30_000);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, mark));
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [idleTimeoutMinutes]);

  return null;
}
