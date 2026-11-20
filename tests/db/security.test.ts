import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLE_USERS, as, createDatabase, createPricedDevice, seedCatalogue, seedUsers, type Db, type Tx } from "./harness";

let db: Db;
let refs: Awaited<ReturnType<typeof seedCatalogue>>;
let activeId: string;

const PRIVATE_FIELDS = [
  "official_purchase_price",
  "discount_type",
  "discount_value",
  "discount_amount",
  "payback_amount",
  "final_cost_before_profit",
  "company_profit",
  "sku",
  "metadata",
];

beforeAll(async () => {
  db = await createDatabase();
  await seedUsers(db);
  refs = await seedCatalogue(db);
  activeId = await createPricedDevice(
    db,
    {
      name: "iPhone 18",
      brand_id: refs.apple,
      category_id: refs.smartphones,
      sku: "APL-IP18",
      metadata: { supplier_note: "secret supplier terms" },
      status: "active",
    },
    {
      official_purchase_price: "2800000",
      discount_type: "percentage",
      discount_value: "1",
      payback_amount: "10000",
      company_profit: "50000",
    },
  );
});
afterAll(() => db.close());

const run = <T>(user: string | null, fn: (tx: Tx) => Promise<T>) => as(db, user, fn);
const rows = (user: string | null, sql: string, params: unknown[] = []) =>
  run(user, async (tx) => (await tx.query<Record<string, unknown>>(sql, params)).rows);

describe("Scenario 2 — Viewer security", () => {
  const V = ROLE_USERS.viewer;

  it("sees the device name and final selling price — and nothing private", async () => {
    const r = await rows(V, `select * from public.search_catalog()`);
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("iPhone 18");
    expect(Number(r[0].final_selling_price)).toBe(2_812_000);
    for (const field of PRIVATE_FIELDS) expect(r[0]).not.toHaveProperty(field);

    const view = await rows(V, `select * from public.viewer_device_catalog`);
    expect(view).toHaveLength(1);
    for (const field of PRIVATE_FIELDS) expect(view[0]).not.toHaveProperty(field);
  });

  it("is denied direct access to devices, private financials and the price projection", async () => {
    for (const table of ["devices", "device_financials", "device_public_pricing"]) {
      await expect(rows(V, `select * from public.${table}`)).rejects.toThrow(/permission denied/i);
    }
  });

  it("gets nothing from the manager view or the full search RPCs", async () => {
    expect(await rows(V, `select * from public.pricing_manager_device_catalog`)).toHaveLength(0);
    await expect(rows(V, `select * from public.search_devices()`)).rejects.toThrow(/Not authorized/);
    await expect(rows(V, `select public.device_summary()`)).rejects.toThrow(/Not authorized/);
    await expect(rows(V, `select public.get_managed_device($1)`, [activeId])).rejects.toThrow(/Not authorized/);
    expect(await rows(V, `select * from public.search_pricing_manager_devices()`)).toHaveLength(0);
  });

  it("cannot filter or sort the catalogue by private amounts", async () => {
    await expect(
      rows(V, `select * from public.search_catalog($1::jsonb)`, [JSON.stringify({ priceField: "purchase", priceMin: 1 })]),
    ).rejects.toThrow(/not available/);
    await expect(rows(V, `select * from public.search_catalog('{}', 'profit_desc')`)).rejects.toThrow(/not available/);
  });

  it("cannot discover private values through numeric or text search", async () => {
    const search = (q: string) => rows(V, `select * from public.search_catalog($1::jsonb)`, [JSON.stringify({ q })]);
    expect(await search("2800000")).toHaveLength(0); // purchase price
    expect(await search("50000")).toHaveLength(0); // profit
    expect(await search("supplier")).toHaveLength(0); // metadata
    expect(await search("APL-IP18")).toHaveLength(0); // SKU
    expect(await search("2,812,000")).toHaveLength(1); // selling price is public to Viewers
  });

  it("cannot write pricing, devices, roles or permissions", async () => {
    await expect(
      rows(V, `select * from public.update_device_financials($1, 1, 'percentage', 0, 0, 0)`, [activeId]),
    ).rejects.toThrow(/Not authorized/);
    await expect(
      rows(V, `select public.submit_device('X', $1, $2, 1)`, [refs.apple, refs.smartphones]),
    ).rejects.toThrow(/Not authorized/);
    await expect(rows(V, `select public.save_device(null, $1::jsonb, $2::jsonb)`, [
      JSON.stringify({ name: "X", brand_id: refs.apple }),
      JSON.stringify({ official_purchase_price: "1" }),
    ])).rejects.toThrow(/Not authorized/);
    await expect(rows(V, `update public.profiles set role = 'administrator' where id = $1`, [V])).rejects.toThrow(
      /permission denied/i,
    );
    await expect(rows(V, `select public.admin_set_user_role($1, 'administrator')`, [V])).rejects.toThrow(
      /Only an Administrator/,
    );
    await expect(
      rows(V, `insert into public.role_permissions (role, permission_key, allowed) values ('viewer', 'financials.read', true)`),
    ).rejects.toThrow(/row-level security|locked/);
  });

  it("cannot read audit logs or other users", async () => {
    expect(await rows(V, `select * from public.audit_logs`)).toHaveLength(0);
    expect((await rows(V, `select id from public.profiles`)).map((r) => r.id)).toEqual([V]);
  });
});

