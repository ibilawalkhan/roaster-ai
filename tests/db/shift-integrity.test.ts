import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { setupTestDb, type TestDb } from "./harness";

/**
 * Shift integrity suite (migration 0010).
 *
 * "Nobody is in two places at once" (M5 §5.1 H3) is enforced by the DATABASE,
 * not just the UI and the solver — CLAUDE.md rule 2: never trust the client.
 * These writes go in as the PGlite owner (bypassing RLS entirely), which is the
 * point: even a path with full privileges cannot double-book a person.
 */

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(async () => {
  await t?.close();
});

/** Insert a shift directly, no RLS. `from`/`to` are UTC times on 2026-09-01. */
function insertShift(assignedTo: string | null, from: string, to: string): Promise<unknown> {
  return t.db.query(
    `insert into public.shift
       (id, business_id, roster_id, location_id, date, start_at, end_at, role_id, assigned_user_id)
     values ($1, $2, $3, $4, '2026-09-01', $5::timestamptz, $6::timestamptz, $7, $8)`,
    [
      randomUUID(),
      t.fx.businessA,
      t.fx.rosterPubA,
      t.fx.locationA,
      `2026-09-01 ${from}+00`,
      `2026-09-01 ${to}+00`,
      t.fx.roleKitchenA,
      assignedTo,
    ],
  );
}

describe("no double-booking — one person, overlapping windows", () => {
  it("rejects a second overlapping shift for the same person", async () => {
    await insertShift(t.fx.staffA1, "00:00", "06:00");
    await expect(insertShift(t.fx.staffA1, "04:00", "10:00")).rejects.toThrow(
      /shift_no_overlap|already rostered on an overlapping shift/i,
    );
  });

  it("rejects a fully-contained overlap too", async () => {
    await expect(insertShift(t.fx.staffA1, "01:00", "02:00")).rejects.toThrow(
      /shift_no_overlap/i,
    );
  });

  it("rejects an UPDATE that moves someone onto an overlapping window", async () => {
    // A clean shift on its own, then dragged back over the 00:00–06:00 one.
    await insertShift(t.fx.staffA1, "12:00", "18:00");
    await expect(
      t.db.query(
        `update public.shift set start_at = '2026-09-01 05:00+00', end_at = '2026-09-01 11:00+00'
          where assigned_user_id = $1 and start_at = '2026-09-01 12:00+00'`,
        [t.fx.staffA1],
      ),
    ).rejects.toThrow(/shift_no_overlap/i);
  });

  it("rejects reassigning a shift to someone already working that window", async () => {
    // staffA2 is free 00:00-06:00; give them a shift, then try to hand it to staffA1.
    await insertShift(t.fx.staffA2, "00:00", "06:00");
    await expect(
      t.db.query(
        `update public.shift set assigned_user_id = $1
          where assigned_user_id = $2 and start_at = '2026-09-01 00:00+00'`,
        [t.fx.staffA1, t.fx.staffA2],
      ),
    ).rejects.toThrow(/shift_no_overlap/i);
  });
});

describe("what the constraint must NOT block", () => {
  it("allows back-to-back shifts that only touch at the endpoint ('[)' semantics)", async () => {
    // 10:00–16:00 then 16:00–22:00 is a normal handover, not an overlap.
    await expect(insertShift(t.fx.managerA, "10:00", "16:00")).resolves.toBeDefined();
    await expect(insertShift(t.fx.managerA, "16:00", "22:00")).resolves.toBeDefined();
  });

  it("allows two DIFFERENT people on overlapping shifts", async () => {
    await expect(insertShift(t.fx.staffA2, "14:00", "20:00")).resolves.toBeDefined();
    // managerA is already on 10:00–16:00 and 16:00–22:00, overlapping both.
    const { rows } = await t.db.query<{ n: number }>(
      `select count(*)::int as n from public.shift
        where date = '2026-09-01' and assigned_user_id is not null`,
    );
    expect(rows[0].n).toBeGreaterThan(2);
  });

  it("allows many UNFILLED shifts in the same window (null never clashes)", async () => {
    await expect(insertShift(null, "09:00", "17:00")).resolves.toBeDefined();
    await expect(insertShift(null, "09:00", "17:00")).resolves.toBeDefined();
    await expect(insertShift(null, "09:00", "17:00")).resolves.toBeDefined();
    const { rows } = await t.db.query<{ n: number }>(
      `select count(*)::int as n from public.shift
        where date = '2026-09-01' and assigned_user_id is null`,
    );
    expect(rows[0].n).toBe(3);
  });

  it("allows an unrelated edit to an existing shift (trigger is column-scoped)", async () => {
    const res = await t.db.query(
      `update public.shift set locked = true
        where assigned_user_id = $1 and start_at = '2026-09-01 00:00+00'`,
      [t.fx.staffA1],
    );
    expect(res.affectedRows ?? 0).toBe(1);
  });
});

