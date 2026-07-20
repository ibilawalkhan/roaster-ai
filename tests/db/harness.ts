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
  rosterA: string;
  rosterB: string;
  shiftA1: string;
  shiftB1: string;
}

export interface TestDb {
  db: PGlite;
  fx: Fixtures;
  /** Run `fn` in the security context of the given auth user (RLS applies). */
  asUser: <T>(authUserId: string, fn: (db: PGlite) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
}

function migrationSql(): string[] {
  // Every .sql migration, in filename order — the same order Supabase applies.
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(migrationsDir, f), "utf8"));
}

/**
 * Boot an in-process Postgres, provision the Supabase auth surface, apply the
 * real migrations, and seed two isolated tenants.
 */
export async function setupTestDb(): Promise<TestDb> {
  const db = new PGlite();

  // 1. What Supabase provides for free (test-only shim).
  await db.exec(readFileSync(join(here, "auth-shim.sql"), "utf8"));

  // 2. The real, unmodified migrations.
  for (const sql of migrationSql()) {
    await db.exec(sql);
  }

  // 3. Seed — runs as the PGlite owner (superuser), which bypasses RLS, exactly
  //    as a service_role seed script would.
  const fx: Fixtures = {
    businessA: randomUUID(),
    businessB: randomUUID(),
    locationA: randomUUID(),
    locationB: randomUUID(),
    authManagerA: randomUUID(),
    authStaffA1: randomUUID(),
    authStaffA2: randomUUID(),
    authManagerB: randomUUID(),
    managerA: randomUUID(),
    staffA1: randomUUID(),
    staffA2: randomUUID(),
    managerB: randomUUID(),
    rosterA: randomUUID(),
    rosterB: randomUUID(),
    shiftA1: randomUUID(),
    shiftB1: randomUUID(),
  };

  const q = (text: string, params: unknown[]) => db.query(text, params);

  // auth users
  for (const [id, phone] of [
    [fx.authManagerA, "61400000001"],
    [fx.authStaffA1, "61400000002"],
    [fx.authStaffA2, "61400000003"],
    [fx.authManagerB, "61400000004"],
  ] as const) {
    await q("insert into auth.users (id, phone) values ($1, $2)", [id, phone]);
  }

  // businesses
  await q("insert into public.business (id, name) values ($1, $2), ($3, $4)", [
    fx.businessA,
    "Al Tazah Charcoal Chicken",
    fx.businessB,
    "Guildford Restaurant",
  ]);

  // locations
  await q("insert into public.location (id, business_id, name) values ($1, $2, $3), ($4, $5, $6)", [
    fx.locationA, fx.businessA, "Regents Park",
    fx.locationB, fx.businessB, "Guildford",
  ]);

  // app_users — note the DIFFERENT pay rates (the wage-privacy test relies on
  // staff A1 not being able to read staff A2's rate).
  const users: [string, string, string, string, string, number, string][] = [
    [fx.managerA, fx.businessA, fx.authManagerA, "Khaled Nasser", "manager", 38, fx.locationA],
    [fx.staffA1, fx.businessA, fx.authStaffA1, "Sara Haddad", "staff", 30, fx.locationA],
    [fx.staffA2, fx.businessA, fx.authStaffA2, "Ahmed Khan", "staff", 27, fx.locationA],
    [fx.managerB, fx.businessB, fx.authManagerB, "Guildford Manager", "manager", 40, fx.locationB],
  ];
  for (const [id, biz, auth, name, role, rate, loc] of users) {
    await q(
      `insert into public.app_user
         (id, business_id, auth_user_id, name, role, pay_rate, home_location_id, phone)
       values ($1, $2, $3, $4, $5::public.app_role, $6, $7, $8)`,
      [id, biz, auth, name, role, rate, loc, null],
    );
  }

  // rosters (published so staff can see their shifts)
  await q(
    `insert into public.roster (id, business_id, fortnight_start, status)
     values ($1, $2, '2026-07-20', 'published'), ($3, $4, '2026-07-20', 'published')`,
    [fx.rosterA, fx.businessA, fx.rosterB, fx.businessB],
  );

  // one shift each, assigned
  await q(
    `insert into public.shift
       (id, business_id, location_id, roster_id, date, start_time, end_time,
        break_minutes, assigned_user_id, status)
     values
       ($1, $2, $3, $4, '2026-07-21', '10:00', '16:30', 30, $5, 'ASSIGNED'),
       ($6, $7, $8, $9, '2026-07-21', '11:00', '19:00', 30, $10, 'ASSIGNED')`,
    [
      fx.shiftA1, fx.businessA, fx.locationA, fx.rosterA, fx.staffA1,
      fx.shiftB1, fx.businessB, fx.locationB, fx.rosterB, fx.managerB,
    ],
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
