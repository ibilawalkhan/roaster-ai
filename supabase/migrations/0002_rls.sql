-- Rosterly Row-Level Security (REQUIREMENTS.md §1.2, §6, §9).
--
-- Tenant isolation is the highest-stakes correctness property in the app.
-- The DATABASE is the boundary, not the UI. Every table below has RLS enabled
-- and every policy is scoped by business_id derived from the caller's JWT.
--
-- Recursion note: policies on app_user cannot query app_user directly (a policy
-- that reads its own table recurses). We resolve the caller's business_id /
-- role / app_user id through SECURITY DEFINER helpers that run as the function
-- owner and therefore bypass RLS on app_user — the standard Supabase pattern.

-- ---------------------------------------------------------------------------
-- Caller-context helpers (SECURITY DEFINER → bypass RLS, avoid recursion)
-- ---------------------------------------------------------------------------
create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.app_user where auth_user_id = auth.uid();
$$;

create or replace function public.current_business_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select business_id from public.app_user where auth_user_id = auth.uid();
$$;

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.app_user where auth_user_id = auth.uid();
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'manager' from public.app_user where auth_user_id = auth.uid()),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS on every table
-- ---------------------------------------------------------------------------
alter table public.business     enable row level security;
alter table public.location     enable row level security;
alter table public.app_user     enable row level security;
alter table public.roster       enable row level security;
alter table public.shift        enable row level security;
alter table public.shift_claim  enable row level security;
alter table public.availability enable row level security;
alter table public.notification enable row level security;

-- ---------------------------------------------------------------------------
-- business — a user sees only their own business. Platform-level writes go
-- through the service_role (which bypasses RLS), never authenticated users.
-- ---------------------------------------------------------------------------
create policy business_select_own on public.business
  for select to authenticated
  using (id = public.current_business_id());

-- ---------------------------------------------------------------------------
-- location — everyone in the business reads; managers write.
-- ---------------------------------------------------------------------------
create policy location_select on public.location
  for select to authenticated
  using (business_id = public.current_business_id());

create policy location_write_manager on public.location
  for all to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());

-- ---------------------------------------------------------------------------
-- app_user — the wage-privacy table.
--   * Staff can read ONLY their own row (so no one ever sees another's wage).
--   * Managers can read every row in their business.
--   * Staff can update their own row (a trigger blocks changes to sensitive
--     fields — pay_rate/role/active/business_id).
--   * Managers can insert/update/delete any row in their business.
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

-- Server-side guard (rule 2): a non-manager cannot escalate their own record.
-- RLS lets staff update their row; this trigger constrains WHICH columns.
create or replace function public.guard_app_user_update()
returns trigger
language plpgsql
as $$
begin
  -- Only constrain authenticated end-users; service_role/seed (postgres) is trusted.
  if current_user = 'authenticated' and not public.is_manager() then
    if new.pay_rate    is distinct from old.pay_rate
       or new.role     is distinct from old.role
       or new.active   is distinct from old.active
       or new.business_id is distinct from old.business_id then
      raise exception 'staff may not modify pay_rate, role, active or business_id';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_guard_app_user_update
  before update on public.app_user
  for each row execute function public.guard_app_user_update();

-- ---------------------------------------------------------------------------
-- roster — managers see all; staff see only PUBLISHED rosters. Managers write.
-- ---------------------------------------------------------------------------
create policy roster_select on public.roster
  for select to authenticated
  using (
    business_id = public.current_business_id()
    and (public.is_manager() or status = 'published')
  );

create policy roster_write_manager on public.roster
  for all to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());

-- ---------------------------------------------------------------------------
-- shift — managers see all in business; staff see their own assigned shifts
-- plus OPEN shifts they could claim. Managers write (staff drop/claim flows
-- are mediated by the §5.3 transaction in a later migration).
-- ---------------------------------------------------------------------------
create policy shift_select on public.shift
  for select to authenticated
  using (
    business_id = public.current_business_id()
    and (
      public.is_manager()
      or assigned_user_id = public.current_app_user_id()
      or status = 'OPEN'
    )
  );

create policy shift_write_manager on public.shift
  for all to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());

-- ---------------------------------------------------------------------------
-- shift_claim — managers see all in business; staff see their own claims and
-- may create a claim for themselves.
-- ---------------------------------------------------------------------------
create policy shift_claim_select on public.shift_claim
  for select to authenticated
  using (
    business_id = public.current_business_id()
    and (public.is_manager() or claimant_user_id = public.current_app_user_id())
  );

create policy shift_claim_insert_own on public.shift_claim
  for insert to authenticated
  with check (
    business_id = public.current_business_id()
    and claimant_user_id = public.current_app_user_id()
  );

create policy shift_claim_manage_manager on public.shift_claim
  for all to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());

-- ---------------------------------------------------------------------------
-- availability — staff manage their own; managers read all in business.
-- ---------------------------------------------------------------------------
create policy availability_select on public.availability
  for select to authenticated
  using (
    business_id = public.current_business_id()
    and (public.is_manager() or user_id = public.current_app_user_id())
  );

create policy availability_write_own on public.availability
  for all to authenticated
  using (
    business_id = public.current_business_id()
    and user_id = public.current_app_user_id()
  )
  with check (
    business_id = public.current_business_id()
    and user_id = public.current_app_user_id()
  );

-- ---------------------------------------------------------------------------
-- notification — a user sees and updates only their own notifications.
-- Rows are created by trusted server code (service_role) which bypasses RLS.
-- ---------------------------------------------------------------------------
create policy notification_select_own on public.notification
  for select to authenticated
  using (user_id = public.current_app_user_id());

create policy notification_update_own on public.notification
  for update to authenticated
  using (user_id = public.current_app_user_id())
  with check (user_id = public.current_app_user_id());

-- ---------------------------------------------------------------------------
-- Grants. RLS restricts rows; roles still need base table privileges.
-- `anon` (unauthenticated) gets nothing. `authenticated` gets DML, gated by
-- the policies above. `service_role` bypasses RLS entirely (trusted server).
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to authenticated, service_role;
