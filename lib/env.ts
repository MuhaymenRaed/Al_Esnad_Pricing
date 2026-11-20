/**
 * Public (browser-safe) configuration. Only values prefixed with NEXT_PUBLIC_
 * may appear here — they are inlined into the client bundle at build time.
 */
export function getPublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Prefer the new publishable key; fall back to the legacy anon key.
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY " +
        "(or NEXT_PUBLIC_SUPABASE_ANON_KEY). See .env.example and docs/DEPLOYMENT.md.",
    );
  }
  return { supabaseUrl: url, supabaseKey: key };
}

/** Absolute origin used in auth e-mail redirect links. */
export function getSiteUrl(fallbackOrigin?: string) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.URL; // URL is set by Netlify
  const origin = configured ?? fallbackOrigin ?? "http://localhost:3000";
  return origin.replace(/\/+$/, "");
}
