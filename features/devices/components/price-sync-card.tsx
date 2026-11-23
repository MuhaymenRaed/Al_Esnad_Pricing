import { ArrowLeftRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney, formatRelative, type MoneyFormat } from "@/lib/format";
import type { Locale, TFunction } from "@/lib/i18n/core";
import { syncConfig } from "@/lib/price-sync/targets";
import { createClient } from "@/lib/supabase/server";
import type { DeviceStatus } from "@/types/database";
import { loadDeviceSync, syncCompare } from "../queries";
import { SYNC_SYSTEMS } from "../sync-state";
import { DeviceSyncActions } from "./device-sync-actions";
import { SyncBadge } from "./sync-badges";

/**
 * Where this device stands in ERPNext and on alisnad.iq: its link codes, what
 * each system holds (names and prices), and — for staff who may publish —
 * "Check" and "Publish…". Prices there change only through Publish.
 */
export async function PriceSyncCard({
  deviceId,
  codes,
  status,
  selling,
  purchase,
  money,
  t,
  locale,
  canCheck,
  canPublish,
}: {
  deviceId: string;
  codes: string[];
  status: DeviceStatus;
  selling: number | null;
  purchase: number | null;
  money: MoneyFormat;
  t: TFunction;
  locale: Locale;
  canCheck: boolean;
  canPublish: boolean;
}) {
  const compare = syncCompare(money.decimals);
  const config = syncConfig();
  const supabase = await createClient();
  const sync = compare
    ? ((await loadDeviceSync(supabase, [deviceId], money.decimals, new Map([[deviceId, { selling, purchase }]])).catch(() => null))?.get(deviceId) ?? null)
    : null;
  const m = (v: number | null | undefined) => (v === null || v === undefined ? "—" : formatMoney(v, money));

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowLeftRight className="size-4" /> {t("sync.title")}
        </CardTitle>
        <CardDescription>{t("sync.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!compare ? (
          <p className="text-muted-foreground">{t("sync.unavailable")}</p>
        ) : !sync ? (
          <p className="text-muted-foreground">{t("sync.needsMigration")}</p>
        ) : (
          <>
            {codes.length ? (
              <div className="flex flex-wrap gap-1" dir="ltr">
                {codes.map((c) => (
                  <span key={c} className="max-w-full truncate rounded-md bg-muted px-2 py-0.5 font-mono text-[0.7rem]" title={c}>
                    {c}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">{t("sync.notLinked")}</p>
            )}
            <ul className="space-y-3">
              {SYNC_SYSTEMS.filter((s) => sync[s].state !== "off").map((system) => {
                const s = sync[system];
                return (
                  <li key={system} className="space-y-1">
                    <SyncBadge system={system} sync={s} money={money} selling={selling} purchase={purchase} size="md" />
                    {s.items.length ? (
                      <ul className="space-y-0.5 ps-1 text-xs text-muted-foreground">
                        {s.items.map((i) => (
                          <li key={i.code} className="flex items-baseline justify-between gap-2">
                            <span className="min-w-0 truncate" dir="auto" title={i.code}>
                              {i.name ?? i.code}
                              {i.active ? "" : ` · ${t("sync.inactive")}`}
                            </span>
                            <span className="shrink-0 tabular-nums">
                              {system === "alisnad" || config.erpSelling ? m(i.selling) : null}
                              {i.buying !== undefined ? `${system === "alisnad" || config.erpSelling ? " · " : ""}${t("sync.buying")} ${m(i.buying)}` : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {s.publishedAt ? <p className="ps-1 text-[0.7rem] text-muted-foreground">{t("sync.publishedAt", { time: formatRelative(s.publishedAt, locale) })}</p> : null}
                  </li>
                );
              })}
            </ul>
            {status !== "active" ? <p className="text-xs text-muted-foreground">{t("sync.onlyActive")}</p> : null}
            {codes.length && (canCheck || canPublish) ? (
              <DeviceSyncActions
                deviceId={deviceId}
                money={money}
                compare={compare}
                lists={{ erpSelling: config.erpSelling, erpBuying: config.erpBuying }}
                canPublish={canPublish && status === "active"}
              />
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
