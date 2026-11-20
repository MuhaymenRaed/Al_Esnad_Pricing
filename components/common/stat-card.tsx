import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
  href,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "neutral" | "brand" | "gold" | "success" | "warning" | "info";
  href?: string;
  className?: string;
}) {
  const body = (
    <div
      className={cn(
        "group relative flex h-full flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4 shadow-card transition-colors sm:p-5",
        href && "hover:border-foreground/15 hover:bg-surface-raised",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.8rem] font-medium text-muted-foreground">{label}</span>
        {icon ? (
          <span
            className={cn(
              "flex size-8 items-center justify-center rounded-lg [&_svg]:size-4",
              tone === "neutral" && "bg-muted text-foreground/70",
              tone === "brand" && "bg-brand-soft text-brand",
              tone === "gold" && "bg-gold-soft text-gold",
              tone === "success" && "bg-success-soft text-success",
              tone === "warning" && "bg-warning-soft text-warning",
              tone === "info" && "bg-info-soft text-info",
            )}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <div className="font-heading text-2xl font-semibold tracking-tight money">{value}</div>
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="rounded-xl focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none">
      {body}
    </Link>
  ) : (
    body
  );
}
