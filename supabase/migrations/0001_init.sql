-- Rosterly foundation schema — Module 1 (Business Setup) + the identity/tenancy
-- spine from Module 2 (Team) and Module 11 (Auth/Tenancy).
--
-- This is a clean re-baseline toward the updated_requirements/ modular spec.
-- roster / shift / availability / notification tables are intentionally NOT here
-- yet — they are introduced by their own modules (M4/M5, M3, M9) in later
-- migrations, in their correct shape (UTC timestamps, roster_position split,
-- pattern+exception availability, outbox notifications).
--
-- Multi-tenant: every table carries business_id, the key every RLS policy
-- (0002_rls.sql) filters on. Timezone is per-business (M1 §3.1); instants are
-- timestamptz (UTC), wall-clock config (trading hours) is `time` interpreted in
-- the business timezone at read.

-- ---------------------------------------------------------------------------
-- Controlled vocabularies
-- ---------------------------------------------------------------------------
create type public.subscription_status as enum ('trial', 'active', 'past_due', 'suspended');
create type public.roster_period       as enum ('week', 'fortnight');
create type public.employment_type     as enum ('casual', 'part_time', 'full_time');
create type public.user_level          as enum ('junior', 'mid', 'senior');
create type public.time_of_day         as enum ('morning', 'afternoon', 'evening', 'night', 'no_preference');
create type public.invite_status       as enum ('not_invited', 'invited', 'active');

-- ---------------------------------------------------------------------------
-- business — the tenant root (M1 §3.1, §5)
-- ---------------------------------------------------------------------------
create table public.business (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  timezone            text not null default 'Australia/Sydney',
  week_start_day      smallint not null default 1 check (week_start_day between 0 and 6), -- 0=Sun..6=Sat
  roster_period       public.roster_period not null default 'fortnight',
  currency            text not null default 'AUD',
  subscription_status public.subscription_status not null default 'trial',
  logo_initial        text,
  created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- location — one or more sites per business (M1 §3.2)
-- ---------------------------------------------------------------------------
create table public.location (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  name        text not null,
  address     text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- role — editable per-business job roles (M1 §3.4). Distinct from access role.
-- ---------------------------------------------------------------------------
create table public.role (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  name        text not null,
  short_code  text,
  colour      text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (business_id, name)
);

-- ---------------------------------------------------------------------------
-- trading_hours — per location per weekday (M1 §3.3). The scheduler's clock.
-- ---------------------------------------------------------------------------
create table public.trading_hours (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  location_id uuid not null references public.location (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  is_open     boolean not null default true,
  opens_at    time,
  closes_at   time,
  is_24h      boolean not null default false,
  unique (location_id, day_of_week),
  -- An open, non-24h day must have both times set (M1 §6).
  constraint trading_hours_times_present check (
    is_24h or not is_open or (opens_at is not null and closes_at is not null)
  ),
  -- closes_at == opens_at is only valid for a 24h day; otherwise reject.
  -- (closes_at < opens_at is allowed — it means the window crosses midnight.)
  constraint trading_hours_not_zero_length check (
    is_24h or not is_open or opens_at is null or closes_at is null or opens_at <> closes_at
  )
);

-- ---------------------------------------------------------------------------
-- scheduling_rule — the auto-scheduler's hard constraints (M1 §3.6). One/business.
-- ---------------------------------------------------------------------------
create table public.scheduling_rule (
  id                        uuid primary key default gen_random_uuid(),
  business_id               uuid not null unique references public.business (id) on delete cascade,
  senior_coverage_enabled   boolean not null default true,
  senior_min_count          integer not null default 1 check (senior_min_count >= 1),
  senior_qualifying_levels  public.user_level[] not null default '{senior}',
  max_hours_casual          integer not null default 38,
  max_hours_part_time       integer not null default 30,
  max_hours_full_time       integer not null default 38,
  max_consecutive_days      integer not null default 6 check (max_consecutive_days between 1 and 7),
  min_rest_hours            integer not null default 10 check (min_rest_hours >= 0),
  max_shift_hours           integer not null default 12,
  min_shift_hours           integer not null default 3,
  one_shift_per_day         boolean not null default true,
  allow_overnight           boolean not null default true,
  soft_priority_order       text[] not null default '{fairness,cost,preferences,consistency}',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint scheduling_rule_shift_len check (min_shift_hours <= max_shift_hours)
);

-- ---------------------------------------------------------------------------
-- break_rule — unpaid-break tiers by shift length (M1 §3.7). Cost estimate only.
-- ---------------------------------------------------------------------------
create table public.break_rule (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.business (id) on delete cascade,
  min_hours     numeric(4, 2) not null check (min_hours >= 0),
  max_hours     numeric(4, 2),
  break_minutes integer not null default 0 check (break_minutes >= 0),
  created_at    timestamptz not null default now(),
  constraint break_rule_range check (max_hours is null or max_hours >= min_hours)
);

-- ---------------------------------------------------------------------------
-- app_user — a person within a business, linked to a Supabase auth user.
-- Shape per M2 §5 / M11: is_manager (access) is distinct from job role(s).
-- ---------------------------------------------------------------------------
create table public.app_user (
  id                       uuid primary key default gen_random_uuid(),
  business_id              uuid not null references public.business (id) on delete cascade,
  auth_user_id             uuid unique references auth.users (id) on delete set null,
  name                     text not null,
  phone                    text,
  email                    text,
  colour                   text,
  level                    public.user_level not null default 'mid',
  employment_type          public.employment_type not null default 'casual',
  primary_role_id          uuid references public.role (id) on delete set null,
  home_location_id         uuid references public.location (id) on delete set null,
  can_work_other_locations boolean not null default false,
  pay_rate                 numeric(8, 2) not null default 0 check (pay_rate >= 0),
  max_hours_week           integer,   -- null = inherit from employment type (M1)
  min_hours_week           integer default 0,
  max_shifts_week          integer,
  preferred_days           smallint[],
  preferred_time_of_day    public.time_of_day,
  notes                    text,      -- manager-only notes about the person
  is_manager               boolean not null default false,
  invite_status            public.invite_status not null default 'not_invited',
  active                   boolean not null default true,
  created_at               timestamptz not null default now(),
  unique (business_id, phone),
  constraint app_user_hours_order check (
    max_hours_week is null or min_hours_week is null or min_hours_week <= max_hours_week
  )
);

-- ---------------------------------------------------------------------------
-- user_role — the roles a person can work (M2 §5). Many-to-many.
-- ---------------------------------------------------------------------------
create table public.user_role (
  business_id uuid not null references public.business (id) on delete cascade,
  user_id     uuid not null references public.app_user (id) on delete cascade,
  role_id     uuid not null references public.role (id) on delete cascade,
  primary key (user_id, role_id)
);

-- ---------------------------------------------------------------------------
-- Indexes for hot paths
-- ---------------------------------------------------------------------------
create index idx_location_business       on public.location (business_id);
create index idx_role_business           on public.role (business_id);
create index idx_trading_hours_location  on public.trading_hours (location_id);
create index idx_break_rule_business     on public.break_rule (business_id);
create index idx_app_user_business_phone on public.app_user (business_id, phone);
create index idx_app_user_business       on public.app_user (business_id);
create index idx_user_role_role          on public.user_role (role_id);
create index idx_user_role_business      on public.user_role (business_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance (scheduling_rule; more tables gain it in later modules)
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_scheduling_rule_updated_at
  before update on public.scheduling_rule
  for each row execute function public.set_updated_at();
