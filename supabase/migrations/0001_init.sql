-- Rosterly initial schema (REQUIREMENTS.md §10).
-- Multi-tenant: every table carries business_id, the tenant key that every
-- RLS policy filters on (policies live in 0002_rls.sql). Costs are NEVER
-- stored — hours/cost are derived in selectors (rule 5).
--
-- Timezone model (REQUIREMENTS.md §9): instants (created_at/updated_at) are
-- timestamptz stored in UTC. Shift wall-clock times (date/start_time/end_time)
-- are stored as the roster's local calendar values (Australia/Sydney) and
-- attached to a zone only at render — so a 10:00 shift stays 10:00 across a
-- DST change, which is the correct behaviour for a roster.

-- gen_random_uuid() is built into Postgres 13+; no extension needed.

-- ---------------------------------------------------------------------------
-- Controlled vocabularies
-- ---------------------------------------------------------------------------
create type public.subscription_status as enum ('trial', 'active', 'past_due', 'suspended');
create type public.app_role            as enum ('manager', 'staff');
create type public.employment_type     as enum ('casual', 'part-time', 'full-time');
create type public.roster_status       as enum ('draft', 'published');
-- Shift state machine (REQUIREMENTS.md §5.3).
create type public.shift_status        as enum (
  'ASSIGNED', 'DROP_REQUESTED', 'OPEN', 'CLAIMED_PENDING', 'REASSIGNED'
);
create type public.claim_outcome       as enum ('pending', 'approved', 'rejected');
create type public.notification_channel as enum ('inapp', 'sms');

-- ---------------------------------------------------------------------------
-- business — the tenant root
-- ---------------------------------------------------------------------------
create table public.business (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  logo_initial        text,
  subscription_status public.subscription_status not null default 'trial',
  created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- location — a business has one or more sites (v1: one)
-- ---------------------------------------------------------------------------
create table public.location (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- app_user — a person within a business, linked to a Supabase auth user
-- ---------------------------------------------------------------------------
create table public.app_user (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.business (id) on delete cascade,
  auth_user_id     uuid unique references auth.users (id) on delete set null,
  phone            text,
  email            text,
  name             text not null,
  role             public.app_role not null default 'staff',
  employment_type  public.employment_type not null default 'casual',
  pay_rate         numeric(8, 2) not null default 0 check (pay_rate >= 0),
  home_location_id uuid references public.location (id) on delete set null,
  colour           text,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  -- Phone is the login identity; unique within a business (not globally —
  -- two businesses may legitimately hold the same number historically).
  unique (business_id, phone)
);

-- ---------------------------------------------------------------------------
-- roster — a fortnight of shifts, draft or published
-- ---------------------------------------------------------------------------
create table public.roster (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.business (id) on delete cascade,
  fortnight_start date not null,
  status          public.roster_status not null default 'draft',
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- shift — the core row; status transitions per §5.3, guarded by transaction
-- ---------------------------------------------------------------------------
create table public.shift (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.business (id) on delete cascade,
  location_id      uuid references public.location (id) on delete set null,
  roster_id        uuid not null references public.roster (id) on delete cascade,
  date             date not null,
  start_time       time not null,
  end_time         time not null,
  break_minutes    integer not null default 0 check (break_minutes >= 0),
  role             text,
  note             text,
  assigned_user_id uuid references public.app_user (id) on delete set null,
  status           public.shift_status not null default 'ASSIGNED',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Reject impossible shifts at the DB as a backstop to Zod (§9).
  constraint shift_end_after_start check (end_time > start_time),
  constraint shift_break_within_span check (
    break_minutes < (extract(epoch from (end_time - start_time)) / 60)
  )
);

-- ---------------------------------------------------------------------------
-- shift_claim — a staff member's bid on an OPEN shift (§5.3)
-- ---------------------------------------------------------------------------
create table public.shift_claim (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.business (id) on delete cascade,
  shift_id          uuid not null references public.shift (id) on delete cascade,
  claimant_user_id  uuid not null references public.app_user (id) on delete cascade,
  outcome           public.claim_outcome not null default 'pending',
  created_at        timestamptz not null default now(),
  -- A person can hold only one live claim per shift.
  unique (shift_id, claimant_user_id)
);

-- ---------------------------------------------------------------------------
-- availability — staff mark when they can't work (V1.1; table exists now)
-- ---------------------------------------------------------------------------
create table public.availability (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  user_id     uuid not null references public.app_user (id) on delete cascade,
  date        date not null,
  available   boolean not null default true,
  note        text,
  created_at  timestamptz not null default now(),
  unique (user_id, date)
);

-- ---------------------------------------------------------------------------
-- notification — best-effort, logged delivery (§9 rule 7)
-- ---------------------------------------------------------------------------
create table public.notification (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.business (id) on delete cascade,
  user_id         uuid not null references public.app_user (id) on delete cascade,
  type            text not null,
  payload_json    jsonb not null default '{}'::jsonb,
  channel         public.notification_channel not null default 'inapp',
  delivery_status text not null default 'pending',
  read            boolean not null default false,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes for the hot paths (REQUIREMENTS.md §8)
-- ---------------------------------------------------------------------------
create index idx_app_user_business_phone on public.app_user (business_id, phone);
create index idx_shift_business_roster    on public.shift (business_id, roster_id);
create index idx_shift_assigned_date      on public.shift (assigned_user_id, date);
create index idx_shift_status             on public.shift (status);
create index idx_shift_business_date      on public.shift (business_id, date);
create index idx_shift_claim_shift        on public.shift_claim (shift_id);
create index idx_roster_business          on public.roster (business_id);
create index idx_location_business        on public.location (business_id);
create index idx_notification_user        on public.notification (user_id, read);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
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

create trigger trg_shift_updated_at
  before update on public.shift
  for each row execute function public.set_updated_at();
