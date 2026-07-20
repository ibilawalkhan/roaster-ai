import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, type TestDb } from "./harness";

/**
 * The tenant-isolation invariant (REQUIREMENTS.md §1, §9; CLAUDE.md rule 1).
 * The highest-stakes correctness property in the app: business A can never see
 * business B's rows, and no staff member can ever see another's wage. These
 * assertions run against the REAL RLS policies in supabase/migrations.
 */

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(async () => {
  await t?.close();
});

describe("cross-tenant isolation (business A cannot read business B)", () => {
  it("manager A sees only their own business row", async () => {
    const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ id: string; name: string }>("select id, name from public.business"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(t.fx.businessA);
  });

  it("manager A cannot read business B's locations", async () => {
    const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ business_id: string }>("select business_id from public.location"),
    );
    expect(rows).toHaveLength(1);
    expect(rows.every((r) => r.business_id === t.fx.businessA)).toBe(true);
  });

  it("manager A cannot read business B's staff", async () => {
    const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ business_id: string }>("select business_id from public.app_user"),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.business_id === t.fx.businessA)).toBe(true);
  });

  it("manager A cannot read business B's rosters or shifts", async () => {
    const rosters = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ business_id: string }>("select business_id from public.roster"),
    );
    const shifts = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ business_id: string }>("select business_id from public.shift"),
    );
    expect(rosters.rows.every((r) => r.business_id === t.fx.businessA)).toBe(true);
    expect(shifts.rows.every((r) => r.business_id === t.fx.businessA)).toBe(true);
    expect(shifts.rows.find((r) => r.business_id === t.fx.businessB)).toBeUndefined();
  });

  it("a cross-tenant UPDATE affects zero rows (write isolation)", async () => {
    const res = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("update public.app_user set name = 'HACKED' where business_id = $1", [
        t.fx.businessB,
      ]),
    );
    expect(res.affectedRows ?? 0).toBe(0);

    // Confirm B's manager row is untouched, read from B's own context.
    const check = await t.asUser(t.fx.authManagerB, (db) =>
      db.query<{ name: string }>("select name from public.app_user where id = $1", [
        t.fx.managerB,
      ]),
    );
    expect(check.rows[0].name).toBe("Guildford Manager");
  });
});

describe("wage privacy (no staff member ever sees another's wage)", () => {
  it("staff A1 can read only their own app_user row", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query<{ id: string; pay_rate: string }>("select id, pay_rate from public.app_user"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(t.fx.staffA1);
  });

  it("staff A1 cannot see colleague A2's row or pay rate", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query<{ id: string }>("select id from public.app_user where id = $1", [t.fx.staffA2]),
    );
    expect(rows).toHaveLength(0);
  });

  it("a manager CAN see all staff in their own business (positive control)", async () => {
    const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("select id from public.app_user"),
    );
    // managerA + staffA1 + staffA2
    expect(rows).toHaveLength(3);
  });

  it("staff A1 cannot escalate: updating own pay_rate is rejected", async () => {
    await expect(
      t.asUser(t.fx.authStaffA1, (db) =>
        db.query("update public.app_user set pay_rate = 999 where id = $1", [t.fx.staffA1]),
      ),
    ).rejects.toThrow(/pay_rate/i);
  });

  it("staff A1 CAN update their own contact detail (email)", async () => {
    const res = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("update public.app_user set email = 'sara.new@altazah.com.au' where id = $1", [
        t.fx.staffA1,
      ]),
    );
    expect(res.affectedRows ?? 0).toBe(1);
  });
});

describe("staff row visibility", () => {
  it("staff A1 sees their own assigned shift", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query<{ id: string }>("select id from public.shift"),
    );
    expect(rows.map((r) => r.id)).toContain(t.fx.shiftA1);
  });

  it("staff A1 never sees business B's shift", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query<{ id: string }>("select id from public.shift where id = $1", [t.fx.shiftB1]),
    );
    expect(rows).toHaveLength(0);
  });
});

describe("unauthenticated access", () => {
  it("a request with no JWT sees no rows", async () => {
    // No asUser wrapper → role stays as the (owner) session but with empty
    // claims; current_business_id() resolves to NULL so policies match nothing
    // for authenticated. Simulate an authenticated request with a bogus sub.
    const { rows } = await t.asUser(
      "00000000-0000-0000-0000-000000000000",
      (db) => db.query("select id from public.business"),
    );
    expect(rows).toHaveLength(0);
  });
});
