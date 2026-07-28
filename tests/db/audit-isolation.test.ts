import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, type TestDb } from "./harness";

/**
 * Roster audit isolation suite (Module 6 §5 / Module 11 §4.1, §8).
 * The change log and warnings are MANAGER-ONLY ("Change log / audit: Manager
 * read, Staff none"), business-scoped, and the change log is append-only —
 * nobody can edit history.
 */

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(async () => {
  await t?.close();
});

describe("manager reads their own business's audit trail", () => {
  it("manager A sees their own change log entry and no other tenant's", async () => {
    const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ id: string; business_id: string }>(
        "select id, business_id from public.roster_change_log",
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(t.fx.changeLogA);
    expect(rows[0].business_id).toBe(t.fx.businessA);
  });

  it("manager A sees their own warning and no other tenant's", async () => {
    const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ id: string; rule: string }>("select id, rule from public.roster_warning"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(t.fx.warningA);
    expect(rows[0].rule).toBe("senior_coverage");
  });

  it("manager A can acknowledge and resolve their own warning (M6 §3.2)", async () => {
    const res = await t.asUser(t.fx.authManagerA, (db) =>
      db.query(
        "update public.roster_warning set acknowledged_by = $1, acknowledged_at = now(), resolved = true where id = $2",
        [t.fx.managerA, t.fx.warningA],
      ),
    );
    expect(res.affectedRows ?? 0).toBe(1);
  });
});

describe("cross-tenant isolation (§6 #2)", () => {
  it("manager A cannot read business B's change log or warnings", async () => {
    const log = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("select id from public.roster_change_log where id = $1", [t.fx.changeLogB]),
    );
    const warn = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("select id from public.roster_warning where id = $1", [t.fx.warningB]),
    );
    expect(log.rows).toHaveLength(0);
    expect(warn.rows).toHaveLength(0);
  });

  it("manager A cannot write an audit entry into business B", async () => {
    await expect(
      t.asUser(t.fx.authManagerA, (db) =>
        db.query(
          `insert into public.roster_change_log (business_id, roster_id, action)
           values ($1, $2, 'publish')`,
          [t.fx.businessB, t.fx.rosterB],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("a cross-tenant UPDATE of B's warning affects zero rows (§6 #3)", async () => {
    const res = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("update public.roster_warning set resolved = true where business_id = $1", [
        t.fx.businessB,
      ]),
    );
    expect(res.affectedRows ?? 0).toBe(0);
  });
});

describe("staff have no audit access at all (M11 §4.1)", () => {
  it("staff cannot read the change log", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("select id from public.roster_change_log"),
    );
    expect(rows).toHaveLength(0);
  });

  it("staff cannot read roster warnings", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("select id from public.roster_warning"),
    );
    expect(rows).toHaveLength(0);
  });

  it("staff cannot write a change log entry", async () => {
    await expect(
      t.asUser(t.fx.authStaffA1, (db) =>
        db.query(
          `insert into public.roster_change_log (business_id, roster_id, action)
           values ($1, $2, 'remove')`,
          [t.fx.businessA, t.fx.rosterPubA],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe("the change log is append-only — nobody can edit history (M11 §8)", () => {
  it("a manager cannot UPDATE their own change log entry", async () => {
    await expect(
      t.asUser(t.fx.authManagerA, (db) =>
        db.query("update public.roster_change_log set action = 'assign' where id = $1", [
          t.fx.changeLogA,
        ]),
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);
    // History is intact.
    const check = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ action: string }>("select action from public.roster_change_log where id = $1", [
        t.fx.changeLogA,
      ]),
    );
    expect(check.rows[0].action).toBe("publish");
  });

  it("a manager cannot DELETE a change log entry", async () => {
    await expect(
      t.asUser(t.fx.authManagerA, (db) =>
        db.query("delete from public.roster_change_log where id = $1", [t.fx.changeLogA]),
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);
  });

  it("a manager CAN append a new entry (corrections are new rows)", async () => {
    const res = await t.asUser(t.fx.authManagerA, (db) =>
      db.query(
        `insert into public.roster_change_log (business_id, roster_id, action, changed_by_user_id)
         values ($1, $2, 'unpublish', $3) returning id`,
        [t.fx.businessA, t.fx.rosterPubA, t.fx.managerA],
      ),
    );
    expect(res.rows).toHaveLength(1);
  });

  it("the action vocabulary is constrained (a typo cannot enter the audit trail)", async () => {
    await expect(
      t.asUser(t.fx.authManagerA, (db) =>
        db.query(
          `insert into public.roster_change_log (business_id, roster_id, action)
           values ($1, $2, 'assinged')`,
          [t.fx.businessA, t.fx.rosterPubA],
        ),
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});
