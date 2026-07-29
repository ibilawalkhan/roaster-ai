import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, type TestDb } from "./harness";

/**
 * Tenant-isolation + within-business access suite (Module 11 §6).
 * The database is the security boundary — these assertions run against the REAL
 * RLS policies in supabase/migrations. Cases are numbered to M11 §6.
 */

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(async () => {
  await t?.close();
});

describe("cross-tenant isolation — business A cannot read business B (§6 #1–4)", () => {
  it("manager A sees only their own business row", async () => {
    const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ id: string }>("select id from public.business"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(t.fx.businessA);
  });

  it("manager A cannot read B's locations, roles, staff, trading hours or rules", async () => {
    const tables = ["location", "role", "app_user", "trading_hours", "scheduling_rule"];
    for (const tbl of tables) {
      const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
        db.query<{ business_id: string }>(`select business_id from public.${tbl}`),
      );
      expect(rows.length).toBeGreaterThan(0); // A's own rows are visible
      expect(rows.every((r) => r.business_id === t.fx.businessA)).toBe(true);
      expect(rows.find((r) => r.business_id === t.fx.businessB)).toBeUndefined();
    }
  });

  it("a cross-tenant UPDATE affects zero rows (§6 #3)", async () => {
    const res = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("update public.app_user set name = 'HACKED' where business_id = $1", [t.fx.businessB]),
    );
    expect(res.affectedRows ?? 0).toBe(0);
    const check = await t.asUser(t.fx.authManagerB, (db) =>
      db.query<{ name: string }>("select name from public.app_user where id = $1", [t.fx.managerB]),
    );
    expect(check.rows[0].name).toBe("Guildford Mgr");
  });

  it("staff of A cannot read anything of B (§6 #4)", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("select id from public.business where id = $1", [t.fx.businessB]),
    );
    expect(rows).toHaveLength(0);
  });
});

describe("within-business — wage & settings privacy (§6 #6–8, #13)", () => {
  it("staff A1 reads only their own app_user row (§6 #6 wage privacy)", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query<{ id: string }>("select id from public.app_user"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(t.fx.staffA1);
  });

  it("staff A1 cannot see colleague A2's row", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("select id from public.app_user where id = $1", [t.fx.staffA2]),
    );
    expect(rows).toHaveLength(0);
  });

  it("staff cannot read scheduling rules or trading hours (manager-only) (§6 #8-ish)", async () => {
    const rules = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("select id from public.scheduling_rule"),
    );
    const hours = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("select id from public.trading_hours"),
    );
    expect(rules.rows).toHaveLength(0);
    expect(hours.rows).toHaveLength(0);
  });

  it("staff CAN read locations and roles (reference data they need)", async () => {
    const locs = await t.asUser(t.fx.authStaffA1, (db) => db.query("select id from public.location"));
    const roles = await t.asUser(t.fx.authStaffA1, (db) => db.query("select id from public.role"));
    expect(locs.rows.length).toBeGreaterThan(0);
    expect(roles.rows.length).toBeGreaterThan(0);
  });

  it("staff cannot escalate themselves to manager (§6 #13)", async () => {
    await expect(
      t.asUser(t.fx.authStaffA1, (db) =>
        db.query("update public.app_user set is_manager = true where id = $1", [t.fx.staffA1]),
      ),
    ).rejects.toThrow(/contact details/i);
  });

  it("staff cannot change their own pay rate", async () => {
    await expect(
      t.asUser(t.fx.authStaffA1, (db) =>
        db.query("update public.app_user set pay_rate = 999 where id = $1", [t.fx.staffA1]),
      ),
    ).rejects.toThrow(/contact details/i);
  });

  it("staff CAN update their own email", async () => {
    const res = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("update public.app_user set email = 'sara.new@altazah.com.au' where id = $1", [t.fx.staffA1]),
    );
    expect(res.affectedRows ?? 0).toBe(1);
  });
});

describe("manager positive controls", () => {
  it("manager A sees all staff in their business", async () => {
    const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("select id from public.app_user"),
    );
    expect(rows).toHaveLength(3); // managerA + staffA1 + staffA2
  });

  it("manager A can read their scheduling rule and trading hours", async () => {
    const rules = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("select id from public.scheduling_rule"),
    );
    const hours = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("select id from public.trading_hours"),
    );
    expect(rules.rows).toHaveLength(1);
    expect(hours.rows.length).toBeGreaterThan(0);
  });
});

describe("user_role visibility (M2 multi-role)", () => {
  it("manager A sees all role assignments in their business, none from B", async () => {
    const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ business_id: string; user_id: string }>(
        "select business_id, user_id from public.user_role",
      ),
    );
    // Asserted by tenancy rather than a hard count: people may hold several
    // roles (M2 §3.2), so the number of rows is a fixture detail — that every
    // row belongs to business A, and none to B, is the actual invariant.
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.every((r) => r.business_id === t.fx.businessA)).toBe(true);
    const users = new Set(rows.map((r) => r.user_id));
    expect(users).toEqual(new Set([t.fx.managerA, t.fx.staffA1, t.fx.staffA2]));
  });

  it("staff A1 sees only their own role assignments", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query<{ user_id: string }>("select user_id from public.user_role"),
    );
    expect(rows.every((r) => r.user_id === t.fx.staffA1)).toBe(true);
  });
});

describe("unauthenticated access", () => {
  it("a request with an unknown JWT sub sees no rows (§6 #15)", async () => {
    const { rows } = await t.asUser("00000000-0000-0000-0000-000000000000", (db) =>
      db.query("select id from public.business"),
    );
    expect(rows).toHaveLength(0);
  });
});
