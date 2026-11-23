"use client";

import { CircleAlert, CircleCheck, CircleDashed, EyeOff, Link2Off, RefreshCw, SearchX, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatMoney, formatRelative, type MoneyFormat } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { SYNC_SYSTEMS, SYNC_TONES, type DeviceSync, type SyncBadgeState, type SyncSystem, type SystemSync } from "../sync-state";

const ICONS: Record<SyncBadgeState, LucideIcon> = {
  synced: CircleCheck,
  outdated: RefreshCw,
  hidden: EyeOff,
  missing: SearchX,
  error: CircleAlert,
  unchecked: CircleDashed,
  unlinked: Link2Off,
  off: CircleDashed,
};

const TONE_CLASSES = {
  success: "bg-success-soft text-success ring-success/25",
  warning: "bg-warning-soft text-warning ring-warning/25",
  danger: "bg-destructive/8 text-destructive ring-destructive/25",
  muted: "bg-muted text-muted-foreground ring-border",
} as const;

/**
 * One pill per system ("ERP · Published", "Site · Price differs"…) telling
 * whether the device exists in ERPNext / on alisnad.iq and whether its prices
 * there match this app. The tooltip lists what each system holds.
 */
export function SyncBadges({
  sync,
  money,
  selling,
  purchase,
  className,
}: {
  sync: DeviceSync;
  money: MoneyFormat;
  selling?: number | null;
  purchase?: number | null;
  className?: string;
}) {
  const systems = SYNC_SYSTEMS.filter((s) => sync[s].state !== "off");
  if (!systems.length) return null;
  return (
    <div className={cn("flex flex-col items-start gap-1", className)}>
      {systems.map((system) => (
        <SyncBadge key={system} system={system} sync={sync[system]} money={money} selling={selling} purchase={purchase} />
      ))}
    </div>
  );
}

export function SyncBadge({
  system,
  sync,
  money,
  selling,
  purchase,
  size = "sm",
}: {
  system: SyncSystem;
  sync: SystemSync;
  money: MoneyFormat;
  selling?: number | null;
  purchase?: number | null;
  size?: "sm" | "md";
}) {
  const { t, locale } = useI18n();
  const Icon = ICONS[sync.state];
  const m = (v: number | null | undefined) => (v === null || v === undefined ? "—" : formatMoney(v, money));
  const label = `${t(`sync.short.${system}`)} · ${t(`sync.state.${sync.state}`)}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={`${t(`sync.systems.${system}`)}: ${t(`sync.state.${sync.state}`)}`}
          className={cn(
            "inline-flex max-w-full items-center gap-1 rounded-full font-medium whitespace-nowrap ring-1 ring-inset",
            size === "sm" ? "px-1.5 py-px text-[0.68rem]" : "px-2 py-0.5 text-xs",
            TONE_CLASSES[SYNC_TONES[sync.state]],
          )}
        >
          <Icon className={size === "sm" ? "size-3" : "size-3.5"} aria-hidden />
          <span className="truncate">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="block max-w-sm space-y-1 text-start">
        <p className="font-semibold">{t(`sync.systems.${system}`)}</p>
        <p>{t(`sync.stateHelp.${sync.state}`)}</p>
        {sync.items.length ? (
          <ul className="space-y-0.5 opacity-90">
            {sync.items.slice(0, 6).map((i) => (
              <li key={i.code} dir="auto">
                {i.name ?? i.code}
                {i.active ? "" : ` (${t("sync.inactive")})`}: {m(i.selling)}
                {i.buying !== undefined ? ` · ${t("sync.buying")} ${m(i.buying)}` : ""}
              </li>
            ))}
            {sync.items.length > 6 ? <li>+{sync.items.length - 6}</li> : null}
          </ul>
        ) : null}
        {sync.state === "outdated" && selling !== undefined ? (
          <p className="opacity-90">
            {t("sync.here")}: {m(selling)}
            {system === "erpnext" && purchase !== undefined ? ` · ${t("sync.buying")} ${m(purchase)}` : ""}
          </p>
        ) : null}
        {sync.error ? <p className="opacity-90" dir="auto">{sync.error.slice(0, 160)}</p> : null}
        {sync.checkedAt ? <p className="opacity-75">{t("sync.checkedAt", { time: formatRelative(sync.checkedAt, locale) })}</p> : null}
      </TooltipContent>
    </Tooltip>
  );
}
