-- TEST-ONLY shim. Not a migration.
--
-- In a real Supabase project these objects already exist (the platform
-- provides the `auth` schema, `auth.users`, `auth.uid()`, and the anon /
-- authenticated / service_role roles). PGlite is a bare Postgres, so we
-- provision the same surface here BEFORE applying the real migrations —
-- exactly mirroring what Supabase hands you for free. The migrations
-- themselves are never modified for tests.

-- Roles Supabase defines for us.
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- The auth schema + a minimal users table (FK target for app_user.auth_user_id).
create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key,
  phone text,
  email text
);

-- auth.uid() reads the caller's JWT `sub` claim from the request GUC, matching
-- Supabase's implementation. Tests set request.jwt.claims per simulated user.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    ''
  )::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
