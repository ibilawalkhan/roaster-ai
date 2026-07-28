import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { setupTestDb, type TestDb } from "./harness";

/**
 * Shift-swap concurrency suite (Module 8 §5 — THE critical section).
 *
 * CLAUDE.md non-negotiable rule 3: approving a claim runs in ONE transaction
 * that re-checks the shift is still OPEN/CLAIMED_PENDING, reassigns it, and
 * rejects the other claims. Concurrent approvals: EXACTLY ONE WINS.
 *
 * These assertions run against the real public.approve_claim() /
 * public.claim_shift() / public.request_drop() functions in supabase/migrations.
 */

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(async () => {
  await t?.close();
});

/**
 * Seed a fresh shift (as the PGlite owner, bypassing RLS) so tests stay independent.
 * Each call lands on its own DAY: since 0010 the database refuses to book one
 * person into two overlapping shifts, and these fixtures share a single staff
 * member. The date is irrelevant to what these tests assert.
 */
let seedDay = 10;
async function seedShift(
  db: PGlite,
  fx: TestDb["fx"],
  opts: { status: string; assignedTo: string | null },
): Promise<string> {
  const id = randomUUID();
  const date = `2026-08-${String(seedDay++).padStart(2, "0")}`;
  await db.query(
    `insert into public.shift
       (id, business_id, roster_id, location_id, date, start_at, end_at, role_id,
        assigned_user_id, status)
     values ($1, $2, $3, $4, $5::date, ($5 || ' 06:00+00')::timestamptz,
             ($5 || ' 13:00+00')::timestamptz, $6, $7, $8::public.shift_status)`,
    [
      id, fx.businessA, fx.rosterPubA, fx.locationA, date,
      fx.roleKitchenA, opts.assignedTo, opts.status,
    ],
  );
  return id;
}

describe("approve_claim — concurrent approvals, exactly one wins (§5)", () => {
  it("two simultaneous approvals of the same shift: one succeeds, one fails cleanly", async () => {
    // Both approvals are issued by the same manager (two tabs) — the exact
    // scenario M8 §5 names: "another manager or tab already approved".
    const settled = await t.asUser(t.fx.authManagerA, async (db) => {
      const first = db.query("select * from public.approve_claim($1, $2)", [
        t.fx.openShiftA,
        t.fx.claimStaffA2,
      ]);
      // Fired WITHOUT awaiting the first — both are in flight together.
      const second = db.query("select * from public.approve_claim($1, $2)", [
        t.fx.openShiftA,
        t.fx.claimManagerA,
      ]);
      return Promise.allSettled([first, second]);
    });

    const won = settled.filter((r) => r.status === "fulfilled");
    const lost = settled.filter((r) => r.status === "rejected");

    expect(won).toHaveLength(1); // exactly one winner
    expect(lost).toHaveLength(1);
    // The loser fails cleanly with a message the UI can show — never a silent overwrite.
    expect(String((lost[0] as PromiseRejectedResult).reason)).toMatch(/no longer available/i);
  });

  it("the shift ends up owned by exactly one person, with status 'assigned'", async () => {
    const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ status: string; assigned_user_id: string; original_user_id: string }>(
        "select status, assigned_user_id, original_user_id from public.shift where id = $1",
        [t.fx.openShiftA],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("assigned");
    // Ownership is unambiguous and is one of the two claimants (never null).
    expect([t.fx.staffA2, t.fx.managerA]).toContain(rows[0].assigned_user_id);
    // The dropper is preserved for audit (M8 §6).
    expect(rows[0].original_user_id).toBe(t.fx.staffA1);
  });

  it("exactly one claim is approved and the loser is rejected — none left pending", async () => {
    const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ id: string; claimant_user_id: string; outcome: string; decided_by: string }>(
        "select id, claimant_user_id, outcome, decided_by from public.shift_claim where shift_id = $1",
        [t.fx.openShiftA],
      ),
    );
    expect(rows).toHaveLength(2);
    const approved = rows.filter((r) => r.outcome === "approved");
    const rejected = rows.filter((r) => r.outcome === "rejected");
    expect(approved).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rows.every((r) => r.outcome !== "pending")).toBe(true);
    expect(approved[0].decided_by).toBe(t.fx.managerA);

    // The approved claimant is the person the shift is actually assigned to.
    const shift = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ assigned_user_id: string }>(
        "select assigned_user_id from public.shift where id = $1",
        [t.fx.openShiftA],
      ),
    );
    expect(approved[0].claimant_user_id).toBe(shift.rows[0].assigned_user_id);
  });

  it("exactly one approval event was recorded (audit, §6)", async () => {
    const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ from_status: string; to_status: string; actor_user_id: string }>(
        "select from_status, to_status, actor_user_id from public.shift_swap_event where shift_id = $1 and action = 'approve_claim'",
        [t.fx.openShiftA],
      ),
    );
    expect(rows).toHaveLength(1); // the loser wrote no event
    expect(rows[0].from_status).toBe("open");
    expect(rows[0].to_status).toBe("assigned");
    expect(rows[0].actor_user_id).toBe(t.fx.managerA);
  });

  it("approving an already-assigned shift raises 'no longer available'", async () => {
    await expect(
      t.asUser(t.fx.authManagerA, (db) =>
        db.query("select * from public.approve_claim($1, $2)", [
          t.fx.openShiftA,
          t.fx.claimStaffA2,
        ]),
      ),
    ).rejects.toThrow(/no longer available/i);
  });

  it("staff cannot approve a claim (manager-only gate)", async () => {
    const shiftId = await seedShift(t.db, t.fx, { status: "open", assignedTo: t.fx.staffA1 });
    const claimId = randomUUID();
    await t.db.query(
      "insert into public.shift_claim (id, business_id, shift_id, claimant_user_id) values ($1, $2, $3, $4)",
      [claimId, t.fx.businessA, shiftId, t.fx.staffA2],
    );
    await expect(
      t.asUser(t.fx.authStaffA1, (db) =>
        db.query("select * from public.approve_claim($1, $2)", [shiftId, claimId]),
      ),
    ).rejects.toThrow(/only a manager/i);
  });

  it("a manager of business B cannot approve a claim on business A's shift", async () => {
    const shiftId = await seedShift(t.db, t.fx, { status: "open", assignedTo: t.fx.staffA1 });
    const claimId = randomUUID();
    await t.db.query(
      "insert into public.shift_claim (id, business_id, shift_id, claimant_user_id) values ($1, $2, $3, $4)",
      [claimId, t.fx.businessA, shiftId, t.fx.staffA2],
    );
    await expect(
      t.asUser(t.fx.authManagerB, (db) =>
        db.query("select * from public.approve_claim($1, $2)", [shiftId, claimId]),
      ),
    ).rejects.toThrow(/shift not found/i);
  });
});

