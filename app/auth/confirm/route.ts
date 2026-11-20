import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES: EmailOtpType[] = ["invite", "recovery", "signup", "email", "email_change", "magiclink"];

/**
 * Landing endpoint for every Supabase Auth e-mail link (sent through Brevo).
 *   1. token_hash + type  → custom templates in supabase/templates (recommended)
 *   2. code               → PKCE flow (password reset requested from this app)
 *   3. neither            → default templates put the session in the URL
 *                           fragment; hand off to /auth/callback (client).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next"));

  if (!tokenHash && !code) {
    const callback = request.nextUrl.clone();
    callback.pathname = "/auth/callback";
    return NextResponse.redirect(callback);
  }

  const supabase = await createClient();
  let verified: EmailOtpType | "pkce" | null = null;
  let failure: string | null = null;

  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) failure = error.message;
    else verified = type;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) failure = error.message;
    else verified = "pkce";
  } else {
    failure = "invalid";
  }

  if (failure) {
    const reason = /expired|invalid|not found|used/i.test(failure) ? "expired" : "invalid";
    return NextResponse.redirect(new URL(`/auth/error?reason=${reason}`, origin));
  }

  const target =
    verified === "invite"
      ? "/reset-password?mode=invite"
      : verified === "recovery"
        ? "/reset-password"
        : next;
  return NextResponse.redirect(new URL(target, origin));
}
