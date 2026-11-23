import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { beforeEach, describe, expect, it } from "vitest";
import { ROLE_USERS, as, createDatabase, createPricedDevice, seedCatalogue, seedUsers, type Db } from "./harness";

let db: Db;
let refs: Awaited<ReturnType<typeof seedCatalogue>>;

const PRICE = { official_purchase_price: "1000000", discount_type: "percentage", discount_value: "0", payback_amount: "0", company_profit: "50000" };
const SITE = "ERPN-BEA7FDBA74"; // alisnad.iq product code
const BLACK = "DEV-000199"; // ERPNext items
const GREY = "DEV-000200";
const migrationsDir = path.resolve(import.meta.dirname, "../../supabase/migrations");

beforeEach(async () => {
  db = await createDatabase();
  await seedUsers(db);
  refs = await seedCatalogue(db);
});

const jobs = async (deviceId: string) =>
  (
    await db.query<{ codes: string[]; selling_price: string; buying_price: string | null; reason: string; status: string }>(
      `select codes, selling_price::text, buying_price::text, reason, status from public.price_sync_jobs where device_id = $1 order by id`,
      [deviceId],
    )
  ).rows;

const codesOf = async (deviceId: string) =>
  (await db.query<{ code: string }>(`select code from public.device_link_codes where device_id = $1 order by code`, [deviceId])).rows.map((r) => r.code);

/** save_device() as the Pricing Manager, like the app does. */
const save = (id: string | null, device: Record<string, unknown>, financials = PRICE) =>
  as(
    db,
    ROLE_USERS.manager,
    async (tx) =>
      (await tx.query<{ id: string }>(`select public.save_device($1, $2::jsonb, $3::jsonb) id`, [id, JSON.stringify(device), JSON.stringify(financials)])).rows[0].id,
    { commit: true },
  );

const base = () => ({ name: "TECNO Spark 50 256GB", brand_id: refs.samsung, category_id: refs.smartphones });

const rpc = <T>(user: string, sql: string, params: unknown[]) =>
  as(db, user, async (tx) => (await tx.query<T>(sql, params)).rows, { commit: true });

