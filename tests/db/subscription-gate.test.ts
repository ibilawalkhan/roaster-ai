import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, type TestDb } from "./harness";

/**
 * Payment enforcement (migration 0013, REQUIREMENTS §1.1, M11 §9).
 *
 * A suspended business can still SEE everything — data is untouched and staff
 * keep their roster — but cannot change anything until the account is
 * reinstated. Trusted server code is never locked out.
 */

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(async () => {
  await t?.close();
});

/** Owner-side helper: set business A's billing state. */
async function setStatus(status: string) {
  await t.db.query("update public.business set subscription_status = $2::public.subscription_status where id = $1", [
    t.fx.businessA,
    status,
  ]);
}

describe("an active business is unaffected", () => {
  it("a manager can write normally", async () => {
    await setStatus("active");
    const res = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("update public.app_user set email = 'ok@altazah.com.au' where id = $1", [
        t.fx.staffA1,
      ]),
    );
    expect(res.affectedRows ?? 0).toBe(1);
  });
});

describe("a suspended business is read-only", () => {
  it("blocks a manager write with a message they can act on", async () => {
    await setStatus("suspended");
    await expect(
      t.asUser(t.fx.authManagerA, (db) =>
        db.query("update public.app_user set email = 'nope@altazah.com.au' where id = $1", [
          t.fx.staffA1,
        ]),
      ),
    ).rejects.toThrow(/account is suspended/i);
  });

  it("blocks inserts too, not just updates", async () => {
    await expect(
      t.asUser(t.fx.authManagerA, (db) =>
        db.query(
          "insert into public.location (business_id, name) values ($1, 'Sneaky Site')",
          [t.fx.businessA],
        ),
      ),
    ).rejects.toThrow(/account is suspended/i);
  });

  it("blocks staff writes as well", async () => {
    await expect(
      t.asUser(t.fx.authStaffA1, (db) =>
        db.query("update public.app_user set email = 'x@y.com' where id = $1", [t.fx.staffA1]),
      ),
    ).rejects.toThrow(/account is suspended/i);
  });

  it("STILL ALLOWS READS — the team keeps its roster (M11 §9)", async () => {
    const shifts = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("select id from public.shift"),
    );
    const team = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("select id from public.app_user"),
    );
    expect(shifts.rows.length).toBeGreaterThan(0);
    expect(team.rows.length).toBeGreaterThan(0);
  });

  it("does not affect a DIFFERENT business", async () => {
    // Guildford has paid; Al Tazah's suspension is not their problem.
    const res = await t.asUser(t.fx.authManagerB, (db) =>
      db.query("update public.app_user set email = 'fine@guildford.com.au' where id = $1", [
        t.fx.managerB,
      ]),
    );
    expect(res.affectedRows ?? 0).toBe(1);
  });

  it("trusted server code can still write — reinstatement must never be locked out", async () => {
    // The DB owner stands in for service_role here (both bypass the guard).
    const res = await t.db.query(
      "update public.app_user set email = 'admin-fix@altazah.com.au' where id = $1",
      [t.fx.staffA1],
    );
    expect(res.affectedRows ?? 0).toBe(1);
  });
});

describe("past_due is a conversation, not a shutdown", () => {
  it("still allows writes", async () => {
    await setStatus("past_due");
    const res = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("update public.app_user set email = 'still@works.com' where id = $1", [
        t.fx.staffA1,
      ]),
    );
    expect(res.affectedRows ?? 0).toBe(1);
  });

  it("and trial does too", async () => {
    await setStatus("trial");
    const res = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("update public.app_user set email = 'trial@works.com' where id = $1", [
        t.fx.staffA1,
      ]),
    );
    expect(res.affectedRows ?? 0).toBe(1);
  });
});

describe("reinstating restores service immediately", () => {
  it("writes work again once the status changes back", async () => {
    await setStatus("suspended");
    await expect(
      t.asUser(t.fx.authManagerA, (db) =>
        db.query("update public.app_user set email = 'a@b.c' where id = $1", [t.fx.staffA1]),
      ),
    ).rejects.toThrow(/suspended/i);

    await setStatus("active");
    const res = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("update public.app_user set email = 'back@altazah.com.au' where id = $1", [
        t.fx.staffA1,
      ]),
    );
    expect(res.affectedRows ?? 0).toBe(1);
  });
});