describe("Scenario 3 — Data Entry security", () => {
  const E = ROLE_USERS.entry;
  let submissionId: string;

  it("submits a device with its purchase price as Pending Review", async () => {
    submissionId = await as(
      db,
      E,
      async (tx) =>
        (
          await tx.query<{ id: string }>(
            `select public.submit_device('Galaxy S26', $1, $2, 1900000, 'SM-S26', 'S26', '{"color":"black"}') as id`,
            [refs.samsung, refs.smartphones],
          )
        ).rows[0].id,
      { commit: true },
    );
    const { rows: r } = await db.query<{ status: string; official_purchase_price: string }>(
      `select d.status, f.official_purchase_price from public.devices d join public.device_financials f on f.device_id = d.id where d.id = $1`,
      [submissionId],
    );
    expect(r[0].status).toBe("pending_review");
    expect(Number(r[0].official_purchase_price)).toBe(1_900_000);
  });

  it("sees only its own submissions, without any financial field", async () => {
    const mine = await rows(E, `select * from public.my_submissions()`);
    expect(mine.map((r) => r.name)).toEqual(["Galaxy S26"]);
    for (const field of ["official_purchase_price", "discount_amount", "payback_amount", "company_profit", "final_selling_price"]) {
      expect(mine[0]).not.toHaveProperty(field);
    }
    expect(await rows(E, `select * from public.my_device_submissions`)).toHaveLength(1);
  });

  it("cannot read or write discount, payback or profit", async () => {
    await expect(rows(E, `select * from public.device_financials`)).rejects.toThrow(/permission denied/i);
    expect(await rows(E, `select * from public.pricing_manager_device_catalog`)).toHaveLength(0);
    await expect(
      rows(E, `select * from public.update_device_financials($1, 1900000, 'percentage', 0, 0, 999)`, [submissionId]),
    ).rejects.toThrow(/Not authorized/);
    await expect(rows(E, `select * from public.search_catalog()`)).rejects.toThrow(/Not authorized/);
  });

  it("cannot approve, archive or edit devices", async () => {
    await expect(rows(E, `select public.set_devices_status(array[$1]::uuid[], 'active')`, [submissionId])).rejects.toThrow(
      /Not authorized/,
    );
    await expect(
      rows(E, `select public.update_device_details($1, 'X', $2, null, null, null, '{}')`, [submissionId, refs.apple]),
    ).rejects.toThrow(/Not authorized/);
  });

  it("edits own submissions only when an administrator allows it", async () => {
    const edit = () =>
      rows(E, `select public.update_my_submission($1, 'Galaxy S26 Ultra', $2, $3, 2100000)`, [
        submissionId,
        refs.samsung,
        refs.smartphones,
      ]);
    await expect(edit()).rejects.toThrow(/Not authorized/);
    await as(db, ROLE_USERS.admin, (tx) =>
      tx.query(`select public.admin_set_role_permission('data_entry', 'devices.edit_own_submissions', true)`),
      { commit: true },
    );
    await expect(edit()).resolves.toBeDefined();
  });
});

describe("Anonymous and deactivated access", () => {
  it("anonymous requests are denied everywhere", async () => {
    for (const rel of ["devices", "device_financials", "device_public_pricing", "profiles", "brands", "audit_logs", "viewer_device_catalog"]) {
      await expect(rows(null, `select * from public.${rel}`)).rejects.toThrow(/permission denied/i);
    }
    await expect(rows(null, `select * from public.search_catalog()`)).rejects.toThrow(/permission denied/i);
  });

  it("deactivated accounts lose all data access immediately", async () => {
    const I = ROLE_USERS.inactive;
    expect(await rows(I, `select * from public.pricing_manager_device_catalog`)).toHaveLength(0);
    expect(await rows(I, `select * from public.brands`)).toHaveLength(0);
    await expect(rows(I, `select * from public.search_devices()`)).rejects.toThrow(/Not authorized/);
    const [ctx] = await rows(I, `select public.my_context() as c`);
    expect((ctx.c as { permissions: string[] }).permissions).toEqual([]);
  });
});

describe("Scenario 4 — Pricing Manager", () => {
  const M = ROLE_USERS.manager;

  it("views every financial value", async () => {
    const r = await rows(M, `select * from public.search_devices($1::jsonb)`, [JSON.stringify({ q: "iphone" })]);
    expect(r).toHaveLength(1);
    expect(Number(r[0].official_purchase_price)).toBe(2_800_000);
    expect(Number(r[0].discount_amount)).toBe(28_000);
    expect(Number(r[0].payback_amount)).toBe(10_000);
    expect(Number(r[0].final_cost_before_profit)).toBe(2_762_000);
    expect(Number(r[0].company_profit)).toBe(50_000);
    expect(Number(r[0].final_selling_price)).toBe(2_812_000);
  });

  it("can preview the Viewer projection through the same restricted function", async () => {
    const r = await rows(M, `select * from public.search_catalog()`);
    expect(r.length).toBeGreaterThan(0);
    for (const field of PRIVATE_FIELDS) expect(r[0]).not.toHaveProperty(field);
    expect(await rows(M, `select public.role_permission_keys('viewer') as k`)).toHaveLength(1);
  });

  it("cannot manage users, permissions, settings or audit logs", async () => {
    await expect(rows(M, `select public.admin_set_user_role($1, 'viewer')`, [ROLE_USERS.viewer])).rejects.toThrow(
      /Only an Administrator/,
    );
    await expect(rows(M, `select public.admin_set_role_permission('viewer', 'reports.export', false)`)).rejects.toThrow(
      /Not authorized/,
    );
    expect(await rows(M, `select * from public.audit_logs`)).toHaveLength(0);
    expect(await rows(M, `update public.company_settings set company_name = 'X' returning id`)).toHaveLength(0);
  });
});
