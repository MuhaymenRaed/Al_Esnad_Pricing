"use client";

import { Tags, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { MultiSelectFilter, type MultiOption } from "@/components/filters/multi-select-filter";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/client";

/**
 * Brand scope for the dashboard totals. The selection lives in the URL
 * (?brand=…), so the server recomputes every figure for exactly those brands
 * and the view can be bookmarked or shared like the devices page.
 */
export function DashboardBrandFilter({ options, selected }: { options: MultiOption[]; selected: string[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const apply = (ids: string[]) =>
    startTransition(() => {
      router.replace(ids.length ? `/dashboard?brand=${ids.join(",")}` : "/dashboard", { scroll: false });
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {pending ? <Spinner className="text-muted-foreground" /> : null}
      <MultiSelectFilter
        label={t("filters.brand")}
        icon={<Tags className="size-4 text-muted-foreground" />}
        options={options}
        selected={selected}
        onChange={apply}
        searchPlaceholder={t("filters.searchBrands")}
        className="h-10 px-3.5"
      />
      {selected.length ? (
        <Button variant="ghost" size="sm" onClick={() => apply([])} disabled={pending}>
          <X />
          {t("dashboard.allBrands")}
        </Button>
      ) : null}
    </div>
  );
}
