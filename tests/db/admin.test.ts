import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLE_USERS, as, createDatabase, seedCatalogue, seedUsers, type Db, type Tx } from "./harness";

let db: Db;

beforeAll(async () => {
  db = await createDatabase();
  await seedUsers(db);
  await seedCatalogue(db);
});
afterAll(() => db.close());

const admin = <T>(fn: (tx: Tx) => Promise<T>, commit = true) => as(db, ROLE_USERS.admin, fn, { commit });

describe("Scenario 5 — Administrator", () => {
  it("invites an employee and assigns the role (Auth invite → profile → role)", async () => {
    // Supabase Auth creates the user (with invited_at) when the invite is sent.
    const { rows } = await db.query<{ id: string }>(
      `insert into auth.users (email, invited_at) values ('New.Hire@Example.com', now()) returning id`,
    );
    const userId = rows[0].id;
    await admin(async (tx) => {
      await tx.query(`select public.admin_set_user_role($1, 'pricing_manager')`, [userId]);
      await tx.query(`select public.admin_log_user_invited($1, 'new.hire@example.com', 'pricing_manager')`, [userId]);
    });
    const profile = await db.query<{ role: string; is_active: boolean; email: string }>(
      `select role, is_active, email from public.profiles where id = $1`,
      [userId],
    );
    expect(profile.rows[0]).toEqual({ role: "pricing_manager", is_active: true, email: "new.hire@example.com" });
  });

  it("keeps self-registered (non-invited) accounts inactive", async () => {
    await db.query(`insert into auth.users (email) values ('stranger@example.com')`);
    const { rows } = await db.query<{ is_active: boolean }>(
      `select is_active from public.profiles where email = 'stranger@example.com'`,
    );
    expect(rows[0].is_active).toBe(false);
    const ctx = await as(db, (await db.query<{ id: string }>(`select id from auth.users where email = 'stranger@example.com'`)).rows[0].id, async (tx) =>
      (await tx.query<{ c: { permissions: string[] } }>(`select public.my_context() c`)).rows[0].c,
    );
    expect(ctx.permissions).toEqual([]);
  });

  it("changes roles and deactivates users", async () => {
    await admin((tx) => tx.query(`select public.admin_set_user_role($1, 'data_entry')`, [ROLE_USERS.viewer]));
    await admin((tx) => tx.query(`select public.admin_set_user_active($1, false)`, [ROLE_USERS.viewer]));
    const { rows } = await db.query<{ role: string; is_active: boolean }>(
      `select role, is_active from public.profiles where id = $1`,
      [ROLE_USERS.viewer],
    );
    expect(rows[0]).toEqual({ role: "data_entry", is_active: false });
  });

  it("cannot change its own role or deactivate itself", async () => {
    await admin((tx) => tx.query(`select public.admin_set_user_active($1, true)`, [ROLE_USERS.admin2]));
    await expect(
      admin((tx) => tx.query(`select public.admin_set_user_role($1, 'viewer')`, [ROLE_USERS.admin]), false),
    ).rejects.toThrow(/your own role/);
    await expect(
      admin((tx) => tx.query(`select public.admin_set_user_active($1, false)`, [ROLE_USERS.admin]), false),
    ).rejects.toThrow(/cannot deactivate your own/);
  });

  it("always keeps at least one active administrator", async () => {
    // admin2 (activated above) demotes admin: allowed, because admin2 remains.
    await as(db, ROLE_USERS.admin2, (tx) => tx.query(`select public.admin_set_user_role($1, 'viewer')`, [ROLE_USERS.admin]), {
      commit: true,
    });
    // admin2 is now the only active administrator and cannot remove itself.
    await expect(
      as(db, ROLE_USERS.admin2, (tx) => tx.query(`select public.admin_set_user_role($1, 'viewer')`, [ROLE_USERS.admin2])),
    ).rejects.toThrow(/your own role|last active Administrator/);
    await expect(
      as(db, ROLE_USERS.admin2, (tx) => tx.query(`select public.admin_set_user_active($1, false)`, [ROLE_USERS.admin2])),
    ).rejects.toThrow(/cannot deactivate your own/);
    // The demoted admin has no administrative power left.
    await expect(
      as(db, ROLE_USERS.admin, (tx) => tx.query(`select public.admin_set_user_role($1, 'viewer')`, [ROLE_USERS.admin2])),
    ).rejects.toThrow(/Only an Administrator/);
    await db.query(`update public.profiles set role = 'administrator' where id = $1`, [ROLE_USERS.admin]);
  });

  it("configures unlocked permissions but never locked ones", async () => {
    await admin((tx) => tx.query(`select public.admin_set_role_permission('viewer', 'reports.export', false)`));
    const { rows } = await db.query<{ allowed: boolean }>(
      `select allowed from public.role_permissions where role = 'viewer' and permission_key = 'reports.export'`,
    );
    expect(rows[0].allowed).toBe(false);

    await expect(
      admin((tx) => tx.query(`select public.admin_set_role_permission('viewer', 'financials.read', true)`), false),
    ).rejects.toThrow(/locked/);
    await expect(
      admin(
        (tx) =>
          tx.query(`insert into public.role_permissions (role, permission_key, allowed) values ('data_entry', 'financials.update', true)`),
        false,
      ),
    ).rejects.toThrow(/locked/);
    await expect(
      admin(
        (tx) => tx.query(`delete from public.role_permissions where role = 'pricing_manager' and permission_key = 'financials.read'`),
        false,
      ),
    ).rejects.toThrow(/locked/);

    const matrix = await admin(
      async (tx) =>
        (await tx.query<{ role: string; permission_key: string; locked: boolean }>(`select * from public.permission_matrix()`)).rows,
      false,
    );
    expect(matrix.find((m) => m.role === "viewer" && m.permission_key === "financials.read")?.locked).toBe(true);
    expect(matrix.find((m) => m.role === "viewer" && m.permission_key === "reports.export")?.locked).toBe(false);
  });

  it("records audit logs that only administrators can read and nobody can alter", async () => {
    const rows = await admin(
      async (tx) => (await tx.query<{ action: string; table_name: string }>(`select action, table_name from public.audit_logs`)).rows,
      false,
    );
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["USER_INVITED", "ROLE_CHANGED", "USER_DEACTIVATED", "INSERT"]));
    expect(rows.some((r) => r.table_name === "role_permissions")).toBe(true);
    await expect(admin((tx) => tx.query(`delete from public.audit_logs`), false)).rejects.toThrow(/permission denied/i);
    await expect(admin((tx) => tx.query(`update public.audit_logs set action = 'x'`), false)).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("returns role-aware dashboard summaries", async () => {
    const summary = await admin(
      async (tx) => (await tx.query<{ s: Record<string, unknown> }>(`select public.dashboard_summary() s`)).rows[0].s,
      false,
    );
    expect(summary).toHaveProperty("users_total");
    expect(summary).toHaveProperty("financials");

    const entry = await as(db, ROLE_USERS.entry, async (tx) =>
      (await tx.query<{ s: Record<string, unknown> }>(`select public.dashboard_summary() s`)).rows[0].s,
    );
    expect(entry).not.toHaveProperty("financials");
    expect(entry).not.toHaveProperty("users_total");
    expect(entry).toHaveProperty("my_submissions");
  });

  it("supports the documented first-administrator bootstrap", async () => {
    await db.query(`insert into auth.users (email) values ('owner@example.com')`);
    await db.query(
      `update public.profiles set role = 'administrator', is_active = true where lower(email) = lower('owner@example.com')`,
    );
    const { rows } = await db.query<{ role: string; is_active: boolean }>(
      `select role, is_active from public.profiles where email = 'owner@example.com'`,
    );
    expect(rows[0]).toEqual({ role: "administrator", is_active: true });
  });
});
