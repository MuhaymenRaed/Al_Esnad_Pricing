"use client";

import { CircleAlert, CircleCheck, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { checkSyncAction, publishPricesAction, type PublishOutcome, type ReviewDevice } from "@/features/devices/sync-actions";
import { formatMoney, formatNumber, type MoneyFormat } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { itemMatches, samePrice, type SyncCompare, type SyncSystem } from "../sync-state";

// Small batches keep every request well inside serverless time limits (Netlify: 10 s by default).
const CHECK_BATCH = 25;
const PUBLISH_BATCH = 4;

type Change = { system: SyncSystem; code: string; name: string; field: "selling" | "buying"; from: number | null; to: number };
type Verdict = "change" | "up_to_date" | "not_approved" | "not_linked" | "no_price" | "not_found" | "error";

/** What publishing would change for one device, from what each system holds now. */
function review(d: ReviewDevice, compare: SyncCompare): { verdict: Verdict; changes: Change[] } {
  if (d.status !== "active") return { verdict: "not_approved", changes: [] };
  const sync = d.sync;
  if (!sync || (["erpnext", "alisnad"] as const).every((s) => sync[s].state === "unlinked" || sync[s].state === "off")) {
    return { verdict: "not_linked", changes: [] };
  }
  if (d.selling === null) return { verdict: "no_price", changes: [] };
  if ((["erpnext", "alisnad"] as const).some((s) => sync[s].state === "error")) return { verdict: "error", changes: [] };
  const local = { selling: d.selling, purchase: d.purchase };
  const changes: Change[] = [];
  let found = 0;
  for (const system of ["erpnext", "alisnad"] as const) {
    for (const item of sync[system].items) {
      found++;
      if (itemMatches(system, item, local, compare)) continue;
      const name = item.name ?? item.code;
      const sellingSent = system === "alisnad" || compare.erpSelling;
      if (sellingSent && !samePrice(item.selling, d.selling, compare.decimals)) {
        changes.push({ system, code: item.code, name, field: "selling", from: item.selling, to: d.selling });
      }
      if (system === "erpnext" && compare.erpBuying && d.purchase !== null && !samePrice(item.buying ?? null, d.purchase, compare.decimals)) {
        changes.push({ system, code: item.code, name, field: "buying", from: item.buying ?? null, to: d.purchase });
      }
    }
  }
  if (!found) return { verdict: "not_found", changes };
  return { verdict: changes.length ? "change" : "up_to_date", changes };
}

/**
 * The only way prices reach alisnad.iq and ERPNext: reads both systems for
 * the chosen devices, shows every price that would change, and publishes only
 * after the admin ticks the confirmation. Unchanged, unapproved, unlinked or
 * unknown devices are never sent.
 */
export function PublishDialog({
  ids,
  open,
  onOpenChange,
  money,
  compare,
  lists,
  canPublish,
  onFinished,
}: {
  ids: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  money: MoneyFormat;
  compare: SyncCompare;
  lists: { erpSelling: string | null; erpBuying: string | null };
  canPublish: boolean;
  onFinished?: () => void;
}) {
  const { t, tm } = useI18n();
  const [phase, setPhase] = useState<"checking" | "review" | "publishing" | "done">("checking");
  // Mounted fresh for every opening (callers render it only while open), so state starts clean.
  const [progress, setProgress] = useState({ done: 0, total: ids.length });
  const [devices, setDevices] = useState<ReviewDevice[]>([]);
  const [outcomes, setOutcomes] = useState<PublishOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const touched = useRef(false);

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    (async () => {
      const all: ReviewDevice[] = [];
      for (let i = 0; i < ids.length; i += CHECK_BATCH) {
        const result = await checkSyncAction(ids.slice(i, i + CHECK_BATCH));
        if (stopped) return;
        if (!result.ok) {
          setError(result.error);
          break;
        }
        all.push(...result.data.devices);
        setProgress({ done: Math.min(i + CHECK_BATCH, ids.length), total: ids.length });
      }
      if (stopped) return;
      touched.current = true;
      setDevices(all);
      setPhase("review");
    })();
    return () => {
      stopped = true;
    };
  }, [open, ids]);

  const reviewed = useMemo(() => devices.map((d) => ({ device: d, ...review(d, compare) })), [devices, compare]);
  const count = (v: Verdict) => reviewed.filter((r) => r.verdict === v).length;
  const toPublish = reviewed.filter((r) => r.verdict === "change");
  const changeCount = toPublish.reduce((n, r) => n + r.changes.length, 0);

  const publish = async () => {
    setPhase("publishing");
    const targets = toPublish.map((r) => r.device.id);
    setProgress({ done: 0, total: targets.length });
    const all: PublishOutcome[] = [];
    for (let i = 0; i < targets.length; i += PUBLISH_BATCH) {
      const result = await publishPricesAction(targets.slice(i, i + PUBLISH_BATCH));
      if (!result.ok) {
        setError(result.error);
        break;
      }
      all.push(...result.data.outcomes);
      setProgress({ done: Math.min(i + PUBLISH_BATCH, targets.length), total: targets.length });
    }
    touched.current = true;
    setOutcomes(all);
    setPhase("done");
  };

  const close = (next: boolean) => {
    if (phase === "publishing") return;
    onOpenChange(next);
    if (!next && touched.current) onFinished?.();
  };

  const nameOf = new Map(devices.map((d) => [d.id, d.name]));
  const m = (v: number | null) => (v === null ? "—" : formatMoney(v, money));
  const done = outcomes.filter((o) => o.outcome === "published").length;
  const failed = outcomes.filter((o) => o.outcome === "failed");

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={phase !== "publishing"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="size-4" /> {t("publish.title", { count: ids.length })}
          </DialogTitle>
          <DialogDescription>{t("publish.desc")}</DialogDescription>
        </DialogHeader>

        {phase === "checking" || phase === "publishing" ? (
          <div className="space-y-3 py-4">
            <p className="flex items-center gap-2 text-sm">
              <Spinner className="size-4" />
              {phase === "checking" ? t("publish.checking") : t("publish.publishing")}
              <span className="ms-auto text-xs text-muted-foreground tabular-nums">
                {formatNumber(progress.done)} / {formatNumber(progress.total)}
              </span>
            </p>
            <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
            {phase === "publishing" ? <p className="text-xs text-muted-foreground">{t("publish.keepOpen")}</p> : null}
          </div>
        ) : null}

        {error ? (
          <p className="flex items-start gap-2 rounded-lg bg-destructive/8 px-3 py-2 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" /> {tm(error)}
          </p>
        ) : null}

        {phase === "review" ? (
          <div className="space-y-3">
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              <Stat label={t("publish.willChange")} value={count("change")} tone="text-brand" hint={t("publish.prices", { count: changeCount })} />
              <Stat label={t("publish.upToDate")} value={count("up_to_date")} tone="text-success" />
              <Stat label={t("publish.notApproved")} value={count("not_approved")} />
              <Stat label={t("publish.notLinked")} value={count("not_linked")} />
              <Stat label={t("publish.notFound")} value={count("not_found")} />
              <Stat label={t("publish.problems")} value={count("error") + count("no_price")} tone={count("error") + count("no_price") ? "text-destructive" : undefined} />
            </dl>
            <ul className="space-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <li>{t("publish.siteGets")}</li>
              <li>{lists.erpBuying ? t("publish.erpBuying", { list: lists.erpBuying }) : t("publish.erpNoBuying")}</li>
              <li>{lists.erpSelling ? t("publish.erpSelling", { list: lists.erpSelling }) : t("publish.erpNoSelling")}</li>
            </ul>
            {toPublish.length ? (
              <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border text-xs" aria-label={t("publish.willChange")}>
                {toPublish.map((r) => (
                  <li key={r.device.id} className="space-y-1 px-3 py-2">
                    <p className="font-medium text-foreground" dir="auto">
                      {r.device.name}
                    </p>
                    {r.changes.map((c) => (
                      <div key={`${c.system}-${c.code}-${c.field}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <span className="min-w-0 text-muted-foreground">
                          {t(`sync.systems.${c.system}`)} · {c.field === "buying" ? t("sync.buying") : t("sync.selling")}
                          <span className="ms-1 break-all opacity-80" dir="auto" title={c.code}>
                            ({c.name})
                          </span>
                        </span>
                        <span className="ms-auto shrink-0 tabular-nums">
                          <span className="text-muted-foreground line-through decoration-muted-foreground/50">{m(c.from)}</span>
                          <span className="mx-1.5 inline-block text-muted-foreground rtl:-scale-x-100" aria-hidden>
                            →
                          </span>
                          <span className="sr-only">{t("publish.after")}: </span>
                          <span className="font-semibold text-brand">{m(c.to)}</span>
                        </span>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">{t("publish.nothing")}</p>
            )}
            {toPublish.length && canPublish ? (
              <label className="flex items-start gap-2.5 rounded-lg border border-brand/30 bg-brand-soft/50 px-3 py-2.5 text-sm">
                <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} className="mt-0.5" />
                <span>{t("publish.confirm", { devices: toPublish.length, prices: changeCount })}</span>
              </label>
            ) : null}
            {toPublish.length && !canPublish ? <p className="text-xs text-muted-foreground">{t("publish.noPermission")}</p> : null}
          </div>
        ) : null}

        {phase === "done" ? (
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2 font-medium text-success">
              <CircleCheck className="size-4" /> {t("publish.doneCount", { count: done })}
            </p>
            {failed.length ? (
              <div className="rounded-lg bg-destructive/8 px-3 py-2 text-destructive">
                <p className="font-medium">{t("publish.failedCount", { count: failed.length })}</p>
                <ul className="mt-1 list-disc ps-4 text-xs">
                  {failed.slice(0, 10).map((f) => (
                    <li key={f.id} dir="auto">
                      {nameOf.get(f.id) ?? f.id}
                      {f.results
                        ? `: ${(["erpnext", "alisnad"] as const)
                            .map((s) => f.results![s])
                            .filter((r) => r.status === "error")
                            .map((r) => (r as { error: string }).error)
                            .join(" | ")
                            .slice(0, 200)}`
                        : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {outcomes.some((o) => o.outcome === "skipped") ? (
              <p className="text-xs text-muted-foreground">{t("publish.skippedCount", { count: outcomes.filter((o) => o.outcome === "skipped").length })}</p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          {phase === "review" && toPublish.length && canPublish ? (
            <>
              <Button variant="outline" onClick={() => close(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={publish} disabled={!confirmed}>
                <Send />
                {t("publish.button", { count: toPublish.length })}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => close(false)} disabled={phase === "publishing"}>
              {t("common.close")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: number; tone?: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <dt className="text-[0.7rem] text-muted-foreground">{label}</dt>
      <dd className={cn("text-base font-semibold tabular-nums", tone)}>{formatNumber(value)}</dd>
      {hint ? <dd className="text-[0.7rem] text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}
