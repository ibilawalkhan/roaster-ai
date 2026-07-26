import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, type TestDb } from "./harness";

/**
 * Week-template isolation suite (Module 4 §8 / Module 11 §4.1, §6 #2).
 * Templates are MANAGER-ONLY and business-scoped: staff have no access at all.
 * These assertions run against the REAL RLS policies in supabase/migrations.
 */

let t: TestDb;

beforeAll(async () => {
  t = await setupTestDb();
});

afterAll(async () => {
  await t?.close();
});

describe("manager reads own templates and slots", () => {
  it("manager A sees only their own template", async () => {
    const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ id: string; business_id: string }>(
        "select id, business_id from public.week_template",
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(t.fx.templateA);
    expect(rows[0].business_id).toBe(t.fx.businessA);
  });

  it("manager A sees only their own slot", async () => {
    const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ id: string; business_id: string }>(
        "select id, business_id from public.template_slot",
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(t.fx.slotA);
    expect(rows[0].business_id).toBe(t.fx.businessA);
  });
});

describe("cross-tenant — manager A cannot reach business B (§6 #2)", () => {
  it("manager A cannot read B's template", async () => {
    const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("select id from public.week_template where id = $1", [t.fx.templateB]),
    );
    expect(rows).toHaveLength(0);
  });

  it("manager A cannot read B's slot", async () => {
    const { rows } = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("select id from public.template_slot where id = $1", [t.fx.slotB]),
    );
    expect(rows).toHaveLength(0);
  });

  it("a cross-tenant UPDATE of B's template affects zero rows (§6 #3)", async () => {
    const res = await t.asUser(t.fx.authManagerA, (db) =>
      db.query("update public.week_template set name = 'HACKED' where business_id = $1", [
        t.fx.businessB,
      ]),
    );
    expect(res.affectedRows ?? 0).toBe(0);
    const check = await t.asUser(t.fx.authManagerB, (db) =>
      db.query<{ name: string }>("select name from public.week_template where id = $1", [
        t.fx.templateB,
      ]),
    );
    expect(check.rows[0].name).toBe("Normal week");
  });
});

describe("staff have no template access at all (manager-only, M11 §4.1)", () => {
  it("staff A cannot read any template", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("select id from public.week_template"),
    );
    expect(rows).toHaveLength(0);
  });

  it("staff A cannot read any slot", async () => {
    const { rows } = await t.asUser(t.fx.authStaffA1, (db) =>
      db.query("select id from public.template_slot"),
    );
    expect(rows).toHaveLength(0);
  });

  it("staff A cannot create a template (RLS WITH CHECK blocks it)", async () => {
    await expect(
      t.asUser(t.fx.authStaffA1, (db) =>
        db.query(
          "insert into public.week_template (business_id, name) values ($1, 'Sneaky')",
          [t.fx.businessA],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
    const count = await t.asUser(t.fx.authManagerA, (db) =>
      db.query<{ n: number }>("select count(*)::int as n from public.week_template"),
    );
    expect(count.rows[0].n).toBe(1); // still only manager A's seeded template
  });
});

describe("manager positive controls", () => {
  it("manager A can insert a slot into their own template", async () => {
    const res = await t.asUser(t.fx.authManagerA, (db) =>
      db.query(
        `insert into public.template_slot
           (business_id, template_id, location_id, day_of_week, role_id, start_time, end_time, count)
         values ($1, $2, $3, 2, $4, '09:00', '17:00', 1) returning id`,
        [t.fx.businessA, t.fx.templateA, t.fx.locationA, t.fx.roleFohA],
      ),
    );
    expect(res.rows).toHaveLength(1);
  });
});
