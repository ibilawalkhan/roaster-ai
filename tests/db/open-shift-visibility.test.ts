import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, type TestDb } from "./harness";

/**
 * Migration 0011 — open-shift visibility, the colleagues RPC, and the
 * append-only swap audit (M7 §3.2, M8 §3.3, M11 §8).
 *
 * These prove the widened access does exactly what it should and nothing more:
 * an OPEN shift becomes visible to the business, but drafts, other people's
 * assignments, wages and other tenants stay unreachable.
 */

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(async () => {
  await t?.close();
});

describe("open shifts are visible to the team (M8 §3.3)", () => {
  it("staff A2 can now see the OPEN shift dropped by staff A1", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA2, (db) =>
      db.query<{ id: string; status: string }>(
        "select id, status from public.shift where id = $1",
        [t.fx.openShiftA],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("open");
  });

  it("an open shift does NOT expose another person's ordinary assigned shift", async () => {
    // staffA2 must still not see staffA1's normal published shift.
    const { rows } = await t.asUser(t.fx.authStaffA2, (db) =>
      db.query("select id from public.shift where id = $1", [t.fx.shiftPubA]),
    );
    expect(rows).toHaveLength(0);
  });

  it("draft rosters stay invisible to staff (M11 §6 #9)", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("select id from public.shift where id = $1", [t.fx.shiftDraftA]),
    );
    expect(rows).toHaveLength(0);
  });

  it("open shifts never cross a tenant boundary", async () => {
    const { rows } = await t.asUser(t.fx.authManagerB, (db) =>
      db.query("select id from public.shift where id = $1", [t.fx.openShiftA]),
    );
    expect(rows).toHaveLength(0);
  });

  it("staff still cannot write to a shift they can now see", async () => {
    const res = await t.asUser(t.fx.authStaffA2, (db) =>
      db.query("update public.shift set assigned_user_id = $1 where id = $2", [
        t.fx.staffA2,
        t.fx.openShiftA,
      ]),
    );
    expect(res.affectedRows ?? 0).toBe(0);
  });
});

describe("colleagues_on_shift RPC (M7 §3.2)", () => {
  it("returns only user_id, name and role_id — never pay or contact details", async () => {
    const { rows, fields } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query<{ user_id: string; name: string; role_id: string }>(
        "select * from public.colleagues_on_shift($1)",
        [t.fx.shiftPubA],
      ),
    );
    const columns = fields.map((f) => f.name).sort();
    expect(columns).toEqual(["name", "role_id", "user_id"]);
    // Whatever the overlap, no wage column can ever come back down this wire.
    expect(columns).not.toContain("pay_rate");
    expect(Array.isArray(rows)).toBe(true);
  });

  it("reveals nothing to someone who is not on that shift", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA2, (db) =>
      db.query("select * from public.colleagues_on_shift($1)", [t.fx.shiftPubA]),
    );
    expect(rows).toHaveLength(0);
  });

  it("reveals nothing across a tenant boundary", async () => {
    const { rows } = await t.asUser(t.fx.authManagerB, (db) =>
      db.query("select * from public.colleagues_on_shift($1)", [t.fx.shiftPubA]),
    );
    expect(rows).toHaveLength(0);
  });
});

describe("manager swap transitions are atomic and audited (M8 §3.2, §7)", () => {
  it("cancel_open_shift reverts to the dropper, rejects claims and audits — in one transaction", async () => {
    const before = await t.db.query<{ n: number }>(
      "select count(*)::int as n from public.shift_claim where shift_id = $1 and outcome = 'pending'",
      [t.fx.openShiftA],
    );
    expect(before.rows[0].n).toBeGreaterThan(0); // the fixture has pending claims

    const res = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ status: string; assigned_user_id: string }>(
        "select status, assigned_user_id from public.cancel_open_shift($1)",
        [t.fx.openShiftA],
      ),
    );
    expect(res.rows[0].status).toBe("assigned");
    expect(res.rows[0].assigned_user_id).toBe(t.fx.staffA1); // back with the dropper

    const after = await t.db.query<{ n: number }>(
      "select count(*)::int as n from public.shift_claim where shift_id = $1 and outcome = 'pending'",
      [t.fx.openShiftA],
    );
    expect(after.rows[0].n).toBe(0); // no one left believing they might get it

    const events = await t.db.query<{ action: string }>(
      "select action from public.shift_swap_event where shift_id = $1 and action = 'cancel_open_shift'",
      [t.fx.openShiftA],
    );
    expect(events.rows).toHaveLength(1);
  });

  it("staff cannot call a manager-only transition", async () => {
    await expect(
      t.asUser(t.fx.authStaffA2, (db) =>
        db.query("select * from public.open_shift_to_team($1)", [t.fx.openShiftA]),
      ),
    ).rejects.toThrow(/only a manager/i);
  });
});

describe("swap audit is unforgeable and append-only (M11 §8)", () => {
  it("no client — not even a manager — can insert an audit event directly", async () => {
    // Every row is written by the SECURITY DEFINER functions alongside the
    // change it records, so the trail cannot be fabricated.
    await expect(
      t.asUser(t.fx.authManagerA, (db) =>
        db.query(
          `insert into public.shift_swap_event
             (business_id, shift_id, from_status, to_status, action, actor_user_id)
           values ($1, $2, 'open', 'assigned', 'fabricated', $3)`,
          [t.fx.businessA, t.fx.openShiftA, t.fx.managerA],
        ),
      ),
    ).rejects.toThrow();
  });

  it("a recorded event cannot be rewritten", async () => {
    await expect(
      t.asUser(t.fx.authManagerA, (db) =>
        db.query("update public.shift_swap_event set action = 'tampered' where business_id = $1", [
          t.fx.businessA,
        ]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
