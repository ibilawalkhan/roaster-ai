-- Rosterly Module 3: Availability (when each person can / cannot work).
--
-- Two layers resolved at read time (M3 §3): a repeating weekly pattern plus
-- one-off date exceptions. The resolution itself lives in ONE shared function
-- in the app (src/lib/domain/availability.ts, TECH_STACK §7) so the scheduler,
-- roster warnings and the manager view can never disagree — it is deliberately
-- NOT duplicated in SQL.
--
-- Times are stored as wall-clock `time` (interpreted in the business timezone),
-- so an availability window like 16:00–23:00 never drifts across a DST change.

-- ---------------------------------------------------------------------------
-- availability_pattern — default weekly availability, one row per user+weekday
-- ---------------------------------------------------------------------------
create table public.availability_pattern (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.business (id) on delete cascade,
  user_id            uuid not null references public.app_user (id) on delete cascade,
  day_of_week        smallint not null check (day_of_week between 0 and 6), -- 0=Sun..6=Sat
  is_available       boolean not null default true,
  from_time          time,   -- null = any time the business is open
  to_time            time,
  updated_by_user_id uuid references public.app_user (id) on delete set null,
  updated_at         timestamptz not null default now(),
  unique (user_id, day_of_week)
);

-- ---------------------------------------------------------------------------
-- availability_exception — one-off override for a specific date (either way)
-- ---------------------------------------------------------------------------
create table public.availability_exception (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.business (id) on delete cascade,
  user_id            uuid not null references public.app_user (id) on delete cascade,
  date               date not null,
  is_available       boolean not null,
  from_time          time,   -- null = whole day
  to_time            time,
  reason             text,
  source             text not null default 'staff' check (source in ('staff', 'manager')),
  created_by_user_id uuid references public.app_user (id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (user_id, date)     -- a second exception for a date replaces the first
);

create index idx_avail_pattern_user   on public.availability_pattern (user_id);
create index idx_avail_exc_user_date   on public.availability_exception (user_id, date);
create index idx_avail_exc_business    on public.availability_exception (business_id, date);

create trigger trg_avail_pattern_updated_at
  before update on public.availability_pattern
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS (M3 §6 / M11): staff read+write their OWN rows; managers all in business.
-- ---------------------------------------------------------------------------
alter table public.availability_pattern   enable row level security;
alter table public.availability_exception enable row level security;

create policy avail_pattern_rw on public.availability_pattern
  for all to authenticated
  using (
    business_id = public.current_business_id()
    and (public.is_manager() or user_id = public.current_app_user_id())
  )
  with check (
    business_id = public.current_business_id()
    and (public.is_manager() or user_id = public.current_app_user_id())
  );

create policy avail_exception_rw on public.availability_exception
  for all to authenticated
  using (
    business_id = public.current_business_id()
    and (public.is_manager() or user_id = public.current_app_user_id())
  )
  with check (
    business_id = public.current_business_id()
    and (public.is_manager() or user_id = public.current_app_user_id())
  );

-- Grants for the new tables (the blanket grant in 0002 only covered tables that
-- existed then; new tables need their own).
grant select, insert, update, delete
  on public.availability_pattern, public.availability_exception to authenticated;
grant all
  on public.availability_pattern, public.availability_exception to service_role;
