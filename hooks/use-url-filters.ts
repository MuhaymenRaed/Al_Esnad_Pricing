"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { filtersToSearchParams, type DeviceFilters } from "@/lib/filters/devices";

/**
 * Filter state mirrored into the URL query string (shareable, bookmarkable,
 * back/forward friendly). URL values only ever *describe* a view — the server
 * re-applies the user's permissions on every request.
 *
 * `locked` filters are implied by the route (e.g. the brand on /brands/[id])
 * and are always applied but never written to the URL.
 */
export function useUrlFilters(initial: DeviceFilters, locked: Partial<DeviceFilters> = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const [lockedFilters] = useState(locked);
  const [filters, setFiltersState] = useState<DeviceFilters>({ ...initial, ...locked });

  useEffect(() => {
    const forUrl: DeviceFilters = { ...filters };
    for (const key of Object.keys(lockedFilters) as Array<keyof DeviceFilters>) delete forUrl[key];
    const qs = filtersToSearchParams(forUrl).toString();
    const current = window.location.search.replace(/^\?/, "");
    if (qs !== current) router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [filters, lockedFilters, pathname, router]);

  const setFilters = useCallback(
    (updater: DeviceFilters | ((prev: DeviceFilters) => DeviceFilters)) => {
      setFiltersState((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        return { ...next, ...lockedFilters };
      });
    },
    [lockedFilters],
  );

  const clear = useCallback(() => {
    setFiltersState((prev) => ({ sort: prev.sort, ...lockedFilters }));
  }, [lockedFilters]);

  return { filters, setFilters, clear };
}