describe("the guarantee holds through the swap RPCs too", () => {
  it("approve_claim cannot double-book a claimant who is already working", async () => {
    // An OPEN shift on 2026-09-02 10:00–18:00, dropped by staffA2.
    const openId = randomUUID();
    await t.db.query(
      `insert into public.shift
         (id, business_id, roster_id, location_id, date, start_at, end_at, role_id,
          assigned_user_id, status)
       values ($1, $2, $3, $4, '2026-09-02', '2026-09-02 10:00+00', '2026-09-02 18:00+00',
               $5, $6, 'open')`,
      [openId, t.fx.businessA, t.fx.rosterPubA, t.fx.locationA, t.fx.roleKitchenA, t.fx.staffA2],
    );
    // staffA1 is ALREADY working an overlapping window that day...
    await t.db.query(
      `insert into public.shift
         (id, business_id, roster_id, location_id, date, start_at, end_at, role_id, assigned_user_id)
       values ($1, $2, $3, $4, '2026-09-02', '2026-09-02 12:00+00', '2026-09-02 20:00+00', $5, $6)`,
      [randomUUID(), t.fx.businessA, t.fx.rosterPubA, t.fx.locationA, t.fx.roleKitchenA, t.fx.staffA1],
    );
    // ...yet claims the open shift, and the manager tries to approve it.
    const claimId = randomUUID();
    await t.db.query(
      "insert into public.shift_claim (id, business_id, shift_id, claimant_user_id) values ($1, $2, $3, $4)",
      [claimId, t.fx.businessA, openId, t.fx.staffA1],
    );
    await expect(
      t.asUser(t.fx.authManagerA, (db) =>
        db.query("select * from public.approve_claim($1, $2)", [openId, claimId]),
      ),
    ).rejects.toThrow(/shift_no_overlap/i);

    // The approval rolled back cleanly: the shift is untouched, still the dropper's.
    const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ status: string; assigned_user_id: string }>(
        "select status, assigned_user_id from public.shift where id = $1",
        [openId],
      ),
    );
    expect(rows[0].status).toBe("open");
    expect(rows[0].assigned_user_id).toBe(t.fx.staffA2); // never silently ownerless
  });
});

describe("roster_warning vocabulary (M6 live re-check)", () => {
  it("accepts rule = 'one_shift_per_day' (the term 0010 added)", async () => {
    const res = await t.asUser(t.fx.authManagerA, (db) =>
      db.query(
        `insert into public.roster_warning (business_id, roster_id, shift_id, rule, detail)
         values ($1, $2, $3, 'one_shift_per_day', 'Sara already has a shift on Mon 3 Aug')
         returning id`,
        [t.fx.businessA, t.fx.rosterPubA, t.fx.shiftPubA],
      ),
    );
    expect(res.rows).toHaveLength(1);
  });

  it("still accepts every pre-existing rule term", async () => {
    for (const rule of [
      "availability",
      "max_hours",
      "min_rest",
      "consecutive_days",
      "senior_coverage",
      "min_hours",
    ]) {
      const res = await t.asUser(t.fx.authManagerA, (db) =>
        db.query(
          `insert into public.roster_warning (business_id, roster_id, rule) values ($1, $2, $3) returning id`,
          [t.fx.businessA, t.fx.rosterPubA, rule],
        ),
      );
      expect(res.rows).toHaveLength(1);
    }
  });

  it("still rejects a term nothing emits", async () => {
    await expect(
      t.asUser(t.fx.authManagerA, (db) =>
        db.query(
          `insert into public.roster_warning (business_id, roster_id, rule) values ($1, $2, 'overlap')`,
          [t.fx.businessA, t.fx.rosterPubA],
        ),
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});
