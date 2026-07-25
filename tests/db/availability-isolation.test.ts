import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, type TestDb } from "./harness";

/**
 * Availability RLS (M3 §6, M11 §6 #7, #10). Staff read/write only their own
 * availability; managers read/write all in their business; nothing crosses
 * tenants.
 */

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(async () => {
  await t?.close();
});

describe("availability_pattern", () => {
  it("staff A1 sees only their own pattern rows (§6 #7)", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query<{ user_id: string }>("select user_id from public.availability_pattern"),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.user_id === t.fx.staffA1)).toBe(true);
  });

  it("manager A sees all patterns in the business, none from B", async () => {
    const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ business_id: string }>("select business_id from public.availability_pattern"),
    );
    expect(rows.every((r) => r.business_id === t.fx.businessA)).toBe(true);
    expect(rows.find((r) => r.business_id === t.fx.businessB)).toBeUndefined();
  });

  it("staff A1 can upsert their own pattern", async () => {
    const res = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query(
        `insert into public.availability_pattern (business_id, user_id, day_of_week, is_available)
         values ($1, $2, 3, true)`,
        [t.fx.businessA, t.fx.staffA1],
      ),
    );
    expect(res.affectedRows ?? 0).toBe(1);
  });

  it("staff A1 cannot write availability for another staff member (§6 #10)", async () => {
    await expect(
      t.asUser(t.fx.authStaffA1, (db) =>
        db.query(
          `insert into public.availability_pattern (business_id, user_id, day_of_week, is_available)
           values ($1, $2, 4, false)`,
          [t.fx.businessA, t.fx.staffA2],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe("availability_exception", () => {
  it("staff A1 sees only their own exceptions", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query<{ user_id: string }>("select user_id from public.availability_exception"),
    );
    expect(rows.every((r) => r.user_id === t.fx.staffA1)).toBe(true);
  });

  it("staff of A cannot read B's exceptions (cross-tenant)", async () => {
    // Seed a B exception as owner, then confirm A staff can't see it.
    await t.db.query(
      `insert into public.availability_exception (business_id, user_id, date, is_available, source)
       values ($1, $2, '2026-08-20', false, 'manager')`,
      [t.fx.businessB, t.fx.managerB],
    );
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("select id from public.availability_exception where user_id = $1", [t.fx.managerB]),
    );
    expect(rows).toHaveLength(0);
  });

  it("a manager can set an exception on a staff member's behalf", async () => {
    const res = await t.asUser(t.fx.authManagerA, (db) =>
      db.query(
        `insert into public.availability_exception
           (business_id, user_id, date, is_available, source, created_by_user_id)
         values ($1, $2, '2026-08-25', false, 'manager', $3)`,
        [t.fx.businessA, t.fx.staffA2, t.fx.managerA],
      ),
    );
    expect(res.affectedRows ?? 0).toBe(1);
  });
});
