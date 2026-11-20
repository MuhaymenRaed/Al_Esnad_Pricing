/**
 * Runs synchronously during HTML parsing (before first paint). On the client
 * the type becomes text/plain so React does not warn about rendering scripts;
 * suppressHydrationWarning accepts that attribute difference.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
