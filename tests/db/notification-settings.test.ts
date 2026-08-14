import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, type TestDb } from "./harness";

/**
 * Per-business notification settings (migration 0014, M9 §4/§5).
 * Manager-only, tenant-scoped, and seeded with the documented defaults so no
 * code has to cope with a missing row.
 */

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(async () => {
  await t?.close();
});

describe("defaults", () => {
  it("every existing business gets a row with the M9 defaults", async () => {
    const { rows } = await t.db.query<{
      sms_enabled: boolean;
      quiet_hours_start: string;
      quiet_hours_end: string;
      daily_sms_cap: number;
      monthly_sms_budget: number | null;
    }>("select * from public.notification_setting where business_id = $1", [t.fx.businessA]);

    expect(rows).toHaveLength(1);
    expect(rows[0].sms_enabled).toBe(true);
    expect(rows[0].quiet_hours_start).toMatch(/^22:00/);
    expect(rows[0].quiet_hours_end).toMatch(/^07:00/);
    expect(rows[0].daily_sms_cap).toBe(5);
    expect(rows[0].monthly_sms_budget).toBeNull(); // uncapped until set
  });

  it("both seeded businesses have one", async () => {
    const { rows } = await t.db.query<{ n: number }>(
      "select count(*)::int as n from public.notification_setting",
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(2);
  });
});

describe("access control (M11 §4.1 — settings are manager-only)", () => {
  it("a manager reads and updates their own settings", async () => {
    const res = await t.asUser(t.fx.authManagerA, (db) =>
      db.query(
        "update public.notification_setting set daily_sms_cap = 3 where business_id = $1",
        [t.fx.businessA],
      ),
    );
    expect(res.affectedRows ?? 0).toBe(1);
  });

  it("staff cannot read them", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("select business_id from public.notification_setting"),
    );
    expect(rows).toHaveLength(0);
  });

  it("a manager cannot touch another business's settings", async () => {
    const res = await t.asUser(t.fx.authManagerA, (db) =>
      db.query(
        "update public.notification_setting set sms_enabled = false where business_id = $1",
        [t.fx.businessB],
      ),
    );
    expect(res.affectedRows ?? 0).toBe(0);
  });
});

describe("validation", () => {
  it("refuses a negative daily cap", async () => {
    await expect(
      t.db.query(
        "update public.notification_setting set daily_sms_cap = -1 where business_id = $1",
        [t.fx.businessA],
      ),
    ).rejects.toThrow();
  });

  it("allows a null budget (uncapped) but not a negative one", async () => {
    await t.db.query(
      "update public.notification_setting set monthly_sms_budget = null where business_id = $1",
      [t.fx.businessA],
    );
    await expect(
      t.db.query(
        "update public.notification_setting set monthly_sms_budget = -5 where business_id = $1",
        [t.fx.businessA],
      ),
    ).rejects.toThrow();
  });
});

describe("sms_used_this_month", () => {
  it("counts only SMS that actually went out", async () => {
    // in-app, and a suppressed SMS, are not billable.
    await t.db.query(
      `insert into public.notification (business_id, user_id, event_type, channel, status, sent_at)
       values
         ($1, $2, 'E1', 'sms',   'sent',      now()),
         ($1, $2, 'E1', 'sms',   'suppressed', now()),
         ($1, $2, 'E1', 'inapp', 'sent',      now())`,
      [t.fx.businessA, t.fx.staffA1],
    );
    const { rows } = await t.db.query<{ n: number }>(
      "select public.sms_used_this_month($1) as n",
      [t.fx.businessA],
    );
    expect(rows[0].n).toBe(1);
  });

  it("does not count another business's messages", async () => {
    const { rows } = await t.db.query<{ n: number }>(
      "select public.sms_used_this_month($1) as n",
      [t.fx.businessB],
    );
    expect(rows[0].n).toBe(0);
  });
});