describe("price publishing (manual only)", () => {
  it("never queues anything by itself: saving, re-pricing, approving and linking only change this app", async () => {
    const id = await save(null, { ...base(), status: "draft", link_codes: [BLACK, ` ${SITE} `, GREY, BLACK, ""] });
    expect(await codesOf(id)).toEqual([SITE, BLACK, GREY].sort());
    await save(id, { ...base(), status: "active", link_codes: [SITE, BLACK] }, { ...PRICE, company_profit: "60000" });
    await save(id, { ...base(), status: "active", link_codes: [SITE, BLACK] }, { ...PRICE, company_profit: "70000" });
    expect(await jobs(id)).toEqual([]);
  });

  it("queues approved, linked, priced devices with selling AND purchase price, and says why others are skipped", async () => {
    const ready = await save(null, { ...base(), status: "active", link_codes: [BLACK] });
    const draft = await save(null, { ...base(), name: "Draft", status: "draft", link_codes: [GREY] });
    const unlinked = await createPricedDevice(db, { ...base(), name: "No code", status: "active" }, PRICE);
    const missing = "00000000-0000-4000-8000-0000000000ff";

    const rows = await rpc<{ device_id: string; job_id: string | null; skipped: string | null }>(
      ROLE_USERS.admin,
      `select device_id, job_id::text, skipped from public.request_price_syncs($1::uuid[]) order by skipped nulls first`,
      [[ready, draft, unlinked, missing, ready]],
    );
    expect(rows.map((r) => [r.device_id, r.job_id !== null, r.skipped])).toEqual([
      [ready, true, null],
      [draft, false, "not_active"],
      [missing, false, "not_found"],
      [unlinked, false, "not_linked"],
    ]);
    expect(await jobs(ready)).toEqual([{ codes: [BLACK], selling_price: "1050000.00", buying_price: "1000000.00", reason: "manual", status: "pending" }]);

    // A second request supersedes the open one.
    await rpc(ROLE_USERS.admin, `select * from public.request_price_syncs($1::uuid[])`, [[ready]]);
    expect((await jobs(ready)).map((j) => j.status)).toEqual(["superseded", "pending"]);
  });

  it("lets only administrators publish by default (Pricing Managers can be granted it)", async () => {
    const id = await save(null, { ...base(), status: "active", link_codes: [BLACK] });
    const request = (user: string) => rpc(user, `select * from public.request_price_syncs($1::uuid[])`, [[id]]);
    for (const user of [ROLE_USERS.manager, ROLE_USERS.viewer, ROLE_USERS.entry]) {
      await expect(request(user)).rejects.toThrow(/Not authorized to publish/);
    }
    await db.query(`insert into public.role_permissions (role, permission_key, allowed) values ('pricing_manager', 'prices.publish', true)
                    on conflict (role, permission_key) do update set allowed = true`);
    expect(await request(ROLE_USERS.manager)).toHaveLength(1);
    // Locked off for Viewers whatever the matrix says.
    await expect(
      as(db, ROLE_USERS.admin, (tx) => tx.query(`select public.admin_set_role_permission('viewer', 'prices.publish', true)`)),
    ).rejects.toThrow(/locked/i);
  });

  it("links by name without moving codes owned by another device", async () => {
    const a = await createPricedDevice(db, { ...base(), name: "A", status: "draft" }, PRICE);
    const b = await save(null, { ...base(), name: "B", status: "draft", link_codes: [GREY] });
    const rows = await rpc<{ device_id: string; linked: string[]; taken: string[] }>(
      ROLE_USERS.manager,
      `select * from public.link_devices($1::jsonb)`,
      [JSON.stringify([{ device_id: a, codes: [BLACK, GREY, " "] }])],
    );
    expect(rows).toEqual([{ device_id: a, linked: [BLACK], taken: [GREY] }]);
    expect(await codesOf(a)).toEqual([BLACK]);
    expect(await codesOf(b)).toEqual([GREY]);
    await expect(rpc(ROLE_USERS.viewer, `select * from public.link_devices($1::jsonb)`, [JSON.stringify([{ device_id: a, codes: ["X"] }])])).rejects.toThrow(
      /Not authorized/,
    );
  });

  it("imports ERPNext items: creates pending devices, links by name, updates prices only when asked", async () => {
    const existing = await createPricedDevice(db, { ...base(), name: "HONOR X9D 256+8", status: "active" }, PRICE);
    const items = [
      { code: "DEV-1", name: "SAMSUNG A57 256+8", brand_id: refs.samsung, category_id: refs.smartphones, purchase: 611500 },
      { code: "DEV-2", name: "honor x9d 256+8", brand_id: refs.samsung, category_id: refs.smartphones, purchase: 519000 },
      { code: "DEV-3", name: "HONOR CHOICE T10 64+4", brand_id: refs.samsung, category_id: refs.smartphones, purchase: 0 },
    ];
    const first = await rpc<{ code: string; device_id: string; result: string }>(ROLE_USERS.manager, `select * from public.import_erp_devices($1::jsonb)`, [JSON.stringify(items)]);
    expect(first.map((r) => [r.code, r.result])).toEqual([
      ["DEV-1", "created"],
      ["DEV-2", "linked"],
      ["DEV-3", "created"],
    ]);
    expect(first[1].device_id).toBe(existing);

    const created = (
      await db.query<{ name: string; status: string; purchase: string | null; selling: string | null; profit: string | null }>(
        `select d.name, d.status, f.official_purchase_price::text purchase, f.final_selling_price::text selling, f.company_profit::text profit
           from public.devices d left join public.device_financials f on f.device_id = d.id
          where d.id = any($1::uuid[]) order by d.name`,
        [[first[0].device_id, first[2].device_id]],
      )
    ).rows;
    expect(created).toEqual([
      { name: "HONOR CHOICE T10 64+4", status: "pending_review", purchase: null, selling: null, profit: null },
      { name: "SAMSUNG A57 256+8", status: "pending_review", purchase: "611500.00", selling: "611500.00", profit: "0.00" },
    ]);

    // Again: nothing new; a price is only replaced when asked.
    const again = await rpc<{ result: string }>(ROLE_USERS.manager, `select * from public.import_erp_devices($1::jsonb)`, [
      JSON.stringify([{ ...items[0], purchase: 600000 }, { ...items[1], purchase: 500000, update_price: true }]),
    ]);
    expect(again.map((r) => r.result)).toEqual(["exists", "price_updated"]);
    const prices = (await db.query<{ purchase: string }>(`select official_purchase_price::text purchase from public.device_financials where device_id = $1`, [existing])).rows;
    expect(prices).toEqual([{ purchase: "500000.00" }]);

    await expect(rpc(ROLE_USERS.viewer, `select * from public.import_erp_devices('[]'::jsonb)`, [])).rejects.toThrow(/Not authorized to import/);
  });

  it("keeps the status table private and forgets it when link codes change", async () => {
    const id = await save(null, { ...base(), status: "active", link_codes: [BLACK] });
    await db.query(`insert into public.device_sync_state (device_id, target, codes, items) values ($1, 'erpnext', $2, '[]')`, [id, [BLACK]]);
    const readAs = (user: string) => as(db, user, async (tx) => (await tx.query(`select 1 from public.device_sync_state`)).rows.length);
    expect(await readAs(ROLE_USERS.manager)).toBe(1);
    expect(await readAs(ROLE_USERS.viewer)).toBe(0);
    await expect(as(db, ROLE_USERS.admin, (tx) => tx.query(`delete from public.device_sync_state`))).rejects.toThrow(/permission denied/i);

    await save(id, { ...base(), status: "active", link_codes: [BLACK] });
    expect((await db.query(`select 1 from public.device_sync_state`)).rows).toHaveLength(1);
    await save(id, { ...base(), status: "active", link_codes: [BLACK, GREY] });
    expect((await db.query(`select 1 from public.device_sync_state`)).rows).toHaveLength(0);
  });

  it("can be applied twice", async () => {
    const file = readdirSync(migrationsDir).find((f) => f.includes("price_sync_manual"))!;
    await db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
    expect((await db.query(`select 1 from pg_trigger where tgname like 'price_sync_after%'`)).rows).toEqual([]);
  });
});

