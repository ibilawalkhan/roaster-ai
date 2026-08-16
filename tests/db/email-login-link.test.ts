import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { setupTestDb, type TestDb } from "./harness";

/**
 * Manager email sign-in linking (migration 0015, M11 §3.1/§3.2).
 * Phone remains primary; email is the manager fallback. Crucially there is
 * still no self-signup — an unknown login gains nothing.
 */

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(async () => {
  await t?.close();
});

async function authUser(over: { phone?: string; email?: string }) {
  const id = randomUUID();
  await t.db.query("insert into auth.users (id, phone, email) values ($1, $2, $3)", [
    id,
    over.phone ?? null,
    over.email ?? null,
  ]);
  return id;
}

async function unlinkedMember(over: { phone?: string; email?: string; active?: boolean }) {
  const id = randomUUID();
  await t.db.query(
    `insert into public.app_user (id, business_id, name, phone, email, is_manager, active)
     values ($1, $2, 'Pat Manager', $3, $4, true, $5)`,
    [id, t.fx.businessA, over.phone ?? null, over.email ?? null, over.active ?? true],
  );
  return id;
}

describe("email linking", () => {
  it("links a manager signing in by email", async () => {
    const memberId = await unlinkedMember({ email: "owner@altazah.com.au" });
    const auth = await authUser({ email: "owner@altazah.com.au" });

    const { rows } = await t.asUser(auth, (db) =>
      db.query<{ id: string; invite_status: string }>(
        "select * from public.link_current_user()",
      ),
    );
    expect(rows[0].id).toBe(memberId);
    expect(rows[0].invite_status).toBe("active");
  });

  it("matches email case-insensitively", async () => {
    await unlinkedMember({ email: "mixed.case@altazah.com.au" });
    const auth = await authUser({ email: "Mixed.Case@AlTazah.com.AU" });
    const { rows } = await t.asUser(auth, (db) =>
      db.query("select * from public.link_current_user()"),
    );
    expect(rows).toHaveLength(1);
  });

  it("still refuses an unknown email — no self-signup (§3.2)", async () => {
    const auth = await authUser({ email: "stranger@example.com" });
    await expect(
      t.asUser(auth, (db) => db.query("select * from public.link_current_user()")),
    ).rejects.toThrow(/isn't connected to a Rosterly account/i);
  });

  it("refuses a deactivated person", async () => {
    await unlinkedMember({ email: "gone@altazah.com.au", active: false });
    const auth = await authUser({ email: "gone@altazah.com.au" });
    await expect(
      t.asUser(auth, (db) => db.query("select * from public.link_current_user()")),
    ).rejects.toThrow(/isn't connected to a Rosterly account/i);
  });
});

describe("phone still takes precedence", () => {
  it("links by phone when the auth user has both", async () => {
    const byPhone = await unlinkedMember({ phone: "61455000111" });
    await unlinkedMember({ email: "other@altazah.com.au" });
    const auth = await authUser({ phone: "61455000111", email: "other@altazah.com.au" });

    const { rows } = await t.asUser(auth, (db) =>
      db.query<{ id: string }>("select * from public.link_current_user()"),
    );
    expect(rows[0].id).toBe(byPhone);
  });

  it("falls back to email when the phone matches nothing", async () => {
    const byEmail = await unlinkedMember({ email: "fallback@altazah.com.au" });
    const auth = await authUser({ phone: "61499888777", email: "fallback@altazah.com.au" });

    const { rows } = await t.asUser(auth, (db) =>
      db.query<{ id: string }>("select * from public.link_current_user()"),
    );
    expect(rows[0].id).toBe(byEmail);
  });
});

describe("email uniqueness", () => {
  it("refuses two people in one business sharing an email", async () => {
    await unlinkedMember({ email: "dupe@altazah.com.au" });
    await expect(unlinkedMember({ email: "dupe@altazah.com.au" })).rejects.toThrow();
  });

  it("allows many people with no email at all", async () => {
    await expect(unlinkedMember({ phone: "61400111222" })).resolves.toBeTruthy();
    await expect(unlinkedMember({ phone: "61400111333" })).resolves.toBeTruthy();
  });
});
