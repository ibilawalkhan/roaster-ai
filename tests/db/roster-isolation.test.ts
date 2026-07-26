import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, type TestDb } from "./harness";

/**
 * Roster / assignment isolation suite (Module 5 §9 / Module 11 §4.1, §5.1, §6).
 * The database is the security boundary. Key invariant (M11 §5.1, §6 #9):
 * staff read their OWN shift only when its roster is PUBLISHED — a draft roster
 * is invisible at the database level, not merely hidden in the UI.
 */

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(async () => {
  await t?.close();
});

describe("manager reads own rosters, positions, shifts, solve runs", () => {
  it("manager A sees both of their rosters and none of B's", async () => {
    const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ id: string; business_id: string }>("select id, business_id from public.roster"),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.business_id === t.fx.businessA)).toBe(true);
  });

  it("manager A sees their own position, shifts and solve run", async () => {
    const pos = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("select id from public.roster_position"),
    );
    const shifts = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("select id from public.shift"),
    );
    const runs = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("select id from public.solve_run"),
    );
    expect(pos.rows).toHaveLength(1); // positionA only
    expect(shifts.rows).toHaveLength(2); // shiftPubA + shiftDraftA
    expect(runs.rows).toHaveLength(1); // solveRunA
  });
});

describe("cross-tenant — manager A cannot reach business B (§6 #2)", () => {
  it("manager A cannot read B's roster, position or shift", async () => {
    const roster = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("select id from public.roster where id = $1", [t.fx.rosterB]),
    );
    const pos = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("select id from public.roster_position where id = $1", [t.fx.positionB]),
    );
    const shift = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("select id from public.shift where id = $1", [t.fx.shiftB]),
    );
    expect(roster.rows).toHaveLength(0);
    expect(pos.rows).toHaveLength(0);
    expect(shift.rows).toHaveLength(0);
  });

  it("a cross-tenant UPDATE of B's roster affects zero rows (§6 #3)", async () => {
    const res = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("update public.roster set status = 'draft' where business_id = $1", [t.fx.businessB]),
    );
    expect(res.affectedRows ?? 0).toBe(0);
    const check = await t.asUser(t.fx.authManagerB, (db) =>
      db.query<{ status: string }>("select status from public.roster where id = $1", [t.fx.rosterB]),
    );
    expect(check.rows[0].status).toBe("published");
  });

  it("manager A cannot INSERT a shift into business B (RLS WITH CHECK)", async () => {
    await expect(
      t.asUser(t.fx.authManagerA, (db) =>
        db.query(
          `insert into public.shift
             (business_id, roster_id, location_id, date, start_at, end_at, role_id)
           values ($1, $2, $3, '2026-08-03', '2026-08-03 06:00+00', '2026-08-03 13:00+00', $4)`,
          [t.fx.businessB, t.fx.rosterB, t.fx.locationB, t.fx.roleKitchenB],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe("staff shift visibility — published vs draft (§6 #9, M11 §5.1)", () => {
  it("staff A1 reads their OWN shift in a PUBLISHED roster", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query<{ id: string }>("select id from public.shift"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(t.fx.shiftPubA); // only the published one
  });

  it("staff A1 CANNOT read their own shift in a DRAFT roster", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("select id from public.shift where id = $1", [t.fx.shiftDraftA]),
    );
    expect(rows).toHaveLength(0);
  });

  it("staff A1 sees only published rosters, not drafts", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query<{ id: string; status: string }>("select id, status from public.roster"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(t.fx.rosterPubA);
    expect(rows[0].status).toBe("published");
  });

  it("staff A2 (not assigned) sees no shifts at all", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA2, (db) =>
      db.query("select id from public.shift"),
    );
    expect(rows).toHaveLength(0);
  });
});

describe("staff have no planning-surface access (manager-only)", () => {
  it("staff A cannot read roster_position (demand is planning)", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("select id from public.roster_position"),
    );
    expect(rows).toHaveLength(0);
  });

  it("staff A cannot read solve_run", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("select id from public.solve_run"),
    );
    expect(rows).toHaveLength(0);
  });

  it("staff A cannot write a shift (manager-only until M8 RPCs)", async () => {
    // No write policy grants staff USING on shift, so the row is filtered out of
    // the UPDATE's target set: zero rows affected (not a WITH CHECK error).
    const res = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("update public.shift set status = 'open' where id = $1", [t.fx.shiftPubA]),
    );
    expect(res.affectedRows ?? 0).toBe(0);
    const check = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ status: string }>("select status from public.shift where id = $1", [t.fx.shiftPubA]),
    );
    expect(check.rows[0].status).toBe("assigned");
  });
});
