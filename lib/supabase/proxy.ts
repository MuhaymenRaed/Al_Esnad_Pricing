import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password", "/auth/confirm", "/auth/callback", "/auth/error", "/inactive"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refreshes the Supabase session on every request and performs optimistic
 * route protection. Real authorization happens in the data layer (RLS + RPC
 * permission checks); this only avoids rendering protected pages for
 * signed-out visitors.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { supabaseUrl, supabaseKey } = getPublicEnv();

  const supabase = createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        // Never let a CDN cache a response that refreshes auth cookies.
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Do not run code between createServerClient and getClaims().
  const { data } = await supabase.auth.getClaims();
  const isSignedIn = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  const redirectWithCookies = (url: URL) => {
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    ["cache-control", "expires", "pragma"].forEach((h) => {
      const value = response.headers.get(h);
      if (value) redirect.headers.set(h, value);
    });
    return redirect;
  };

  if (!isSignedIn && !isPublic(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Your session has expired. Please sign in again." },
        { status: 401, headers: { "cache-control": "no-store" } },
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/" && pathname !== "/dashboard") url.searchParams.set("next", pathname + search);
    if (request.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"))) {
      url.searchParams.set("reason", "expired");
    }
    return redirectWithCookies(url);
  }

  if (isSignedIn && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return redirectWithCookies(url);
  }

  return response;
}
