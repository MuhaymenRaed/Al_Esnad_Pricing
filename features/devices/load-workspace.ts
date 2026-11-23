import "server-only";

import type { SessionContext } from "@/lib/auth/session";
import { parseFilters, type DeviceFilters } from "@/lib/filters/devices";
import { caps, type DataProjection } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import type { WorkspaceCapabilities } from "./components/devices-workspace";
import { syncConfig } from "@/lib/price-sync/targets";
import { fetchDevicePage, fetchDeviceSummary, fetchLookups, syncCompare } from "./queries";
import type { DevicePageResponse } from "./types";

/**
 * Loads everything the device workspace needs on the server: lookups and the
 * first page (with statistics) so the table renders immediately, then the
 * client takes over for infinite scrolling.
 */
export async function loadWorkspace(
  session: SessionContext,
  searchParams: Record<string, string | string[] | undefined>,
  options: { lockedBrandId?: string } = {},
) {
  const projection = session.projection as DataProjection;
  const initialFilters: DeviceFilters = parseFilters(searchParams);
  if (options.lockedBrandId) initialFilters.brandIds = [options.lockedBrandId];
  if (projection === "submissions" && !initialFilters.sort) initialFilters.sort = "newest";

  const supabase = await createClient();
  const timezone = session.settings.timezone;
  const [lookups, page, summary] = await Promise.all([
    fetchLookups(),
    fetchDevicePage({
      supabase,
      projection,
      filters: initialFilters,
      timezone,
      limit: 50,
      withSync: projection === "full",
      decimals: session.settings.currencyDecimals,
    }).catch(() => undefined),
    fetchDeviceSummary(supabase, projection, initialFilters, timezone).catch(() => undefined),
  ]);

  const p = session.effectivePermissions;
  const capabilities: WorkspaceCapabilities = {
    canEdit: caps.editDevice(p),
    canArchive: caps.archive(p),
    canDelete: caps.deleteDevice(p),
    canReview: caps.review(p),
    canExport: p.has("reports.export"),
    canFinancialReport: caps.financialReport(p),
    canCheck: caps.readFull(p),
    canPublish: caps.publishPrices(p),
    canLink: caps.editDevice(p),
    readOnly: Boolean(session.previewRole),
  };
  const compare = projection === "full" ? syncCompare(session.settings.currencyDecimals) : null;
  const config = syncConfig();
  const sync = compare ? { compare, lists: { erpSelling: config.erpSelling, erpBuying: config.erpBuying } } : null;

  const initialPage: DevicePageResponse | undefined = page ? { ...page, summary, projection } : undefined;

  return {
    projection,
    initialFilters,
    initialPage,
    brands: lookups.brands,
    categories: lookups.categories,
    money: { currency: session.settings.currencyCode, decimals: session.settings.currencyDecimals },
    timezone,
    capabilities,
    sync,
  };
}
