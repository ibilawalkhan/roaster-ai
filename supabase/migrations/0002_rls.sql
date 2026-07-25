-- Rosterly Row-Level Security for the foundation tables (Module 11).
--
-- The database is the security boundary. Every table has RLS enabled; every
-- policy is scoped by the caller's business_id, derived via SECURITY DEFINER
-- helpers that read app_user without re-triggering RLS (avoids recursion).
--
-- Permission model (M11 §4.1):
--   business / location / role   → readable by all members, writable by managers
--   trading_hours / scheduling_rule / break_rule → managers only (settings)
--   app_user                     → staff read own; managers read all in business
--   user_role                    → staff read own; managers write

-- ---------------------------------------------------------------------------
-- Caller-context helpers (SECURITY DEFINER → bypass RLS on app_user)
-- ---------------------------------------------------------------------------
create or replace function public.current_app_user_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.app_user where auth_user_id = auth.uid();
$$;

create or replace function public.current_business_id()
returns uuid language sql stable security definer set search_path = public as $$
  select business_id from public.app_user where auth_user_id = auth.uid();
$$;

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select is_manager from public.app_user where auth_user_id = auth.uid()),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere (M11 §5.2: no table without RLS)
-- ---------------------------------------------------------------------------
alter table public.business        enable row level security;
alter table public.location        enable row level security;
alter table public.role            enable row level security;
alter table public.trading_hours   enable row level security;
alter table public.scheduling_rule enable row level security;
alter table public.break_rule      enable row level security;
alter table public.app_user        enable row level security;
alter table public.user_role       enable row level security;

-- ---------------------------------------------------------------------------
-- business — all members read their own business; managers update it.
-- (Platform-level inserts go through service_role, which bypasses RLS.)
-- ---------------------------------------------------------------------------
create policy business_select on public.business
  for select to authenticated
  using (id = public.current_business_id());

create policy business_update_manager on public.business
  for update to authenticated
  using (id = public.current_business_id() and public.is_manager())
  with check (id = public.current_business_id() and public.is_manager());

-- ---------------------------------------------------------------------------
-- location & role — reference data: all members read, managers write.
-- Staff need location names and job-role names/colours to render their shifts.
-- ---------------------------------------------------------------------------
create policy location_select on public.location
  for select to authenticated
  using (business_id = public.current_business_id());
create policy location_write_manager on public.location
  for all to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());

create policy role_select on public.role
  for select to authenticated
  using (business_id = public.current_business_id());
create policy role_write_manager on public.role
  for all to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());

-- ---------------------------------------------------------------------------
-- trading_hours / scheduling_rule / break_rule — manager-only (settings).
-- ---------------------------------------------------------------------------
create policy trading_hours_manager on public.trading_hours
  for all to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());

create policy scheduling_rule_manager on public.scheduling_rule
  for all to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());

create policy break_rule_manager on public.break_rule
  for all to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());

-- ---------------------------------------------------------------------------
-- app_user — staff read ONLY their own row (wage privacy); managers read all.
-- Staff may update their own row; a trigger restricts WHICH columns (contact
-- only). Managers write any row in their business.
-- ---------------------------------------------------------------------------
create policy app_user_select on public.app_user
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    or (business_id = public.current_business_id() and public.is_manager())
  );

create policy app_user_update_own on public.app_user
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

create policy app_user_write_manager on public.app_user
  for all to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());

-- Staff self-edits are limited to contact fields (phone, email). Everything
-- else — above all is_manager and pay_rate — is manager-only (M11 §4.1, §6 #13).
create or replace function public.guard_app_user_update()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' and not public.is_manager() then
    if new.is_manager               is distinct from old.is_manager
       or new.pay_rate              is distinct from old.pay_rate
       or new.level                 is distinct from old.level
       or new.employment_type       is distinct from old.employment_type
       or new.primary_role_id       is distinct from old.primary_role_id
       or new.home_location_id      is distinct from old.home_location_id
       or new.can_work_other_locations is distinct from old.can_work_other_locations
       or new.max_hours_week        is distinct from old.max_hours_week
       or new.min_hours_week        is distinct from old.min_hours_week
       or new.max_shifts_week       is distinct from old.max_shifts_week
       or new.notes                 is distinct from old.notes
       or new.active                is distinct from old.active
       or new.business_id           is distinct from old.business_id
       or new.name                  is distinct from old.name then
      raise exception 'staff may only edit their own contact details (phone, email)';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_guard_app_user_update
  before update on public.app_user
  for each row execute function public.guard_app_user_update();

-- ---------------------------------------------------------------------------
-- user_role — staff read their own role assignments; managers manage all.
-- ---------------------------------------------------------------------------
create policy user_role_select on public.user_role
  for select to authenticated
  using (
    business_id = public.current_business_id()
    and (public.is_manager() or user_id = public.current_app_user_id())
  );

create policy user_role_write_manager on public.user_role
  for all to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());

-- ---------------------------------------------------------------------------
-- Grants. RLS restricts rows; roles still need base table privileges.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to authenticated, service_role;