describe("claim_shift — transactional and idempotent (§5)", () => {
  it("a double-tap creates ONE claim, not two", async () => {
    const shiftId = await seedShift(t.db, t.fx, { status: "open", assignedTo: t.fx.staffA1 });

    await t.asUser(t.fx.authStaffA2, (db) =>
      db.query("select * from public.claim_shift($1)", [shiftId]),
    );
    await t.asUser(t.fx.authStaffA2, (db) =>
      db.query("select * from public.claim_shift($1)", [shiftId]),
    );

    const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("select id from public.shift_claim where shift_id = $1", [shiftId]),
    );
    expect(rows).toHaveLength(1);
  });

  it("the first claim moves the shift to 'claimed_pending'", async () => {
    const shiftId = await seedShift(t.db, t.fx, { status: "open", assignedTo: t.fx.staffA1 });
    await t.asUser(t.fx.authStaffA2, (db) =>
      db.query("select * from public.claim_shift($1)", [shiftId]),
    );
    const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ status: string }>("select status from public.shift where id = $1", [shiftId]),
    );
    expect(rows[0].status).toBe("claimed_pending");
  });

  it("claiming a shift that is already filled gives a clear message", async () => {
    const shiftId = await seedShift(t.db, t.fx, { status: "assigned", assignedTo: t.fx.staffA1 });
    await expect(
      t.asUser(t.fx.authStaffA2, (db) =>
        db.query("select * from public.claim_shift($1)", [shiftId]),
      ),
    ).rejects.toThrow(/already been filled/i);
  });
});

describe("request_drop — own shift only (§3.1)", () => {
  it("staff can drop their own assigned shift; the dropper stays the owner", async () => {
    const shiftId = await seedShift(t.db, t.fx, { status: "assigned", assignedTo: t.fx.staffA1 });
    await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("select * from public.request_drop($1, $2)", [shiftId, "Family commitment"]),
    );
    const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{
        status: string;
        assigned_user_id: string;
        drop_requested_by: string;
        drop_reason: string;
        original_user_id: string;
      }>(
        `select status, assigned_user_id, drop_requested_by, drop_reason, original_user_id
           from public.shift where id = $1`,
        [shiftId],
      ),
    );
    expect(rows[0].status).toBe("drop_requested");
    // Never silently ownerless: the dropper remains responsible (M8 §7).
    expect(rows[0].assigned_user_id).toBe(t.fx.staffA1);
    expect(rows[0].drop_requested_by).toBe(t.fx.staffA1);
    expect(rows[0].drop_reason).toBe("Family commitment");
    expect(rows[0].original_user_id).toBe(t.fx.staffA1);
  });

  it("staff cannot drop somebody else's shift", async () => {
    const shiftId = await seedShift(t.db, t.fx, { status: "assigned", assignedTo: t.fx.staffA1 });
    await expect(
      t.asUser(t.fx.authStaffA2, (db) =>
        db.query("select * from public.request_drop($1, $2)", [shiftId, "not mine"]),
      ),
    ).rejects.toThrow(/only drop your own shift/i);
  });

  it("a second drop request on the same shift is refused", async () => {
    const shiftId = await seedShift(t.db, t.fx, { status: "assigned", assignedTo: t.fx.staffA1 });
    await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("select * from public.request_drop($1, $2)", [shiftId, null]),
    );
    await expect(
      t.asUser(t.fx.authStaffA1, (db) =>
        db.query("select * from public.request_drop($1, $2)", [shiftId, null]),
      ),
    ).rejects.toThrow(/already has a cover request/i);
  });
});

describe("swap tables — tenant and own-row isolation (§6)", () => {
  it("staff read only their OWN claims", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA2, (db) =>
      db.query<{ claimant_user_id: string }>(
        "select claimant_user_id from public.shift_claim",
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.claimant_user_id === t.fx.staffA2)).toBe(true);
  });

  it("manager B cannot read business A's claims or swap events", async () => {
    const claims = await t.asUser(t.fx.authManagerB, (db) =>
      db.query("select id from public.shift_claim"),
    );
    const events = await t.asUser(t.fx.authManagerB, (db) =>
      db.query("select id from public.shift_swap_event"),
    );
    expect(claims.rows).toHaveLength(0);
    expect(events.rows).toHaveLength(0);
  });

  it("the swap audit log cannot be written or edited by a client (M11 §8)", async () => {
    await expect(
      t.asUser(t.fx.authManagerA, (db) =>
        db.query(
          `insert into public.shift_swap_event (business_id, shift_id, to_status, action)
           values ($1, $2, 'assigned', 'forged')`,
          [t.fx.businessA, t.fx.openShiftA],
        ),
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);
  });
});
