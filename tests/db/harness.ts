import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "..", "supabase", "migrations");

/** Stable IDs for the two seeded tenants, referenced by the tests. */
export interface Fixtures {
  businessA: string;
  businessB: string;
  locationA: string;
  locationB: string;
  roleKitchenA: string;
  roleFohA: string;
  roleMgrA: string;
  roleKitchenB: string;
  // auth.users ids (what a JWT `sub` would carry)
  authManagerA: string;
  authStaffA1: string;
  authStaffA2: string;
  authManagerB: string;
  // app_user ids
  managerA: string;
  staffA1: string;
  staffA2: string;
  managerB: string;
  // week template + slot ids (M4)
  templateA: string;
  slotA: string;
  templateB: string;
  slotB: string;
  // roster ids (M5) — a published and a draft roster for A, one roster for B
  rosterPubA: string;
  rosterDraftA: string;
  rosterB: string;
  positionA: string;
  positionB: string;
  shiftPubA: string;    // published roster, assigned to staffA1
  shiftDraftA: string;  // draft roster, assigned to staffA1
  shiftB: string;
  solveRunA: string;
}

export interface TestDb {
  db: PGlite;
  fx: Fixtures;
  /** Run `fn` in the security context of the given auth user (RLS applies). */
  asUser: <T>(authUserId: string, fn: (db: PGlite) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
}

function migrationSql(): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(migrationsDir, f), "utf8"));
}

/**
 * Boot an in-process Postgres, provision the Supabase auth surface, apply the
 * real migrations, and seed two isolated tenants (Al Tazah + Guildford).
 */
