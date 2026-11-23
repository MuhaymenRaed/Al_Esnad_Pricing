import { formatMoney, type MoneyFormat } from "@/lib/format";
import type { TFunction } from "@/lib/i18n/core";
import type { ItemChange, PriceChange, TargetResult } from "@/lib/price-sync/targets";

const isChanged = (i: ItemChange) => Boolean((i.selling && i.selling.action !== "unchanged") || (i.buying && i.buying.action !== "unchanged"));

export { SYNC_SYSTEMS, type SyncSystem } from "./sync-state";

/** Link codes typed one per line → clean, unique list. */
export const parseLinkCodes = (text: string) => [...new Set(text.split(/\r?\n/).map((c) => c.trim()).filter(Boolean))];

/** "from 370,000 IQD to 371,000 IQD" / "added: 371,000 IQD" / "already 371,000 IQD". */
export function describeChange(change: PriceChange, money: MoneyFormat, t: TFunction) {
  const m = (v: number | null) => (v === null ? "—" : formatMoney(v, money));
  if (change.action === "created") return t("sync.result.created", { new: m(change.new) });
  if (change.action === "updated") return t("sync.result.updated", { old: m(change.old), new: m(change.new) });
  return t("sync.result.unchanged", { new: m(change.new) });
}

/** Human sentence for one system's publish outcome. */
export function describeTargetResult(result: TargetResult | undefined, money: MoneyFormat, t: TFunction) {
  const count = (n: number) => (n > 1 ? ` ${t("sync.result.items", { count: n })}` : "");
  switch (result?.status) {
    case "updated":
    case "unchanged": {
      const items = result.items ?? [];
      const first = items.find(isChanged) ?? items[0];
      if (!first) return t("sync.result.skipped");
      const parts = [
        first.selling ? `${t("sync.selling")}: ${describeChange(first.selling, money, t)}` : null,
        first.buying ? `${t("sync.buying")}: ${describeChange(first.buying, money, t)}` : null,
      ].filter(Boolean);
      return parts.join(" · ") + count(items.length);
    }
    case "not_found":
      return t("sync.result.not_found");
    case "error":
      return t("sync.result.error");
    default:
      return t("sync.result.skipped");
  }
}
