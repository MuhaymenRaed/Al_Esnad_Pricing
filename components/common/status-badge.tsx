"use client";

import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import type { DeviceStatus } from "@/types/database";

const STYLES: Record<DeviceStatus, string> = {
  draft: "bg-muted text-muted-foreground ring-border",
  pending_review: "bg-warning-soft text-warning ring-warning/25",
  active: "bg-success-soft text-success ring-success/25",
  rejected: "bg-destructive/8 text-destructive ring-destructive/25",
  archived: "bg-muted text-muted-foreground/80 ring-border",
};

const DOTS: Record<DeviceStatus, string> = {
  draft: "bg-muted-foreground/60",
  pending_review: "bg-warning",
  active: "bg-success",
  rejected: "bg-destructive",
  archived: "bg-muted-foreground/40",
};

export function StatusBadge({ status, className }: { status: DeviceStatus; className?: string }) {
  const t = useT();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        STYLES[status],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOTS[status])} aria-hidden />
      {t(`status.${status}`)}
    </span>
  );
}

export function ToneBadge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "brand" | "success" | "warning" | "info" | "gold";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        tone === "neutral" && "bg-muted text-muted-foreground ring-border",
        tone === "brand" && "bg-brand-soft text-brand ring-brand/20",
        tone === "success" && "bg-success-soft text-success ring-success/25",
        tone === "warning" && "bg-warning-soft text-warning ring-warning/25",
        tone === "info" && "bg-info-soft text-info ring-info/25",
        tone === "gold" && "bg-gold-soft text-gold ring-gold/25",
        className,
      )}
    >
      {children}
    </span>
  );
}
