const BASE = "http://same-origin.invalid";

/**
 * Returns a same-origin relative path for post-login / e-mail-link redirects,
 * or `fallback`. Browsers treat "\" like "/" and silently strip tabs/newlines,
 * so a naive startsWith("/") check can be bypassed ("/\evil.com",
 * "/\t/evil.com"). We reject control characters and backslashes outright, then
 * resolve the value as a URL and require it to stay on our origin.
 */
export function safeRedirectPath(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
