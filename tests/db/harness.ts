import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const root = path.resolve(import.meta.dirname, "../..");
const migrationsDir = path.join(root, "supabase", "migrations");

export type Db = PGlite;
export type Tx = Transaction;

export const ROLE_USERS = {
  admin: "00000000-0000-4000-8000-000000000001",
  admin2: "00000000-0000-4000-8000-000000000002",
  manager: "00000000-0000-4000-8000-000000000003",
  viewer: "00000000-0000-4000-8000-000000000004",
  entry: "00000000-0000-4000-8000-000000000005",
  inactive: "00000000-0000-4000-8000-000000000006",
} as const;

/** Boots an in-process Postgres, applies the Supabase stub and every migration in order. */
export async function createDatabase(): Promise<Db> {
  const db = await PGlite.create({ extensions: { pg_trgm, pgcrypto } });
  await db.exec(readFileSync(path.join(import.meta.dirname, "supabase-stub.sql"), "utf8"));

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    try {
      await db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  return db;
}

/** Invited users (one per role), set up as the trusted postgres role. */
export async function seedUsers(db: Db) {
  const users: Array<[string, string, string, boolean]> = [
    [ROLE_USERS.admin, "admin@example.com", "administrator", true],
    [ROLE_USERS.admin2, "admin2@example.com", "administrator", false],
    [ROLE_USERS.manager, "manager@example.com", "pricing_manager", true],
    [ROLE_USERS.viewer, "viewer@example.com", "viewer", true],
    [ROLE_USERS.entry, "entry@example.com", "data_entry", true],
    [ROLE_USERS.inactive, "inactive@example.com", "pricing_manager", false],
  ];
  for (const [id, email, role, active] of users) {
    await db.query(`insert into auth.users (id, email, invited_at) values ($1, $2, now())`, [id, email]);
    await db.query(
      `update public.profiles set role = $2::public.app_role, is_active = $3, full_name = $4 where id = $1`,
      [id, role, active, email.split("@")[0]],
    );
  }
}

export async function seedCatalogue(db: Db) {
  const brand = async (name: string, color: string) =>
    (
      await db.query<{ id: string }>(`insert into public.brands (name, accent_color) values ($1, $2) returning id`, [
        name,
        color,
      ])
    ).rows[0].id;
  const category = async (name: string) =>
    (await db.query<{ id: string }>(`insert into public.categories (name) values ($1) returning id`, [name])).rows[0].id;

  return {
    apple: await brand("Apple", "#111827"),
    samsung: await brand("Samsung", "#1D4ED8"),
    smartphones: await category("Smartphones"),
    tablets: await category("Tablets"),
  };
}

/**
 * Runs `fn` inside a transaction exactly as a Supabase API request would:
 * switched to the Postgres role with the user's JWT claims. Rolled back unless
 * `commit` is true.
 */
export async function as<T>(
  db: Db,
  userId: string | null,
  fn: (tx: Tx) => Promise<T>,
  options: { role?: "authenticated" | "anon" | "service_role"; commit?: boolean } = {},
): Promise<T> {
  const role = options.role ?? (userId ? "authenticated" : "anon");
  let result: T;
  const ROLLBACK = Symbol("rollback");
  try {
    await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify(userId ? { sub: userId, role } : { role }),
      ]);
      await tx.exec(`set local role ${role}`);
      result = await fn(tx);
      if (!options.commit) throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return result!;
}

/** Creates a fully priced device as the Pricing Manager through save_device(). */
export async function createPricedDevice(
  db: Db,
  device: Record<string, unknown>,
  financials: Record<string, string | number>,
) {
  return as(
    db,
    ROLE_USERS.manager,
    async (tx) =>
      (
        await tx.query<{ id: string }>(`select public.save_device(null, $1::jsonb, $2::jsonb) as id`, [
          JSON.stringify(device),
          JSON.stringify(financials),
        ])
      ).rows[0].id,
    { commit: true },
  );
}
