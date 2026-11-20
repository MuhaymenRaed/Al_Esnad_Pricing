import { cn } from "@/lib/utils";

/**
 * Al-Esnad logo mark, redrawn from the company's official icon (alisnad.iq):
 * a white diamond with two cut slots and a red dot on a charcoal tile.
 */
export function LogoMark({ className, title = "Al-Esnad" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 48 48" role="img" aria-label={title} className={cn("size-8 shrink-0", className)}>
      <rect width="48" height="48" rx="10.5" fill="#333333" />
      <g transform="translate(6.72 6.72) scale(0.72)">
        <path
          d="M24 0 L48 24 L24 48 L0 24 Z M20.808 15.876 L22.769 17.836 L32.302 8.302 L30.342 6.342 Z M30.164 25.232 L32.124 27.192 L41.658 17.658 L39.698 15.698 Z"
          fillRule="evenodd"
          fill="#FFFFFF"
        />
        <circle cx="20.669" cy="27.326" r="6.426" fill="#E11D2E" />
      </g>
    </svg>
  );
}

export function Wordmark({
  name,
  tagline,
  className,
  compact = false,
}: {
  name: string;
  tagline?: string | null;
  className?: string;
  compact?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className={cn("flex flex-col leading-none", compact && "max-sm:sr-only")}>
        <span className="font-heading text-[0.95rem] font-semibold tracking-tight">{name}</span>
        {tagline ? (
          <span className="mt-1 text-[0.68rem] font-medium tracking-wide text-muted-foreground uppercase">
            {tagline}
          </span>
        ) : null}
      </span>
    </span>
  );
}
