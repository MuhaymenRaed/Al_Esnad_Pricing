import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse, type NextRequest } from "next/server";
import { ReportDocument } from "@/components/pdf/report-document";
import { fetchAllDevices } from "@/features/devices/queries";
import { buildSections, columnsFor, coverStatsFor, scopeLabel, VARIANT_TITLES } from "@/features/reports/build";
import { getSession } from "@/lib/auth/session";
import { toUserMessage } from "@/lib/errors";
import { createT } from "@/lib/i18n/core";
import { describeFilters, sanitizeFilters, type DeviceFilters } from "@/lib/filters/devices";
import { formatDate, formatMoney } from "@/lib/format";
import { caps, type DataProjection } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { reportRequestSchema, type ReportVariant } from "@/lib/validation/schemas";

export const maxDuration = 60;

const NO_STORE = { "cache-control": "private, no-store" };
const json = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });

/**
 * PDF export. Always re-authorises with the user's REAL permissions and
 * rebuilds the complete dataset server-side from the requested scope (never
 * from rows the browser happened to load). Each variant can only read its own
 * projection: Viewer reports come from search_catalog(), which has no access
 * to private financial columns at all.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return json(401, "errors.sessionExpired");
  if (!session.isActive) return json(403, "errors.inactive");
  if (!session.permissions.has("reports.export")) return json(403, "errors.permission");

  const parsed = reportRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, parsed.error.issues[0]?.message ?? "errors.invalidFormat");
  const req = parsed.data;

  // Which data the requested variant needs, and whether this user may have it.
  const projectionFor: Record<ReportVariant, DataProjection> = { financial: "full", catalog: "catalog", submissions: "submissions" };
  const projection = projectionFor[req.variant];
  const allowed =
    req.variant === "financial"
      ? caps.financialReport(session.permissions)
      : req.variant === "catalog"
        ? caps.readCatalog(session.permissions)
        : caps.readSubmissions(session.permissions);
  if (!allowed) return json(403, "errors.permission");
  // While previewing another role, only that role's projection may be exported.
  if (session.previewRole && session.projection !== projection) {
    return json(403, "preview.readOnly");
  }

  const sort = req.filters.sort;
  let filters: DeviceFilters;
  let ids: string[] | undefined;
  switch (req.scope) {
    case "filtered":
      filters = req.filters;
      break;
    case "selected":
      filters = { sort };
      ids = req.ids;
      break;
    case "brands":
      filters = { sort, brandIds: req.brandIds };
      break;
    default:
      filters = { sort };
  }
  filters = sanitizeFilters(filters, projection);

  const money = { currency: session.settings.currencyCode, decimals: session.settings.currencyDecimals };
  const timezone = session.settings.timezone;
  const supabase = await createClient();

  try {
    const { rows, truncated } = await fetchAllDevices({ supabase, projection, filters, timezone, ids });

    const [{ data: brandRows }, { data: categoryRows }] = await Promise.all([
      supabase.from("brands").select("id, name"),
      supabase.from("categories").select("id, name"),
    ]);
    const brandMap = new Map((brandRows ?? []).map((b) => [b.id, b.name]));
    const categoryMap = new Map((categoryRows ?? []).map((c) => [c.id, c.name]));
    const chips =
      req.scope === "filtered"
        ? describeFilters(filters, {
            brands: brandMap,
            categories: categoryMap,
            formatAmount: (v) => formatMoney(v, money),
          }, createT("en")).map((c) => c.label)
        : [];

    const { sections, grandTotals } = buildSections(rows, req.variant, money, timezone, req.groupByBrand);
    const titles = VARIANT_TITLES[req.variant];
    const title = req.title?.trim() || titles.title;
    const generatedAt = formatDate(new Date(), timezone, "datetime");

    const buffer = await renderToBuffer(
      ReportDocument({
        company: {
          name: session.settings.companyName,
          tagline: session.settings.companyTagline,
          footer: session.settings.reportFooter,
        },
        title,
        subtitle: titles.subtitle,
        generatedAt,
        generatedBy: session.fullName ?? session.email,
        scopeLabel: scopeLabel(
          req.scope,
          (req.brandIds ?? []).map((id) => brandMap.get(id) ?? "Unknown"),
          ids?.length ?? 0,
        ),
        filters: chips,
        columns: columnsFor(req.variant, money.currency),
        sections,
        grandTotals,
        totalRecords: rows.length,
        coverStats: coverStatsFor(req.variant, rows, money),
        orientation: req.orientation,
        includeCover: req.includeCover,
        brandPageBreaks: req.brandPageBreaks && req.groupByBrand,
        confidential: req.variant === "financial",
        truncated,
        currency: money.currency,
      }),
    );

    const pages = (buffer.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "report";
    const filename = `${slug}-${new Date().toISOString().slice(0, 10)}.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        ...NO_STORE,
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${filename}"`,
        "x-report-pages": String(pages),
        "x-report-records": String(rows.length),
        "x-report-truncated": truncated ? "1" : "0",
        "x-report-filename": filename,
      },
    });
  } catch (error) {
    console.error("Report generation failed", error);
    return json((error as { code?: string }).code === "42501" ? 403 : 500, toUserMessage(error, "reports.failed"));
  }
}
