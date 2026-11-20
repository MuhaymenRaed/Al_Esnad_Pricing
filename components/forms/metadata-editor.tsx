"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/core";

export type MetadataEntry = { key: string; value: string };

const SUGGESTIONS: MessageKey[] = [
  "form.suggestions.storage",
  "form.suggestions.color",
  "form.suggestions.ram",
  "form.suggestions.warranty",
  "form.suggestions.network",
];

/** Free-form attributes stored in devices.metadata (JSONB). */
export function MetadataEditor({
  entries,
  onChange,
  disabled,
}: {
  entries: MetadataEntry[];
  onChange: (entries: MetadataEntry[]) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const set = (i: number, patch: Partial<MetadataEntry>) => onChange(entries.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const unused = SUGGESTIONS.map((k) => t(k)).filter((s) => !entries.some((e) => e.key.toLowerCase() === s.toLowerCase()));

  return (
    <div className="space-y-2">
      {entries.map((entry, i) => (
        <div key={i} className="flex gap-2">
          <Input
            aria-label={t("form.attribute")}
            placeholder={t("form.attribute")}
            value={entry.key}
            maxLength={40}
            disabled={disabled}
            onChange={(e) => set(i, { key: e.target.value })}
            className="w-2/5"
          />
          <Input
            aria-label={t("form.value")}
            placeholder={t("form.value")}
            value={entry.value}
            maxLength={200}
            disabled={disabled}
            onChange={(e) => set(i, { value: e.target.value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("form.removeAttribute")}
            disabled={disabled}
            onClick={() => onChange(entries.filter((_, j) => j !== i))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || entries.length >= 20}
          onClick={() => onChange([...entries, { key: "", value: "" }])}
        >
          <Plus />
          {t("form.addAttribute")}
        </Button>
        {!disabled
          ? unused.slice(0, 4).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onChange([...entries, { key: s, value: "" }])}
                className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground"
              >
                + {s}
              </button>
            ))
          : null}
      </div>
    </div>
  );
}
