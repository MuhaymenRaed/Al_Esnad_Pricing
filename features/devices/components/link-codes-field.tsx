"use client";

import { CircleAlert, CircleCheck, Link2, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { previewLinkCodesAction, searchLinkTargetsAction, type LinkPreview, type LinkSearch } from "@/features/devices/sync-actions";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatMoney, type MoneyFormat } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import type { RemoteItem } from "@/lib/price-sync/targets";
import { cn } from "@/lib/utils";
import { SYNC_SYSTEMS, parseLinkCodes, type SyncSystem } from "../sync-text";
import { useFieldErrors, type FieldErrors } from "./device-basics-fields";

/**
 * Link codes (one per line) with a live preview of what each matches in
 * ERPNext and on alisnad.iq, and a search across both systems to add codes
 * with one click. Linking never changes prices anywhere: only "Publish" does.
 */
export function LinkCodesField({
  value,
  onChange,
  money,
  errors,
  disabled,
  deviceName,
  deviceId,
}: {
  value: string;
  onChange: (value: string) => void;
  money: MoneyFormat;
  errors?: FieldErrors;
  disabled?: boolean;
  deviceName?: string;
  deviceId?: string;
}) {
  const { t } = useI18n();
  const errorsOf = useFieldErrors(errors);
  const debounced = useDebouncedValue(value, 600);
  const codes = parseLinkCodes(debounced);
  const key = codes.join("\n");
  const [result, setResult] = useState<{ key: string; preview: LinkPreview | null } | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    previewLinkCodesAction(key.split("\n")).then((r) => {
      if (!cancelled) setResult({ key, preview: r.ok ? r.data : null });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const loading = Boolean(key) && result?.key !== key;
  const preview = key && result?.key === key ? result.preview : null;
  const current = parseLinkCodes(value);
  const add = (code: string) => {
    if (current.includes(code)) return;
    onChange([...current, code].join("\n"));
  };

  const price = (system: SyncSystem, match: RemoteItem) => {
    const parts = [
      match.selling !== null && (system === "alisnad" || match.buying === undefined) ? formatMoney(match.selling, money) : null,
      match.buying !== undefined && match.buying !== null ? `${t("sync.buying")} ${formatMoney(match.buying, money)}` : null,
    ].filter(Boolean);
    return parts.length ? ` — ${parts.join(" · ")}` : "";
  };

  const chip = (system: SyncSystem, match: RemoteItem | undefined) => {
    const side = preview?.[system];
    if (!side?.configured || side.error) return null;
    return (
      <span
        key={system}
        className={cn(
          "inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.7rem]",
          match ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
        )}
      >
        {match ? <CircleCheck className="size-3 shrink-0" /> : null}
        <span className="truncate">
          {t(`sync.systems.${system}`)}
          {match ? `: ${match.name ?? match.code}${price(system, match)}` : ""}
        </span>
      </span>
    );
  };

  return (
    <Field data-invalid={Boolean(errors?.linkCodes) || undefined}>
      <FieldLabel htmlFor="link-codes" className="flex items-center gap-1.5">
        <Link2 className="size-4 text-muted-foreground" />
        {t("sync.code")}
      </FieldLabel>
      <Textarea
        id="link-codes"
        dir="ltr"
        rows={3}
        spellCheck={false}
        autoComplete="off"
        value={value}
        disabled={disabled}
        placeholder={t("sync.codePlaceholder")}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(errors?.linkCodes) || undefined}
        className="min-h-20 font-mono text-sm"
      />
      <FieldDescription>{t("sync.codeHint")}</FieldDescription>
      {codes.length ? (
        <ul className="space-y-1.5 rounded-lg border bg-muted/30 px-3 py-2 text-xs" aria-live="polite">
          {codes.map((code) => {
            const matches = SYNC_SYSTEMS.map((s) => preview?.[s].matches[code]);
            const none = !loading && preview && matches.every((m) => !m) && SYNC_SYSTEMS.some((s) => preview[s].configured && !preview[s].error);
            return (
              <li key={code} className="space-y-1">
                <span dir="ltr" className="block truncate font-mono text-[0.72rem] text-foreground">
                  {code}
                </span>
                <span className="flex flex-wrap gap-1">
                  {loading ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Spinner className="size-3" /> {t("sync.checking")}
                    </span>
                  ) : none ? (
                    <span className="inline-flex items-center gap-1 text-warning">
                      <CircleAlert className="size-3" /> {t("sync.notFound")}
                    </span>
                  ) : (
                    SYNC_SYSTEMS.map((s, i) => (matches[i] ? chip(s, matches[i]) : null))
                  )}
                </span>
              </li>
            );
          })}
          {!loading && preview && SYNC_SYSTEMS.some((s) => !preview[s].configured || preview[s].error) ? (
            <li className="text-muted-foreground">
              {SYNC_SYSTEMS.filter((s) => !preview[s].configured || preview[s].error)
                .map((s) => `${t(`sync.systems.${s}`)}: ${preview[s].error ? t("sync.checkFailed") : t("sync.notConnected")}`)
                .join(" · ")}
            </li>
          ) : null}
        </ul>
      ) : null}
      {!disabled ? <LinkSearchPanel initialQuery={deviceName ?? ""} linked={current} onAdd={add} money={money} deviceId={deviceId} /> : null}
      <FieldError errors={errorsOf("linkCodes")} />
    </Field>
  );
}

