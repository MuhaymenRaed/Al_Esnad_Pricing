import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLE_USERS, as, createDatabase, createPricedDevice, seedCatalogue, seedUsers, type Db } from "./harness";

let db: Db;
let refs: Awaited<ReturnType<typeof seedCatalogue>>;

beforeAll(async () => {
  db = await createDatabase();
  await seedUsers(db);
  refs = await seedCatalogue(db);
});
afterAll(() => db.close());

type Financials = {
  official_purchase_price: string;
  discount_amount: string;
  final_cost_before_profit: string;
  final_selling_price: string;
};

async function priced(name: string, financials: Record<string, string>, status = "active") {
  const id = await createPricedDevice(db, { name, brand_id: refs.apple, category_id: refs.smartphones, status }, financials);
  const f = (await db.query<Financials>(`select * from public.device_financials where device_id = $1`, [id])).rows[0];
  return { id, f };
}

const projection = async (id: string) =>
  (
    await db.query<{ final_selling_price: string }>(
      `select final_selling_price from public.device_public_pricing where device_id = $1`,
      [id],
    )
  ).rows[0]?.final_selling_price;

describe("Scenario 1 — pricing calculations are authoritative in the database", () => {
  it("reproduces the iPhone 18 reference example exactly", async () => {
    const { id, f } = await priced("iPhone 18", {
      official_purchase_price: "2800000",
      discount_type: "percentage",
      discount_value: "1",
      payback_amount: "10000",
      company_profit: "50000",
    });
    expect(Number(f.official_purchase_price)).toBe(2_800_000);
    expect(Number(f.discount_amount)).toBe(28_000);
    expect(Number(f.final_cost_before_profit)).toBe(2_762_000);
    expect(Number(f.final_selling_price)).toBe(2_812_000);
    expect(Number(await projection(id))).toBe(2_812_000);
  });

  it("supports fixed-amount discounts", async () => {
    const { f } = await priced("Galaxy Fixed", {
      official_purchase_price: "1500000",
      discount_type: "fixed",
      discount_value: "75000",
      payback_amount: "5000",
      company_profit: "40000",
    });
    expect(Number(f.discount_amount)).toBe(75_000);
    expect(Number(f.final_cost_before_profit)).toBe(1_420_000);
    expect(Number(f.final_selling_price)).toBe(1_460_000);
  });

  it("rounds half away from zero to the currency scale (IQD = 0 decimals)", async () => {
    const a = await priced("Rounding", { official_purchase_price: "1234567", discount_value: "2.5" });
    expect(Number(a.f.discount_amount)).toBe(30_864);
    const b = await priced("Half", { official_purchase_price: "999", discount_value: "50" });
    expect(Number(b.f.discount_amount)).toBe(500);
  });

  it("never accepts client-written computed values (no direct table access)", async () => {
    const { id } = await priced("Tamper", { official_purchase_price: "1000000" });
    await expect(
      as(db, ROLE_USERS.manager, (tx) =>
        tx.query(`update public.device_financials set final_selling_price = 1 where device_id = $1`, [id]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("rejects invalid financial inputs", async () => {
    const bad = (financials: Record<string, string>) =>
      priced("Invalid " + Math.random(), { official_purchase_price: "100000", ...financials }, "draft");
    await expect(bad({ discount_type: "percentage", discount_value: "101" })).rejects.toThrow(/cannot exceed 100%/);
    await expect(bad({ discount_type: "fixed", discount_value: "100001" })).rejects.toThrow(/cannot exceed/);
    await expect(bad({ discount_type: "fixed", discount_value: "60000", payback_amount: "50000" })).rejects.toThrow(
      /cannot exceed/,
    );
    await expect(bad({ payback_amount: "-1" })).rejects.toThrow(/negative/);
    await expect(bad({ company_profit: "-5" })).rejects.toThrow(/negative/);
    await expect(bad({ official_purchase_price: "-1" })).rejects.toThrow(/negative/);
  });

  it("keeps the Viewer projection in sync with price and status changes", async () => {
    const { id } = await priced("Sync Phone", { official_purchase_price: "1000000", company_profit: "100000" });
    expect(Number(await projection(id))).toBe(1_100_000);

    await as(
      db,
      ROLE_USERS.manager,
      (tx) =>
        tx.query(`select public.save_device($1, $2::jsonb, $3::jsonb)`, [
          id,
          JSON.stringify({ name: "Sync Phone", brand_id: refs.apple, category_id: refs.smartphones }),
          JSON.stringify({ official_purchase_price: "1000000", company_profit: "150000" }),
        ]),
      { commit: true },
    );
    expect(Number(await projection(id))).toBe(1_150_000);

    await as(db, ROLE_USERS.manager, (tx) => tx.query(`select public.set_devices_status(array[$1]::uuid[], 'archived')`, [id]), {
      commit: true,
    });
    expect(await projection(id)).toBeUndefined();
  });

  it("does not publish data-entry submissions until a reviewer activates them", async () => {
    const id = await as(
      db,
      ROLE_USERS.entry,
      async (tx) =>
        (
          await tx.query<{ id: string }>(`select public.submit_device('Pending Phone', $1, $2, 900000) as id`, [
            refs.apple,
            refs.smartphones,
          ])
        ).rows[0].id,
      { commit: true },
    );
    expect(await projection(id)).toBeUndefined();

    await as(db, ROLE_USERS.manager, (tx) =>
      tx.query(`select public.save_device($1, $2::jsonb, $3::jsonb)`, [
        id,
        JSON.stringify({ name: "Pending Phone", brand_id: refs.apple, category_id: refs.smartphones, status: "active" }),
        JSON.stringify({ official_purchase_price: "900000", discount_value: "2", payback_amount: "3000", company_profit: "25000" }),
      ]),
      { commit: true },
    );
    // 900,000 − 18,000 − 3,000 + 25,000
    expect(Number(await projection(id))).toBe(904_000);
  });

  it("detects concurrent edits (optimistic concurrency)", async () => {
    const { id } = await priced("Concurrent", { official_purchase_price: "5000" });
    await expect(
      as(db, ROLE_USERS.manager, (tx) =>
        tx.query(`select public.save_device($1, $2::jsonb, null)`, [
          id,
          JSON.stringify({
            name: "Concurrent",
            brand_id: refs.apple,
            category_id: refs.smartphones,
            expected_updated_at: "2000-01-01T00:00:00Z",
          }),
        ]),
      ),
    ).rejects.toThrow(/modified by someone else/);
  });
});
