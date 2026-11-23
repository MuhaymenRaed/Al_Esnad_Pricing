import { beforeEach, describe, expect, it } from "vitest";
import { ROLE_USERS, as, createDatabase, createPricedDevice, seedCatalogue, seedUsers, type Db } from "./harness";

let db: Db;
let refs: Awaited<ReturnType<typeof seedCatalogue>>;
let deviceId: string;

const PRICE = { official_purchase_price: "1000000", discount_type: "percentage", discount_value: "1", payback_amount: "0", company_profit: "50000" };

beforeEach(async () => {
  db = await createDatabase();
  await seedUsers(db);
  refs = await seedCatalogue(db);
  deviceId = await createPricedDevice(db, { name: "Galaxy S", brand_id: refs.samsung, category_id: refs.smartphones, status: "active" }, PRICE);
});

const deleteAs = (userId: string, ids: string[]) =>
  as(db, userId, async (tx) => (await tx.query<{ n: number }>(`select public.delete_devices($1::uuid[]) n`, [ids])).rows[0].n, { commit: true });

const counts = async () =>
  (
    await db.query<{ devices: number; financials: number; prices: number }>(
      `select (select count(*)::int from public.devices) devices, (select count(*)::int from public.device_financials) financials,
              (select count(*)::int from public.device_public_pricing) prices`,
    )
  ).rows[0];

describe("Device deletion", () => {
  it("lets an administrator delete devices with their pricing, and audits it", async () => {
    expect(await counts()).toEqual({ devices: 1, financials: 1, prices: 1 });
    expect(await deleteAs(ROLE_USERS.admin, [deviceId])).toBe(1);
    expect(await counts()).toEqual({ devices: 0, financials: 0, prices: 0 });

    const { rows } = await db.query<{ table_name: string; actor_id: string; name: string | null }>(
      `select table_name, actor_id, old_data->>'name' name from public.audit_logs
        where action = 'DELETE' and record_id = $1 order by table_name`,
      [deviceId],
    );
    expect(rows).toEqual([
      { table_name: "device_financials", actor_id: ROLE_USERS.admin, name: null },
      { table_name: "devices", actor_id: ROLE_USERS.admin, name: "Galaxy S" },
    ]);
  });

  it("returns 0 for an empty selection and ignores unknown ids", async () => {
    expect(await deleteAs(ROLE_USERS.admin, [])).toBe(0);
    expect(await deleteAs(ROLE_USERS.admin, ["00000000-0000-4000-8000-0000000000ff"])).toBe(0);
    expect((await counts()).devices).toBe(1);
  });

  it("refuses every other role by default, and direct table deletes", async () => {
    for (const user of [ROLE_USERS.manager, ROLE_USERS.viewer, ROLE_USERS.entry, ROLE_USERS.inactive]) {
      await expect(deleteAs(user, [deviceId])).rejects.toThrow(/Not authorized to delete devices/);
    }
    await expect(
      as(db, ROLE_USERS.admin, (tx) => tx.query(`delete from public.devices where id = $1`, [deviceId])),
    ).rejects.toThrow(/permission denied/i);
    expect((await counts()).devices).toBe(1);
  });

  it("can be granted to Pricing Managers but never to Viewers or Data Entry", async () => {
    const grant = (role: string) =>
      as(db, ROLE_USERS.admin, (tx) => tx.query(`select public.admin_set_role_permission($1::public.app_role, 'devices.delete', true)`, [role]), {
        commit: true,
      });
    await expect(grant("viewer")).rejects.toThrow(/locked/);
    await expect(grant("data_entry")).rejects.toThrow(/locked/);
    await grant("pricing_manager");
    expect(await deleteAs(ROLE_USERS.manager, [deviceId])).toBe(1);
  });

  it("is part of an administrator's permissions", async () => {
    const permissions = await as(db, ROLE_USERS.admin, async (tx) => (await tx.query<{ p: string[] }>(`select public.my_context()->'permissions' p`)).rows[0].p);
    expect(permissions).toContain("devices.delete");
  });

  it("frees a brand for deletion once its devices are gone", async () => {
    const deleteBrand = () => as(db, ROLE_USERS.admin, (tx) => tx.query(`delete from public.brands where id = $1`, [refs.samsung]), { commit: true });
    await expect(deleteBrand()).rejects.toThrow(/foreign key/i);
    await deleteAs(ROLE_USERS.admin, [deviceId]);
    await deleteBrand();
    expect((await db.query(`select 1 from public.brands where id = $1`, [refs.samsung])).rows).toHaveLength(0);
  });
});
