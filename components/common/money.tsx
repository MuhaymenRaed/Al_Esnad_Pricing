import { formatMoney, type MoneyFormat } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Money({
  value,
  format,
  className,
  currency = true,
  muted = false,
}: {
  value: string | number | null | undefined;
  format: MoneyFormat;
  className?: string;
  currency?: boolean;
  muted?: boolean;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <span className={cn("money", (muted || empty) && "text-muted-foreground", className)}>
      {formatMoney(value, format, { withCurrency: false })}
      {currency && !empty ? <span className="ms-1 text-[0.72em] font-medium text-muted-foreground">{format.currency}</span> : null}
    </span>
  );
}
