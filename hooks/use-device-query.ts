"use client";

import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import type { DevicePageResponse } from "@/features/devices/types";
import { filtersToSearchParams, type DeviceFilters } from "@/lib/filters/devices";
import type { DataProjection } from "@/lib/permissions";

export const PAGE_SIZE = 50;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function fetchPage(
  projection: DataProjection,
  filters: DeviceFilters,
  cursor: string | null,
  signal: AbortSignal,
): Promise<DevicePageResponse> {
  const params = filtersToSearchParams(filters);
  params.set("view", projection);
  params.set("limit", String(PAGE_SIZE));
  if (cursor) params.set("cursor", cursor);
  else params.set("summary", "1");

  const response = await fetch(`/api/devices?${params}`, { signal, credentials: "same-origin" });
  if (response.status === 401) {
    // Full reload on purpose: wipes every in-memory cache (incl. financial data).
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/login?reason=expired&next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    throw new HttpError(401, "errors.sessionExpired");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(response.status, typeof body.error === "string" ? body.error : "errors.generic");
  return body as DevicePageResponse;
}

export function deviceQueryKey(projection: DataProjection, filters: DeviceFilters) {
  return ["devices", projection, filtersToSearchParams(filters).toString()] as const;
}

/** Server-side filtered, sorted, cursor-paginated device list (infinite scroll). */
export function useDeviceQuery(
  projection: DataProjection,
  filters: DeviceFilters,
  initialData?: DevicePageResponse,
) {
  return useInfiniteQuery<DevicePageResponse, HttpError, InfiniteData<DevicePageResponse>, readonly unknown[], string | null>({
    queryKey: deviceQueryKey(projection, filters),
    queryFn: ({ pageParam, signal }) => fetchPage(projection, filters, pageParam, signal),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    initialData: initialData ? { pages: [initialData], pageParams: [null] } : undefined,
    placeholderData: (previous) => previous,
  });
}
