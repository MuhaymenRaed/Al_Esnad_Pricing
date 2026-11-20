import type { Metadata } from "next";
import { Suspense } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { PageSkeleton } from "@/components/common/skeletons";
import { AuditLogTable, type AuditEntry } from "@/features/audit/components/audit-log-table";
import { requireSession } from "@/lib/auth/session";
import { zonedDayStart } from "@/lib/filters/devices";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Audit logs" };

const PAGE_SIZE = 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default function AuditLogsPage({ searchParams }: PageProps<"/audit-logs">) {
  return (
    <Suspense fallback={<PageSkeleton cards={0} />}>
      <AuditContent searchParams={searchParams} />
    </Suspense>
  );
}

async function AuditContent({ searchParams }: { searchParams: PageProps<"/audit-logs">["searchParams"] }) {
  const session = await requireSession();
  if (!session.effectivePermissions.has("audit.read")) return <AccessDenied />;
  const sp = await searchParams;
  const { t } = await getT();
  const get = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  const page = Math.max(1, Number.parseInt(get("page") ?? "1", 10) || 1);
  const tz = session.settings.timezone;

  const supabase = await createClient();
  let query = supabase
    .from("audit_logs")
    .select("id, action, table_name, record_id, created_at, old_data, new_data, actor:profiles!audit_logs_actor_id_fkey(full_name, email)", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const table = get("table");
  const action = get("action");
  const actor = get("actor");
  const record = get("record");
  const from = get("from");
  const to = get("to");
  const q = get("q")?.trim().slice(0, 100);
  if (table && /^[a-z_]+$/.test(table)) query = query.eq("table_name", table);
  if (action && /^[A-Z_]+$/.test(action)) query = query.eq("action", action);
  if (actor && UUID.test(actor)) query = query.eq("actor_id", actor);
  if (record && UUID.test(record)) query = query.eq("record_id", record);
  if (from && DAY.test(from)) query = query.gte("created_at", zonedDayStart(from, tz));
  if (to && DAY.test(to)) query = query.lt("created_at", zonedDayStart(to, tz, 1));
  if (q) {
    if (UUID.test(q)) query = query.eq("record_id", q);
    else {
      // PostgREST "or" filter: escape characters with meaning in its grammar.
      const term = q.replace(/[(),*%\\"]/g, " ").trim();
      if (term) {
        query = query.or(
          ["new_data->>name", "old_data->>name", "new_data->>email", "old_data->>email", "new_data->>permission_key", "action"]
            .map((col) => `${col}.ilike.*${term}*`)
            .join(","),
        );
      }
    }
  }

  const { data, error, count } = await query;
  if (error) throw error;
  const entries: AuditEntry[] = (data ?? []).map((row) => ({
    ...row,
    actor: Array.isArray(row.actor) ? (row.actor[0] ?? null) : (row.actor ?? null),
  }));

  return (
    <>
      <PageHeader title={t("audit.title")} description={t("audit.desc")} />
      <AuditLogTable entries={entries} total={count ?? 0} page={page} pageSize={PAGE_SIZE} timezone={tz} />
    </>
  );
}
