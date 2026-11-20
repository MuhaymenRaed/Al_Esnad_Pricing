import { NextResponse, type NextRequest } from "next/server";
import { fetchDevicePage, fetchDeviceSummary, resolveProjection } from "@/features/devices/queries";
import type { DevicePageResponse } from "@/features/devices/types";
import { getSession } from "@/lib/auth/session";
import { toUserMessage } from "@/lib/errors";
import { parseFilters } from "@/lib/filters/devices";
import { createClient } from "@/lib/supabase/server";

const NO_STORE = { "cache-control": "private, no-store" };

/**
 * Server-side search, filtering, sorting and cursor pagination for device
 * tables. Authorisation: the session is re-read from cookies, the requested
 * projection is checked against REAL permissions, and every query runs with
 * the user's JWT so Postgres RLS / RPC permission checks apply as well.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "errors.sessionExpired" }, { status: 401, headers: NO_STORE });
  if (!session.isActive) return NextResponse.json({ error: "errors.inactive" }, { status: 403, headers: NO_STORE });

  const params = request.nextUrl.searchParams;
  const projection = resolveProjection(session, params.get("view"));
  if (!projection) {
    return NextResponse.json({ error: "errors.permission" }, { status: 403, headers: NO_STORE });
  }

  const filters = parseFilters(params);
  const limit = Math.min(Math.max(Number.parseInt(params.get("limit") ?? "50", 10) || 50, 1), 200);
  const cursor = params.get("cursor");
  const supabase = await createClient();

  try {
    const [page, summary] = await Promise.all([
      fetchDevicePage({ supabase, projection, filters, timezone: session.settings.timezone, cursor, limit }),
      !cursor && params.get("summary") === "1"
        ? fetchDeviceSummary(supabase, projection, filters, session.settings.timezone)
        : Promise.resolve(undefined),
    ]);
    const body: DevicePageResponse = { ...page, summary, projection };
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (error) {
    const status = (error as { code?: string }).code === "42501" ? 403 : 400;
    return NextResponse.json({ error: toUserMessage(error) }, { status, headers: NO_STORE });
  }
}