/** Search ERPNext and alisnad.iq by name or code; "Add" puts the code in the list above. */
function LinkSearchPanel({
  initialQuery,
  linked,
  onAdd,
  money,
  deviceId,
}: {
  initialQuery: string;
  linked: string[];
  onAdd: (code: string) => void;
  money: MoneyFormat;
  deviceId?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const debounced = useDebouncedValue(query, 450);
  const [state, setState] = useState<{ query: string; data: LinkSearch | null } | null>(null);

  useEffect(() => {
    const q = debounced.trim();
    if (!open || q.length < 2) return;
    let cancelled = false;
    searchLinkTargetsAction(q).then((r) => {
      if (!cancelled) setState({ query: q, data: r.ok ? r.data : null });
    });
    return () => {
      cancelled = true;
    };
  }, [debounced, open]);

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => {
          setQuery(initialQuery);
          setOpen(true);
        }}
      >
        <Search />
        {t("sync.find")}
      </Button>
    );
  }

  const q = debounced.trim();
  const loading = q.length >= 2 && state?.query !== q;
  const data = state?.query === q ? state.data : null;

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("sync.findPlaceholder")}
          className="h-9"
          dir="auto"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
        />
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          {t("common.close")}
        </Button>
      </div>
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-3" /> {t("sync.searching")}
        </p>
      ) : null}
      {data
        ? SYNC_SYSTEMS.map((system) => {
            const side = data[system];
            if (!side.configured) return null;
            return (
              <div key={system} className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">{t(`sync.systems.${system}`)}</p>
                {side.error ? (
                  <p className="text-xs text-destructive">{t("sync.checkFailed")}</p>
                ) : side.items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("sync.noResults")}</p>
                ) : (
                  <ul className="divide-y rounded-md border text-xs">
                    {side.items.map((item) => {
                      const owner = data.owners[item.code];
                      const mine = linked.includes(item.code);
                      const elsewhere = owner && owner.id !== deviceId && !mine;
                      return (
                        <li key={item.code} className="flex items-center gap-2 px-2 py-1.5">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium" dir="auto">
                              {item.name ?? item.code}
                              {item.active ? "" : ` · ${t("sync.inactive")}`}
                            </span>
                            <span className="block truncate text-muted-foreground">
                              <span dir="ltr">{item.code}</span>
                              {item.selling !== null ? ` · ${formatMoney(item.selling, money)}` : ""}
                              {item.buying !== undefined && item.buying !== null ? ` · ${t("sync.buying")} ${formatMoney(item.buying, money)}` : ""}
                              {elsewhere ? ` · ${t("sync.linkedTo", { name: owner.name })}` : ""}
                            </span>
                          </span>
                          <Button type="button" size="xs" className="shrink-0" variant={mine ? "ghost" : "outline"} disabled={mine || Boolean(elsewhere)} onClick={() => onAdd(item.code)}>
                            {mine ? <CircleCheck /> : <Plus />}
                            {mine ? t("sync.added") : t("sync.add")}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })
        : null}
    </div>
  );
}
