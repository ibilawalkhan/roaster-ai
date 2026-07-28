import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, type TestDb } from "./harness";

/**
 * Notification isolation suite (Module 9 §7 / Module 11 §5.1, §6).
 * Every user reads ONLY their own notifications — never a colleague's, never
 * another tenant's. Rows are created by trusted server code (service_role), so
 * no client can fabricate a notification.
 */

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(async () => {
  await t?.close();
});

describe("a user reads only their own notifications", () => {
  it("staff A1 sees exactly their own row", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query<{ id: string; user_id: string }>("select id, user_id from public.notification"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(t.fx.notifStaffA1);
    expect(rows[0].user_id).toBe(t.fx.staffA1);
  });

  it("staff A1 cannot read colleague A2's notification", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("select id from public.notification where id = $1", [t.fx.notifStaffA2]),
    );
    expect(rows).toHaveLength(0);
  });

  it("a MANAGER does not see their staff's notifications either (own rows only)", async () => {
    const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("select id from public.notification"),
    );
    expect(rows).toHaveLength(0); // managerA has no notifications of their own
  });

  it("staff A1 can mark their own notification read", async () => {
    const res = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("update public.notification set read_at = now() where id = $1", [
        t.fx.notifStaffA1,
      ]),
    );
    expect(res.affectedRows ?? 0).toBe(1);
  });

  it("staff A1 cannot mark a colleague's notification read", async () => {
    const res = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("update public.notification set read_at = now() where id = $1", [
        t.fx.notifStaffA2,
      ]),
    );
    expect(res.affectedRows ?? 0).toBe(0);
  });
});

describe("cross-tenant isolation (§6 #2)", () => {
  it("manager B cannot read business A's notifications", async () => {
    const { rows } = await t.asUser(t.fx.authManagerB, (db) =>
      db.query<{ id: string }>("select id from public.notification"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(t.fx.notifManagerB); // only their own
  });

  it("staff A1 cannot read business B's notification", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("select id from public.notification where id = $1", [t.fx.notifManagerB]),
    );
    expect(rows).toHaveLength(0);
  });

  it("a cross-tenant UPDATE affects zero rows (§6 #3)", async () => {
    const res = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("update public.notification set status = 'failed' where business_id = $1", [
        t.fx.businessB,
      ]),
    );
    expect(res.affectedRows ?? 0).toBe(0);
  });
});

describe("notifications cannot be fabricated by a client (§3 outbox)", () => {
  it("a user cannot insert a notification for themselves", async () => {
    await expect(
      t.asUser(t.fx.authStaffA1, (db) =>
        db.query(
          `insert into public.notification (business_id, user_id, event_type, channel)
           values ($1, $2, 'E10', 'sms')`,
          [t.fx.businessA, t.fx.staffA1],
        ),
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);
  });

  it("a user cannot insert a notification for somebody else", async () => {
    await expect(
      t.asUser(t.fx.authStaffA1, (db) =>
        db.query(
          `insert into public.notification (business_id, user_id, event_type, channel)
           values ($1, $2, 'E10', 'sms')`,
          [t.fx.businessA, t.fx.staffA2],
        ),
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);
  });
});

describe("notification_batch is delivery plumbing — manager/service only (§4)", () => {
  it("staff cannot read notification batches", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("select id from public.notification_batch"),
    );
    expect(rows).toHaveLength(0);
  });

  it("a manager cannot create a batch scoped to another business", async () => {
    await expect(
      t.asUser(t.fx.authManagerA, (db) =>
        db.query(
          `insert into public.notification_batch (business_id, key, window_ends_at)
           values ($1, 'claims:shift_x', now() + interval '10 minutes')`,
          [t.fx.businessB],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});
