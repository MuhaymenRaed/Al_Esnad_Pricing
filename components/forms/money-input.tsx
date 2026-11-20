"use client";

import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

function group(raw: string) {
  if (!raw) return "";
  const [int, frac] = raw.split(".");
  const grouped = int.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac !== undefined ? `${grouped}.${frac}` : grouped;
}

/** Normalises typed input (incl. Arabic digits/separators) to a plain decimal string. */
export function normaliseAmount(input: string, maxDecimals: number) {
  let v = input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/[^\d.]/g, "");
  const firstDot = v.indexOf(".");
  if (firstDot !== -1) v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, "");
  if (maxDecimals === 0) v = v.split(".")[0];
  else if (firstDot !== -1) v = v.slice(0, firstDot + 1 + maxDecimals);
  return v.slice(0, 18);
}

/**
 * Amount input that shows thousand separators while typing and emits a raw
 * decimal string (never a float).
 */
export function MoneyInput({
  value,
  onChange,
  suffix,
  decimals = 0,
  invalid,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  decimals?: number;
  invalid?: boolean;
}) {
  return (
    <InputGroup className={cn("h-10 bg-card", className)} data-invalid={invalid || undefined}>
      <InputGroupInput
        {...props}
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={invalid || undefined}
        value={group(value)}
        onChange={(e) => onChange(normaliseAmount(e.target.value, decimals))}
        className="money text-[0.95rem]"
      />
      {suffix ? (
        <InputGroupAddon align="inline-end">
          <InputGroupText className="text-xs font-medium">{suffix}</InputGroupText>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}
