import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { setupTestDb, type TestDb } from "./harness";

/**
 * User↔staff matching on first login (M11 §3.2).
 * link_current_user() claims the unlinked staff record whose phone matches the
 * caller's verified auth phone, sets invite_status='active', is idempotent, and
 * refuses unknown phones — all within one business.
 */

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(async () => {
  await t?.close();
});

async function seedUnlinked(phone: string, businessId: string) {
  const authId = randomUUID();
  const appUserId = randomUUID();
  await t.db.query("insert into auth.users (id, phone) values ($1, $2)", [authId, phone]);
  await t.db.query(
    `insert into public.app_user (id, business_id, name, phone, is_manager)
     values ($1, $2, 'New Hire', $3, false)`,
    [appUserId, businessId, phone],
  );
  return { authId, appUserId };
}

describe("link_current_user()", () => {
  it("links the caller and activates the invite", async () => {
    const { authId, appUserId } = await seedUnlinked("61411111111", t.fx.businessA);

    const linked = await t.asUser(authId, (db) =>
      db.query<{ id: string; auth_user_id: string; invite_status: string }>(
        "select * from public.link_current_user()",
      ),
    );

    expect(linked.rows[0].id).toBe(appUserId);
    expect(linked.rows[0].auth_user_id).toBe(authId);
    expect(linked.rows[0].invite_status).toBe("active");
  });

  it("is idempotent — a second call returns the same record", async () => {
    const { authId, appUserId } = await seedUnlinked("61422222222", t.fx.businessA);
    await t.asUser(authId, (db) => db.query("select * from public.link_current_user()"));
    const second = await t.asUser(authId, (db) =>
      db.query<{ id: string }>("select * from public.link_current_user()"),
    );
    expect(second.rows[0].id).toBe(appUserId);
  });

  it("refuses a phone with no staff record (§6 #15)", async () => {
    const orphan = randomUUID();
    await t.db.query("insert into auth.users (id, phone) values ($1, $2)", [orphan, "61499999999"]);
    await expect(
      t.asUser(orphan, (db) => db.query("select * from public.link_current_user()")),
    ).rejects.toThrow(/isn't connected to a Rosterly account/i);
  });

  it("links to the caller's own business, never another", async () => {
    const { authId } = await seedUnlinked("61433333333", t.fx.businessA);
    const linked = await t.asUser(authId, (db) =>
      db.query<{ business_id: string }>("select * from public.link_current_user()"),
    );
    expect(linked.rows[0].business_id).toBe(t.fx.businessA);
  });
});
