"use client";

import { X } from "lucide-react";
import type { FilterChip } from "@/lib/filters/devices";
import { useT } from "@/lib/i18n/client";

export function FilterChips({
  chips,
  onRemove,
  onClearAll,
}: {
  chips: FilterChip[];
  onRemove: (chip: FilterChip) => void;
  onClearAll: () => void;
}) {
  const t = useT();
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={t("filters.title")}>
      {chips.map((chip) => (
        <span
          key={`${chip.key}-${chip.value ?? ""}`}
          className="inline-flex items-center gap-1 rounded-full border bg-card py-0.5 ps-2.5 pe-1 text-xs font-medium shadow-card"
        >
          {chip.label}
          <button
            type="button"
            onClick={() => onRemove(chip)}
            className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("filters.removeFilter", { label: chip.label })}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="ms-1 rounded-md px-2 py-1 text-xs font-medium text-brand hover:bg-brand-soft"
      >
        {t("filters.clearAll")}
      </button>
    </div>
  );
}
