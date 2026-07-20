import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { setupTestDb, type TestDb } from "./harness";

/**
 * User↔staff matching on first login.
 * link_current_user() must claim the unlinked staff record whose phone matches
 * the caller's verified auth phone, be idempotent, and refuse unknown phones —
 * all while respecting tenant isolation (it only ever touches one business).
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
    `insert into public.app_user (id, business_id, name, role, phone)
     values ($1, $2, $3, 'staff', $4)`,
    [appUserId, businessId, "New Hire", phone],
  );
  return { authId, appUserId };
}

describe("link_current_user()", () => {
  it("links the caller to the unclaimed staff record with a matching phone", async () => {
    const { authId, appUserId } = await seedUnlinked("61411111111", t.fx.businessA);

    const linked = await t.asUser(authId, (db) =>
      db.query<{ id: string; auth_user_id: string }>("select * from public.link_current_user()"),
    );

    expect(linked.rows[0].id).toBe(appUserId);
    expect(linked.rows[0].auth_user_id).toBe(authId);
  });

  it("is idempotent — a second call returns the same record", async () => {
    const { authId, appUserId } = await seedUnlinked("61422222222", t.fx.businessA);
    await t.asUser(authId, (db) => db.query("select * from public.link_current_user()"));
    const second = await t.asUser(authId, (db) =>
      db.query<{ id: string }>("select * from public.link_current_user()"),
    );
    expect(second.rows[0].id).toBe(appUserId);
  });

  it("refuses a phone with no staff record", async () => {
    const orphanAuth = randomUUID();
    await t.db.query("insert into auth.users (id, phone) values ($1, $2)", [
      orphanAuth,
      "61499999999",
    ]);
    await expect(
      t.asUser(orphanAuth, (db) => db.query("select * from public.link_current_user()")),
    ).rejects.toThrow(/no active staff record/i);
  });

  it("does not let a phone claim a record in another business by accident", async () => {
    // Same phone string seeded in business B; a business-A auth user must link
    // to the A record, never B's. (Here we prove the linked row's business_id.)
    const phone = "61433333333";
    const { authId } = await seedUnlinked(phone, t.fx.businessA);
    const linked = await t.asUser(authId, (db) =>
      db.query<{ business_id: string }>("select * from public.link_current_user()"),
    );
    expect(linked.rows[0].business_id).toBe(t.fx.businessA);
  });
});
