import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { createDatabase, type Db } from "./harness";

const read = (relative: string) => readFileSync(path.join(import.meta.dirname, relative), "utf8");
const SEED = read("../../supabase/seed.sql");
const SEED_V1 = read("./fixtures/seed-v1.sql");
const CLEANUP = read("../../supabase/remove-accessories.sql");

const EXAMPLES = ["Galaxy A56 5G 256GB", "Galaxy Tab S10 FE 128GB", "iPad Air 11 (M3) 128GB", "iPhone 17 Pro Max 256GB", "Redmi Note 14 Pro 256GB"];

async function counts(db: Db) {
  const { rows } = await db.query<{ brands: number; categories: number; devices: number; financials: number; public_prices: number }>(
    `select (select count(*)::int from public.brands) brands, (select count(*)::int from public.categories) categories,
            (select count(*)::int from public.devices) devices, (select count(*)::int from public.device_financials) financials,
            (select count(*)::int from public.device_public_pricing) public_prices`,
  );
  return rows[0];
}

const names = async (db: Db, table: "brands" | "categories" | "devices", where = "true") =>
  (await db.query<{ name: string }>(`select name from public.${table} where ${where} order by lower(name)`)).rows.map((r) => r.name);

it("starter seed applies cleanly and is idempotent (phones and tablets only)", async () => {
  const db = await createDatabase();
  await db.exec(SEED);
  await db.exec(SEED);
  expect(await counts(db)).toEqual({ brands: 18, categories: 3, devices: 5, financials: 5, public_prices: 5 });
  expect(await names(db, "categories")).toEqual(["Feature phones", "Smartphones", "Tablets"]);
  expect(await names(db, "brands", "lower(name) in ('anker','jbl','baseus')")).toEqual([]);
  await db.close();
});

it("example devices are priced by the database trigger", async () => {
  const db = await createDatabase();
  await db.exec(SEED);
  const { rows } = await db.query<{ name: string; brand: string; category: string; discount: string; cost: string; selling: string; public_price: string }>(
    `select d.name, b.name brand, c.name category,
            f.discount_amount::text discount, f.final_cost_before_profit::text cost, f.final_selling_price::text selling,
            p.final_selling_price::text public_price
       from public.devices d
       join public.brands b on b.id = d.brand_id
       join public.categories c on c.id = d.category_id
       join public.device_financials f on f.device_id = d.id
       join public.device_public_pricing p on p.device_id = d.id
      order by lower(d.name)`,
  );
  expect(rows.map((r) => [r.name, r.brand, r.category, r.discount, r.cost, r.selling])).toEqual([
    ["Galaxy A56 5G 256GB", "Samsung", "Smartphones", "10000.00", "510000.00", "535000.00"],
    ["Galaxy Tab S10 FE 128GB", "Samsung", "Tablets", "15000.00", "605000.00", "635000.00"],
    ["iPad Air 11 (M3) 128GB", "Apple", "Tablets", "8500.00", "836500.00", "875000.00"],
    ["iPhone 17 Pro Max 256GB", "Apple", "Smartphones", "19000.00", "1871000.00", "1925000.00"],
    ["Redmi Note 14 Pro 256GB", "Xiaomi", "Smartphones", "0.00", "330000.00", "350000.00"],
  ]);
  expect(rows.every((r) => r.public_price === r.selling)).toBe(true);
  await db.close();
});

it("upgrades a database seeded with the first version: cleanup, then the new seed", async () => {
  const db = await createDatabase();
  await db.exec(SEED_V1);
  expect(await counts(db)).toMatchObject({ brands: 21, categories: 10, devices: 5 });

  await db.exec(CLEANUP);
  await db.exec(CLEANUP); // safe to repeat
  await db.exec(SEED);

  expect(await counts(db)).toEqual({ brands: 18, categories: 3, devices: 5, financials: 5, public_prices: 5 });
  expect(await names(db, "devices")).toEqual(EXAMPLES);
  expect(await names(db, "categories")).toEqual(["Feature phones", "Smartphones", "Tablets"]);
  const { rows } = await db.query<{ name: string; description: string }>(
    `select name, description from public.brands where lower(name) in ('apple', 'huawei', 'lenovo') order by name`,
  );
  expect(rows).toEqual([
    { name: "Apple", description: "iPhone and iPad" },
    { name: "Huawei", description: "Pura, Mate and nova phones, MatePad tablets" },
    { name: "Lenovo", description: "Lenovo Tab tablets" },
  ]);
  await db.close();
});

it("cleanup keeps (deactivated) anything real devices still use, and edited descriptions", async () => {
  const db = await createDatabase();
  await db.exec(SEED_V1);
  await db.exec(`
    insert into public.devices (name, brand_id, category_id, status)
    select 'Anker 737 Power Bank', b.id, c.id, 'draft'
    from public.brands b, public.categories c where b.name = 'Anker' and c.name = 'Power banks';
    update public.brands set description = 'Our own Apple text' where name = 'Apple';
  `);

  await db.exec(CLEANUP);

  expect(await names(db, "brands", "not is_active")).toEqual(["Anker"]);
  expect(await names(db, "categories", "not is_active")).toEqual(["Power banks"]);
  expect(await names(db, "brands", "lower(name) in ('jbl', 'baseus')")).toEqual([]);
  expect(await names(db, "devices", "name = 'Anker 737 Power Bank'")).toEqual(["Anker 737 Power Bank"]);
  expect(await names(db, "devices", "name in ('Galaxy Watch8 44mm', 'AirPods Pro 3')")).toEqual([]);
  const { rows } = await db.query<{ description: string }>(`select description from public.brands where name = 'Apple'`);
  expect(rows[0].description).toBe("Our own Apple text");
  await db.close();
});
