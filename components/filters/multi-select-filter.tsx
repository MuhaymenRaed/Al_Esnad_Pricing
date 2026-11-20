"use client";

import { Check, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export type MultiOption = { id: string; label: string; count?: number; color?: string; muted?: boolean };

/** Searchable multi-select with select all / clear and live result counts. */
export function MultiSelectFilter({
  label,
  icon,
  options,
  selected,
  onChange,
  searchPlaceholder,
  disabled,
  className,
}: {
  label: string;
  icon?: React.ReactNode;
  options: MultiOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allSelected = options.length > 0 && options.every((o) => selectedSet.has(o.id));
  const summary =
    selected.length === 0
      ? null
      : selected.length === 1
        ? (options.find((o) => o.id === selected[0])?.label ?? t("filters.selectedCount", { count: 1 }))
        : t("filters.selectedCount", { count: selected.length });

  const toggle = (id: string) => {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn("h-9 justify-between gap-2 bg-card font-normal", selected.length && "border-foreground/25", className)}
          aria-label={summary ? `${label}: ${summary}` : label}
        >
          {icon}
          <span className="text-muted-foreground">{label}</span>
          {summary ? (
            <span className="max-w-32 truncate rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium text-foreground">
              {summary}
            </span>
          ) : null}
          <ChevronDown className="size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder ?? t("common.search")} />
          <CommandList className="max-h-72">
            <CommandEmpty>{t("filters.noMatches")}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__all__"
                onSelect={() => onChange(allSelected ? [] : options.map((o) => o.id))}
                className="font-medium"
              >
                <Checkbox checked={allSelected} partial={!allSelected && selected.length > 0} />
                {allSelected ? t("filters.clearSelection") : t("filters.selectAll")}
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              {options.map((option) => (
                <CommandItem key={option.id} value={`${option.label} ${option.id}`} onSelect={() => toggle(option.id)}>
                  <Checkbox checked={selectedSet.has(option.id)} />
                  {option.color ? (
                    <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: option.color }} aria-hidden />
                  ) : null}
                  <span className={cn("truncate", option.muted && "text-muted-foreground")}>{option.label}</span>
                  {option.count !== undefined ? (
                    <span className="ms-auto text-xs text-muted-foreground tabular-nums">{option.count}</span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {selected.length ? (
            <div className="border-t p-1.5">
              <Button variant="ghost" size="sm" className="w-full" onClick={() => onChange([])}>
                {t("filters.clearSelection")}
              </Button>
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function Checkbox({ checked, partial }: { checked: boolean; partial?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input",
        (checked || partial) && "border-primary bg-primary text-primary-foreground",
      )}
    >
      {checked ? <Check className="size-3" strokeWidth={3} /> : partial ? <span className="h-0.5 w-2 rounded bg-current" /> : null}
    </span>
  );
}
