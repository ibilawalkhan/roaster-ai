import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, type TestDb } from "./harness";

/**
 * Migration 0012 — swap-flow correctness (docs/MARKET_READINESS.md findings).
 *
 * Crucially these drive the flow through the RPCs **as the real users would**,
 * rather than seeding state as the DB owner. The earlier concurrency suite
 * seeded two claims with owner privileges, which meant it started from a state
 * the app itself could never reach — and so missed that only the first person
 * could ever claim.
 */

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(async () => {
  await t?.close();
});

/**
 * Put the fixture's open shift back to a clean OPEN state, owner-side.
 * Its role is set to the one staffA2 actually holds, so eligibility (which
 * migration 0012 now enforces in the database) is not the thing under test here.
 */
async function resetOpenShift() {
  await t.db.query("delete from public.shift_claim where shift_id = $1", [t.fx.openShiftA]);
  await t.db.query(
    `update public.shift
        set status = 'open', assigned_user_id = $2, drop_requested_by = $2, role_id = $3
      where id = $1`,
    [t.fx.openShiftA, t.fx.staffA1, t.fx.roleFohA],
  );
}

describe("two people can both claim the same open shift (M8 §3.3)", () => {
  it("stays visible after the first claim, so a second person can also offer", async () => {
    await resetOpenShift();

    // staffA2 claims it — through the RPC, as the app does.
    await t.asUser(t.fx.authStaffA2, (db) =>
      db.query("select * from public.claim_shift($1)", [t.fx.openShiftA]),
    );

    const status = await t.db.query<{ status: string }>(
      "select status from public.shift where id = $1",
      [t.fx.openShiftA],
    );
    expect(status.rows[0].status).toBe("claimed_pending");

    // The manager (a second, differently-roled member) must STILL see it —
    // before 0012 the shift vanished from everyone else the moment it moved to
    // claimed_pending, making "two claim → manager picks one" impossible.
    const visible = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("select id from public.shift where id = $1", [t.fx.openShiftA]),
    );
    expect(visible.rows).toHaveLength(1);
  });

  it("the claimant can still see their own claim after refreshing", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA2, (db) =>
      db.query<{ outcome: string }>(
        "select outcome from public.shift_claim where shift_id = $1 and claimant_user_id = $2",
        [t.fx.openShiftA, t.fx.staffA2],
      ),
    );
    expect(rows[0]?.outcome).toBe("pending");
  });

  it("a double-tap still yields exactly one claim", async () => {
    await t.asUser(t.fx.authStaffA2, (db) =>
      db.query("select * from public.claim_shift($1)", [t.fx.openShiftA]),
    );
    const { rows } = await t.db.query<{ n: number }>(
      "select count(*)::int as n from public.shift_claim where shift_id = $1 and claimant_user_id = $2",
      [t.fx.openShiftA, t.fx.staffA2],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("claim_shift enforces eligibility at the database (M8 §4)", () => {
  it("refuses someone who does not hold the role", async () => {
    await resetOpenShift();
    // staffA2 works Front of House and Kitchen, but is not a Manager.
    await t.db.query("update public.shift set role_id = $2 where id = $1", [
      t.fx.openShiftA,
      t.fx.roleMgrA,
    ]);
    await expect(
      t.asUser(t.fx.authStaffA2, (db) =>
        db.query("select * from public.claim_shift($1)", [t.fx.openShiftA]),
      ),
    ).rejects.toThrow(/not signed off for that role/i);
  });

  it("refuses the dropper covering their own shift", async () => {
    await resetOpenShift();
    await expect(
      t.asUser(t.fx.authStaffA1, (db) =>
        db.query("select * from public.claim_shift($1)", [t.fx.openShiftA]),
      ),
    ).rejects.toThrow(/already your shift/i);
  });
});

describe("request_drop guards (M8 §3.1)", () => {
  it("refuses a shift that has already started", async () => {
    await t.db.query(
      `update public.shift
          set status = 'assigned', start_at = now() - interval '2 hours',
              end_at = now() + interval '2 hours'
        where id = $1`,
      [t.fx.shiftPubA],
    );
    await expect(
      t.asUser(t.fx.authStaffA1, (db) =>
        db.query("select * from public.request_drop($1, null)", [t.fx.shiftPubA]),
      ),
    ).rejects.toThrow(/already started/i);
  });

  it("refuses a shift in a draft roster the staff member cannot even see", async () => {
    await expect(
      t.asUser(t.fx.authStaffA1, (db) =>
        db.query("select * from public.request_drop($1, null)", [t.fx.shiftDraftA]),
      ),
    ).rejects.toThrow(/shift not found/i);
  });
});

describe("reassign_shift never orphans a pending claim (M8 §1)", () => {
  it("assigns the new person, rejects outstanding claims and audits, atomically", async () => {
    await resetOpenShift();
    await t.db.query("update public.shift set role_id = $2 where id = $1", [
      t.fx.openShiftA,
      t.fx.roleFohA,
    ]);
    await t.asUser(t.fx.authStaffA2, (db) =>
      db.query("select * from public.claim_shift($1)", [t.fx.openShiftA]),
    );

    // Manager reassigns directly to someone else entirely.
    const res = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ assigned_user_id: string; status: string }>(
        "select assigned_user_id, status from public.reassign_shift($1, $2)",
        [t.fx.openShiftA, t.fx.managerA],
      ),
    );
    expect(res.rows[0].assigned_user_id).toBe(t.fx.managerA);
    expect(res.rows[0].status).toBe("assigned");

    const pending = await t.db.query<{ n: number }>(
      "select count(*)::int as n from public.shift_claim where shift_id = $1 and outcome = 'pending'",
      [t.fx.openShiftA],
    );
    expect(pending.rows[0].n).toBe(0); // nobody left waiting forever

    const events = await t.db.query<{ n: number }>(
      "select count(*)::int as n from public.shift_swap_event where shift_id = $1 and action = 'reassign_shift'",
      [t.fx.openShiftA],
    );
    expect(events.rows[0].n).toBe(1);
  });

  it("staff cannot reassign a shift", async () => {
    await expect(
      t.asUser(t.fx.authStaffA2, (db) =>
        db.query("select * from public.reassign_shift($1, $2)", [t.fx.openShiftA, t.fx.staffA2]),
      ),
    ).rejects.toThrow(/only a manager/i);
  });
});

describe("required_level is a MINIMUM, not an exact match (migration 0017)", () => {
  it("lets a SENIOR cover a shift that only requires Mid", async () => {
    // The solver has always treated the level as a floor; claim_shift used to
    // demand an exact match, turning away the most experienced person in the
    // building when they offered to help.
    await resetOpenShift();
    await t.db.query(
      `update public.roster_position set required_level = 'mid' where id = $1`,
      [t.fx.positionA],
    );
    await t.db.query(`update public.shift set roster_position_id = $2 where id = $1`, [
      t.fx.openShiftA,
      t.fx.positionA,
    ]);
    // managerA is senior and holds the Manager role; align the shift's role.
    await t.db.query(`update public.shift set role_id = $2 where id = $1`, [
      t.fx.openShiftA,
      t.fx.roleMgrA,
    ]);

    const res = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("select * from public.claim_shift($1)", [t.fx.openShiftA]),
    );
    expect(res.rows).toHaveLength(1);
  });

  it("still refuses someone BELOW the required level", async () => {
    await resetOpenShift();
    await t.db.query(
      `update public.roster_position set required_level = 'senior' where id = $1`,
      [t.fx.positionA],
    );
    await t.db.query(
      `update public.shift set roster_position_id = $2, role_id = $3 where id = $1`,
      [t.fx.openShiftA, t.fx.positionA, t.fx.roleFohA],
    );
    // staffA2 is 'mid' — below the senior floor.
    await expect(
      t.asUser(t.fx.authStaffA2, (db) =>
        db.query("select * from public.claim_shift($1)", [t.fx.openShiftA]),
      ),
    ).rejects.toThrow(/more experience/i);
  });
});
