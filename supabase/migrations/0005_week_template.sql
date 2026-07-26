-- Rosterly Module 4: Week Template (the DEMAND side of scheduling).
--
-- The manager designs their normal week once (M4 §1): for each day, which
-- shifts must exist, in which role, at what times, and how many people. A slot
-- (M4 §2) is one staffing requirement — "Friday, Kitchen, 16:00–23:00, 2
-- people". Everything (24-hour operation, overlapping day shifts, busy Fridays)
-- falls out of this one primitive; there are deliberately no named "shift
-- types".
--
-- The auto-scheduler (M5) COPIES slots into concrete dated shift requirements —
-- it never references the template live, so editing the template never alters an
-- already-generated or published roster (M4 §6).
--
-- Times are stored as wall-clock `time` (interpreted in the business timezone),
-- matching trading_hours/availability, so a slot like 16:00–23:00 never drifts
-- across a DST change. A slot whose end <= start crosses midnight and belongs to
-- its START day (M4 §5.1); crosses_midnight is derived but stored for query
-- simplicity (M4 §6).
--
-- The data model supports multiple named templates (M4 §4.5 [V1.1] — name,
-- is_default) but MVP ships exactly one template per business.

-- ---------------------------------------------------------------------------
-- week_template — a named set of staffing requirements for a business (M4 §6)
-- ---------------------------------------------------------------------------
create table public.week_template (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business (id) on delete cascade,
  name        text not null default 'Normal week',
  is_default  boolean not null default true,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- template_slot — one staffing requirement within a template (M4 §2, §6)
-- ---------------------------------------------------------------------------
create table public.template_slot (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.business (id) on delete cascade,
  template_id      uuid not null references public.week_template (id) on delete cascade,
  location_id      uuid not null references public.location (id) on delete cascade,
  day_of_week      smallint not null check (day_of_week between 0 and 6), -- 0=Sun..6=Sat
  role_id          uuid not null references public.role (id) on delete restrict,
  start_time       time not null,
  end_time         time not null,
  crosses_midnight boolean not null default false, -- derived (end <= start), stored for queries
  count            integer not null default 1 check (count >= 1),
  required_level   public.user_level,   -- null = no per-slot seniority override (M4 §3)
  label            text,                -- free text, display only ("open", "close")
  active           boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Indexes for hot paths (template grid loads all slots for a business/template)
-- ---------------------------------------------------------------------------
create index idx_week_template_business  on public.week_template (business_id);
create index idx_template_slot_business   on public.template_slot (business_id);
create index idx_template_slot_template   on public.template_slot (template_id);

create trigger trg_week_template_updated_at
  before update on public.week_template
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS (M4 §6 / M11 §4.1): templates are manager-only — staff have NO access
-- (the template is a settings/planning surface, like trading hours and rules).
-- Business-scoped, all operations, matching the manager-only shape in 0002.
-- ---------------------------------------------------------------------------
alter table public.week_template enable row level security;
alter table public.template_slot enable row level security;

create policy week_template_manager on public.week_template
  for all to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());

create policy template_slot_manager on public.template_slot
  for all to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());

-- Grants for the new tables (the blanket grant in 0002 only covered tables that
-- existed then; new tables need their own).
grant select, insert, update, delete
  on public.week_template, public.template_slot to authenticated;
grant all
  on public.week_template, public.template_slot to service_role;
