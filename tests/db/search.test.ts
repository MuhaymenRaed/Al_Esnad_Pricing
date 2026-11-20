import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLE_USERS, as, createDatabase, seedCatalogue, seedUsers, type Db } from "./harness";

let db: Db;
let refs: Awaited<ReturnType<typeof seedCatalogue>>;

type Row = { id: string; name: string; brand_name: string; final_selling_price: string; sort_value: string; total_count: string | null };

beforeAll(async () => {
  db = await createDatabase();
  await seedUsers(db);
  refs = await seedCatalogue(db);

  const devices: Array<[string, string, string, number, number]> = [
    ["iPhone 18", refs.apple, refs.smartphones, 2_800_000, 50_000],
    ["iPhone 18 Pro", refs.apple, refs.smartphones, 3_400_000, 60_000],
    ["iPhone 18 Pro Max", refs.apple, refs.smartphones, 3_900_000, 70_000],
    ["iPad Air", refs.apple, refs.tablets, 1_200_000, 30_000],
    ["Galaxy S26", refs.samsung, refs.smartphones, 2_600_000, 45_000],
    ["Galaxy A57", refs.samsung, refs.smartphones, 650_000, 20_000],
    ["Galaxy Tab S11", refs.samsung, refs.tablets, 1_500_000, 35_000],
  ];
  // Plus filler to exercise pagination.
  for (let i = 1; i <= 45; i++) {
    devices.push([`Filler ${String(i).padStart(2, "0")}`, i % 2 ? refs.apple : refs.samsung, refs.smartphones, 100_000 + i * 1000, 1000]);
  }

  await as(
    db,
    ROLE_USERS.manager,
    async (tx) => {
      for (const [name, brand, category, price, profit] of devices) {
        await tx.query(`select public.save_device(null, $1::jsonb, $2::jsonb)`, [
          JSON.stringify({ name, brand_id: brand, category_id: category, status: "active" }),
          JSON.stringify({ official_purchase_price: String(price), company_profit: String(profit) }),
        ]);
      }
    },
    { commit: true },
  );
});
afterAll(() => db.close());

const catalog = (filters: object, sort = "name_asc", cursor: object | null = null, limit = 50) =>
  as(db, ROLE_USERS.viewer, async (tx) =>
    (
      await tx.query<Row>(`select * from public.search_catalog($1::jsonb, $2, $3::jsonb, $4)`, [
        JSON.stringify(filters),
        sort,
        cursor ? JSON.stringify(cursor) : null,
        limit,
      ])
    ).rows,
  );

describe("Scenario 6 — filtering", () => {
  it("filters Apple devices by a selling price range", async () => {
    const rows = await catalog({ brandIds: [refs.apple], priceMin: 2_000_000, priceMax: 3_500_000 });
    expect(rows.map((r) => r.name)).toEqual(["iPhone 18", "iPhone 18 Pro"]);
    expect(rows.every((r) => r.brand_name === "Apple")).toBe(true);
  });

  it("combines brand, price, text search and alphabetical sorting", async () => {
    const rows = await catalog({ brandIds: [refs.apple], priceMin: 2_000_000, q: "iphone pro" }, "name_desc");
    expect(rows.map((r) => r.name)).toEqual(["iPhone 18 Pro Max", "iPhone 18 Pro"]);
  });

  it("matches brand and category names, case-insensitively", async () => {
    expect((await catalog({ q: "SAMSUNG tab" })).map((r) => r.name)).toEqual(["Galaxy Tab S11"]);
    expect((await catalog({ q: "tablets" })).map((r) => r.name)).toEqual(["Galaxy Tab S11", "iPad Air"]);
  });

  it("tolerates typos with trigram similarity", async () => {
    const rows = await catalog({ q: "galaxi s26" });
    expect(rows.map((r) => r.name)).toContain("Galaxy S26");
  });

  it("treats LIKE wildcards in user input literally", async () => {
    expect(await catalog({ q: "%" })).toHaveLength(0);
    expect(await catalog({ q: "_" })).toHaveLength(0);
  });

  it("sorts by price in both directions", async () => {
    const asc = await catalog({ brandIds: [refs.samsung], q: "galaxy" }, "price_asc");
    expect(asc.map((r) => r.name)).toEqual(["Galaxy A57", "Galaxy Tab S11", "Galaxy S26"]);
    const desc = await catalog({ brandIds: [refs.samsung], q: "galaxy" }, "price_desc");
    expect(desc.map((r) => r.name)).toEqual(["Galaxy S26", "Galaxy Tab S11", "Galaxy A57"]);
  });

  it("returns facet counts and statistics for the same filters", async () => {
    const summary = await as(db, ROLE_USERS.viewer, async (tx) =>
      (
        await tx.query<{ s: { stats: { count: number }; brands: Array<{ label: string; count: number }> } }>(
          `select public.catalog_summary($1::jsonb) s`,
          [JSON.stringify({ brandIds: [refs.apple], q: "iphone" })],
        )
      ).rows[0].s,
    );
    expect(summary.stats.count).toBe(3);
    // Brand facet ignores the brand filter itself so users can see alternatives.
    expect(summary.brands.map((b) => b.label).sort()).toEqual(["Apple"]);
  });

  it("supports private-amount filters and sorts for pricing managers", async () => {
    const rows = await as(db, ROLE_USERS.manager, async (tx) =>
      (
        await tx.query<{ name: string }>(`select name from public.search_devices($1::jsonb, 'profit_desc')`, [
          JSON.stringify({ priceField: "profit", priceMin: 50_000 }),
        ])
      ).rows,
    );
    expect(rows.map((r) => r.name)).toEqual(["iPhone 18 Pro Max", "iPhone 18 Pro", "iPhone 18"]);
  });
});

describe("Cursor pagination", () => {
  for (const sort of ["name_asc", "name_desc", "newest", "oldest", "price_asc", "price_desc"]) {
    it(`walks every row exactly once (${sort})`, async () => {
      const all = await catalog({}, sort, null, 1000);
      const seen: string[] = [];
      let cursor: object | null = null;
      let total: string | null = null;
      for (let page = 0; page < 20; page++) {
        const rows = await catalog({}, sort, cursor, 10);
        if (page === 0) total = rows[0]?.total_count ?? null;
        else expect(rows[0]?.total_count ?? null).toBeNull();
        seen.push(...rows.map((r) => r.id));
        if (rows.length < 10) break;
        const last = rows[rows.length - 1];
        cursor = { v: last.sort_value, id: last.id };
      }
      expect(Number(total)).toBe(all.length);
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).toEqual(all.map((r) => r.id));
    });
  }
});

describe("Selection export scope", () => {
  it("returns exactly the selected devices, across brands", async () => {
    const all = await catalog({ q: "iphone" });
    const galaxy = await catalog({ q: "galaxy s26" });
    const ids = [all[0].id, all[1].id, galaxy[0].id];
    const rows = await catalog({ ids }, "name_asc", null, 1000);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.brand_name))).toEqual(new Set(["Apple", "Samsung"]));
  });

  it("an empty selection returns nothing (never the whole catalogue)", async () => {
    expect(await catalog({ ids: [] })).toHaveLength(0);
  });
});