export async function setupTestDb(): Promise<TestDb> {
  const db = new PGlite();

  // 1. What Supabase provides for free (test-only shim).
  await db.exec(readFileSync(join(here, "auth-shim.sql"), "utf8"));

  // 2. The real, unmodified migrations.
  for (const sql of migrationSql()) {
    await db.exec(sql);
  }

  // 3. Seed as the PGlite owner (bypasses RLS, like a service_role seed).
  const fx: Fixtures = {
    businessA: randomUUID(),
    businessB: randomUUID(),
    locationA: randomUUID(),
    locationB: randomUUID(),
    roleKitchenA: randomUUID(),
    roleFohA: randomUUID(),
    roleMgrA: randomUUID(),
    roleKitchenB: randomUUID(),
    authManagerA: randomUUID(),
    authStaffA1: randomUUID(),
    authStaffA2: randomUUID(),
    authManagerB: randomUUID(),
    managerA: randomUUID(),
    staffA1: randomUUID(),
    staffA2: randomUUID(),
    managerB: randomUUID(),
    templateA: randomUUID(),
    slotA: randomUUID(),
    templateB: randomUUID(),
    slotB: randomUUID(),
    rosterPubA: randomUUID(),
    rosterDraftA: randomUUID(),
    rosterB: randomUUID(),
    positionA: randomUUID(),
    positionB: randomUUID(),
    shiftPubA: randomUUID(),
    shiftDraftA: randomUUID(),
    shiftB: randomUUID(),
    solveRunA: randomUUID(),
  };

  const q = (text: string, params: unknown[]) => db.query(text, params);

  for (const [id, phone] of [
    [fx.authManagerA, "61400000001"],
    [fx.authStaffA1, "61400000002"],
    [fx.authStaffA2, "61400000003"],
    [fx.authManagerB, "61400000004"],
  ] as const) {
    await q("insert into auth.users (id, phone) values ($1, $2)", [id, phone]);
  }

  await q(
    "insert into public.business (id, name) values ($1, $2), ($3, $4)",
    [fx.businessA, "Al Tazah Charcoal Chicken", fx.businessB, "Guildford Restaurant"],
  );

  await q(
    "insert into public.location (id, business_id, name) values ($1, $2, $3), ($4, $5, $6)",
    [fx.locationA, fx.businessA, "Regents Park", fx.locationB, fx.businessB, "Guildford"],
  );

  await q(
    `insert into public.role (id, business_id, name, short_code) values
       ($1, $2, 'Kitchen', 'KIT'),
       ($3, $4, 'Front of House', 'FOH'),
       ($5, $6, 'Manager', 'MGR'),
       ($7, $8, 'Kitchen', 'KIT')`,
    [
      fx.roleKitchenA, fx.businessA,
      fx.roleFohA, fx.businessA,
      fx.roleMgrA, fx.businessA,
      fx.roleKitchenB, fx.businessB,
    ],
  );

  await q(
    "insert into public.scheduling_rule (business_id) values ($1), ($2)",
    [fx.businessA, fx.businessB],
  );

  await q(
    `insert into public.trading_hours (business_id, location_id, day_of_week, opens_at, closes_at)
     values ($1, $2, 1, '10:00', '22:30'), ($3, $4, 1, '10:00', '22:00')`,
    [fx.businessA, fx.locationA, fx.businessB, fx.locationB],
  );

  // app_users — different pay rates so wage-privacy is meaningful.
  const users: [string, string, string, string, boolean, string, number, string, string, string][] = [
    [fx.managerA, fx.businessA, fx.authManagerA, "Khaled Nasser", true,  "senior", 38, "full_time", fx.roleMgrA, fx.locationA],
    [fx.staffA1,  fx.businessA, fx.authStaffA1,  "Sara Haddad",   false, "mid",    30, "part_time", fx.roleKitchenA, fx.locationA],
    [fx.staffA2,  fx.businessA, fx.authStaffA2,  "Ahmed Khan",    false, "mid",    27, "casual",    fx.roleFohA, fx.locationA],
    [fx.managerB, fx.businessB, fx.authManagerB, "Guildford Mgr", true,  "senior", 40, "full_time", fx.roleKitchenB, fx.locationB],
  ];
  for (const [id, biz, auth, name, mgr, level, rate, emp, roleId, locId] of users) {
    await q(
      `insert into public.app_user
         (id, business_id, auth_user_id, name, is_manager, level, pay_rate,
          employment_type, primary_role_id, home_location_id)
       values ($1,$2,$3,$4,$5,$6::public.user_level,$7,$8::public.employment_type,$9,$10)`,
      [id, biz, auth, name, mgr, level, rate, emp, roleId, locId],
    );
    await q(
      "insert into public.user_role (business_id, user_id, role_id) values ($1, $2, $3)",
      [biz, id, roleId],
    );
  }

  // Availability (M3): patterns for A1 (limited), A2 (day off), B manager; an
  // exception for A1 — so isolation tests have real cross-user/tenant rows.
  await q(
    `insert into public.availability_pattern
       (business_id, user_id, day_of_week, is_available, from_time, to_time)
     values
       ($1, $2, 1, true,  '16:00', '23:00'),
       ($3, $4, 1, false, null, null),
       ($5, $6, 1, true,  null, null)`,
    [fx.businessA, fx.staffA1, fx.businessA, fx.staffA2, fx.businessB, fx.managerB],
  );
  await q(
    `insert into public.availability_exception (business_id, user_id, date, is_available, source)
     values ($1, $2, '2026-08-15', false, 'staff')`,
    [fx.businessA, fx.staffA1],
  );

  // Week templates (M4): one default template + a slot per business, so the
  // template-isolation test has real own-tenant and cross-tenant rows.
  await q(
    "insert into public.week_template (id, business_id, name) values ($1, $2, 'Normal week'), ($3, $4, 'Normal week')",
    [fx.templateA, fx.businessA, fx.templateB, fx.businessB],
  );
  await q(
    `insert into public.template_slot
       (id, business_id, template_id, location_id, day_of_week, role_id, start_time, end_time, count)
     values
       ($1, $2, $3, $4, 1, $5, '16:00', '23:00', 2),
       ($6, $7, $8, $9, 1, $10, '10:00', '18:00', 1)`,
    [
      fx.slotA, fx.businessA, fx.templateA, fx.locationA, fx.roleKitchenA,
      fx.slotB, fx.businessB, fx.templateB, fx.locationB, fx.roleKitchenB,
    ],
  );

  // Rosters (M5): A has a PUBLISHED and a DRAFT roster; B has one roster. Each
  // carries a shift assigned to a staff member so the RLS tests can prove staff
  // see their own shift only in a published roster, never a draft, never cross-tenant.
  await q(
    `insert into public.roster (id, business_id, start_date, days, status, published_at)
     values
       ($1, $2, '2026-08-03', 7, 'published', now()),
       ($3, $4, '2026-08-03', 7, 'draft',     null),
       ($5, $6, '2026-08-03', 7, 'published', now())`,
    [fx.rosterPubA, fx.businessA, fx.rosterDraftA, fx.businessA, fx.rosterB, fx.businessB],
  );
  await q(
    `insert into public.roster_position
       (id, business_id, roster_id, location_id, date, role_id, start_at, end_at)
     values
       ($1, $2, $3, $4, '2026-08-03', $5, '2026-08-03 06:00+00', '2026-08-03 13:00+00'),
       ($6, $7, $8, $9, '2026-08-03', $10, '2026-08-03 06:00+00', '2026-08-03 13:00+00')`,
    [
      fx.positionA, fx.businessA, fx.rosterPubA, fx.locationA, fx.roleKitchenA,
      fx.positionB, fx.businessB, fx.rosterB, fx.locationB, fx.roleKitchenB,
    ],
  );
  await q(
    `insert into public.shift
       (id, business_id, roster_id, roster_position_id, location_id, date, start_at, end_at, role_id, assigned_user_id, status)
     values
       ($1, $2, $3, $4, $5, '2026-08-03', '2026-08-03 06:00+00', '2026-08-03 13:00+00', $6, $7, 'assigned'),
       ($8, $9, $10, null, $11, '2026-08-03', '2026-08-03 06:00+00', '2026-08-03 13:00+00', $12, $13, 'assigned'),
       ($14, $15, $16, $17, $18, '2026-08-03', '2026-08-03 06:00+00', '2026-08-03 13:00+00', $19, $20, 'assigned')`,
    [
      // published roster A, assigned to staffA1
      fx.shiftPubA, fx.businessA, fx.rosterPubA, fx.positionA, fx.locationA, fx.roleKitchenA, fx.staffA1,
      // draft roster A, assigned to staffA1 (must stay invisible to staff)
      fx.shiftDraftA, fx.businessA, fx.rosterDraftA, fx.locationA, fx.roleKitchenA, fx.staffA1,
      // published roster B, assigned to managerB
      fx.shiftB, fx.businessB, fx.rosterB, fx.positionB, fx.locationB, fx.roleKitchenB, fx.managerB,
    ],
  );
  await q(
    `insert into public.solve_run (id, business_id, roster_id, seed, time_limit, status)
     values ($1, $2, $3, 42, 15, 'ok')`,
    [fx.solveRunA, fx.businessA, fx.rosterPubA],
  );

  const asUser = async <T,>(authUserId: string, fn: (db: PGlite) => Promise<T>): Promise<T> => {
    await db.exec(
      `set role authenticated;
       select set_config('request.jwt.claims',
                         '${JSON.stringify({ sub: authUserId, role: "authenticated" })}',
                         false);`,
    );
    try {
      return await fn(db);
    } finally {
      await db.exec(
        `reset role;
         select set_config('request.jwt.claims', '', false);`,
      );
    }
  };

  return { db, fx, asUser, close: () => db.close() };
}
