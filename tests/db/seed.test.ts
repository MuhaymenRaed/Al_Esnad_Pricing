import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { createDatabase } from "./harness";

it("starter seed applies cleanly and is idempotent", async () => {
  const db = await createDatabase();
  const seed = readFileSync(path.join(import.meta.dirname, "../../supabase/seed.sql"), "utf8");
  await db.exec(seed);
  await db.exec(seed);
  const { rows } = await db.query<{ brands: number; categories: number; devices: number }>(
    `select (select count(*)::int from public.brands) brands, (select count(*)::int from public.categories) categories,
            (select count(*)::int from public.devices) devices`,
  );
  expect(rows[0]).toEqual({ brands: 4, categories: 5, devices: 0 });
  await db.close();
});