it("upgrades a database that already has the single-code price sync", async () => {
  // Replay the migrations the way the live database got them: everything up to the
  // first price-sync migration, a linked device, then the link-codes migration.
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const last = files.findIndex((f) => f.includes("price_sync_link_codes"));
  const old = await PGlite.create({ extensions: { pg_trgm, pgcrypto } });
  await old.exec(readFileSync(path.join(import.meta.dirname, "supabase-stub.sql"), "utf8"));
  for (const f of files.slice(0, last)) await old.exec(readFileSync(path.join(migrationsDir, f), "utf8"));

  const brand = (await old.query<{ id: string }>(`insert into public.brands (name) values ('Nokia') returning id`)).rows[0].id;
  const device = (
    await old.query<{ id: string }>(`insert into public.devices (name, brand_id, status, erp_item_code) values ('Nokia 150', $1, 'draft', 'DEV-000118') returning id`, [brand])
  ).rows[0].id;

  await old.exec(readFileSync(path.join(migrationsDir, files[last]), "utf8"));
  await old.exec(readFileSync(path.join(migrationsDir, files[last]), "utf8")); // idempotent
  for (const f of files.slice(last + 1)) await old.exec(readFileSync(path.join(migrationsDir, f), "utf8"));

  expect((await old.query(`select code, device_id from public.device_link_codes`)).rows).toEqual([{ code: "DEV-000118", device_id: device }]);
  expect((await old.query(`select 1 from information_schema.columns where table_name = 'devices' and column_name = 'erp_item_code'`)).rows).toEqual([]);
  await old.close();
});
