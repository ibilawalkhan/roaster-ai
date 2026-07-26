-- Rosterly Module 5: Roster Creation & Auto-Scheduler (the SUPPLY→assignment side).
--
-- The auto-scheduler (a separate stateless Python/OR-Tools service, M5 §3) turns
-- demand (the week template, M4) plus supply (staff/availability, M2/M3) into a
-- DRAFT roster. This migration holds the tables that draft is written into; the
-- solver itself lives outside the database.
--
-- Three-way split (M5 §9):
--   roster           — the period being scheduled (draft until the manager publishes)
--   roster_position  — a concrete dated REQUIREMENT, seeded by copying template slots
--   shift            — an ASSIGNMENT (the roster's real content); a position may be
--                      unfilled, so positions are first-class, not implied by shifts
--   solve_run        — every solve persisted for replay/regression/debugging (M5 §8)
--
-- Timezone (CLAUDE.md §8): unlike template_slot (wall-clock `time`), roster_position
-- and shift store start_at/end_at as `timestamptz` (UTC) — these are real instants on
-- concrete dates, so durations stay correct across a DST boundary (M5 §10). `date` is
-- the anchor/trading day (overnight shifts belong to their start date, M5 §10).
--
-- The shift status enum defines ALL M8 swap states now so Module 8 only ADDs columns
-- (drop_requested_by, etc.) later and never has to alter the enum.

-- ---------------------------------------------------------------------------
-- Controlled vocabularies
-- ---------------------------------------------------------------------------
create type public.roster_status   as enum ('draft', 'published');
create type public.position_source as enum ('template', 'manual');
create type public.shift_origin    as enum ('auto', 'manual');
-- Full M8 §2 swap lifecycle now; a reassignment goes back to 'assigned' (no
-- separate 'reassigned' value).
create type public.shift_status    as enum ('assigned', 'drop_requested', 'open', 'claimed_pending');
create type public.solve_status    as enum ('ok', 'partial', 'failed');

-- ---------------------------------------------------------------------------
-- roster — the period being scheduled (M5 §9). Draft until published (M5 §1).
-- ---------------------------------------------------------------------------
create table public.roster (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.business (id) on delete cascade,
  location_scope text,   -- null = all locations; otherwise a single location filter
  start_date     date not null,
  days           integer not null check (days > 0),
  status         public.roster_status not null default 'draft',
  template_id    uuid references public.week_template (id) on delete set null,
  created_by     uuid references public.app_user (id) on delete set null,
  created_at     timestamptz not null default now(),
  published_at   timestamptz
);

-- ---------------------------------------------------------------------------
-- roster_position — a concrete dated requirement (M5 §9). The DEMAND on real
-- dates, copied from template slots; unfilled positions are visible objects.
-- ---------------------------------------------------------------------------
create table public.roster_position (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.business (id) on delete cascade,
  roster_id      uuid not null references public.roster (id) on delete cascade,
  location_id    uuid not null references public.location (id) on delete cascade,
  date           date not null,
  role_id        uuid not null references public.role (id) on delete restrict,
  start_at       timestamptz not null,   -- UTC instant (not wall-clock)
  end_at         timestamptz not null,
  required_level public.user_level,      -- null = no per-position seniority override
  label          text,                   -- free text, display only
  source         public.position_source not null default 'template'
);

-- ---------------------------------------------------------------------------
-- shift — an assignment (M5 §9). The roster's real content. break_minutes feeds
-- the cost ESTIMATE only (CLAUDE.md §5). pay_rate_snapshot captures the rate at
-- assignment time so a later rate change doesn't retro-alter a published roster.
-- ---------------------------------------------------------------------------
create table public.shift (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.business (id) on delete cascade,
  roster_id          uuid not null references public.roster (id) on delete cascade,
  roster_position_id uuid references public.roster_position (id) on delete set null,
  location_id        uuid not null references public.location (id) on delete cascade,
  date               date not null,
  start_at           timestamptz not null,   -- UTC instant
  end_at             timestamptz not null,
  break_minutes      integer not null default 0 check (break_minutes >= 0),
  role_id            uuid not null references public.role (id) on delete restrict,
  assigned_user_id   uuid references public.app_user (id) on delete set null,
  origin             public.shift_origin not null default 'auto',
  locked             boolean not null default false,
  status             public.shift_status not null default 'assigned',
  pay_rate_snapshot  numeric(8, 2) check (pay_rate_snapshot is null or pay_rate_snapshot >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- solve_run — every solve persisted for replay, regression tests and debugging
-- (M5 §8). Stores the full request/response, seed and rule version.
-- ---------------------------------------------------------------------------
create table public.solve_run (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.business (id) on delete cascade,
  roster_id     uuid not null references public.roster (id) on delete cascade,
  request_json  jsonb,
  response_json jsonb,
  seed          integer,
  time_limit    integer,
  solve_seconds numeric,
  status        public.solve_status not null,
  created_by    uuid references public.app_user (id) on delete set null,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes for hot paths (M5 §8 scalability: grid loads a roster's shifts;
-- the staff app loads one person's shifts by date; swaps query open shifts).
-- ---------------------------------------------------------------------------
create index idx_roster_business            on public.roster (business_id);
create index idx_roster_position_roster       on public.roster_position (roster_id);
create index idx_shift_business_roster        on public.shift (business_id, roster_id);
create index idx_shift_assigned_user_date     on public.shift (assigned_user_id, date);
create index idx_shift_status                 on public.shift (status);
create index idx_solve_run_roster             on public.solve_run (roster_id);

create trigger trg_shift_updated_at
  before update on public.shift
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS (M11 §5.1). The database is the security boundary.
--   roster           — managers all; staff read only PUBLISHED rosters.
--   roster_position  — manager-only (demand is planning, like the template).
--   shift            — managers all; staff read their OWN shift, and only when
--                      its roster is published (drafts invisible at the DB level).
--   solve_run        — manager-only (diagnostics).
-- Staff drop/claim mutations arrive as SECURITY DEFINER RPCs in M8; for now all
-- write paths are manager-only.
-- ---------------------------------------------------------------------------
alter table public.roster          enable row level security;
alter table public.roster_position enable row level security;
alter table public.shift           enable row level security;
alter table public.solve_run       enable row level security;

-- roster: staff may see a published roster (its metadata); drafts are manager-only.
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

-- roster_position: manager-only (the demand side is a planning surface).
create policy roster_position_manager on public.roster_position
  for all to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());

-- shift: managers all; staff read own assigned shift only in a published roster.
create policy shift_select on public.shift
  for select to authenticated
  using (
    business_id = public.current_business_id()
    and (
      public.is_manager()
      or (
        assigned_user_id = public.current_app_user_id()
        and exists (
          select 1 from public.roster r
          where r.id = shift.roster_id and r.status = 'published'
        )
      )
    )
  );
create policy shift_write_manager on public.shift
  for all to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());

-- solve_run: manager-only (diagnostics / replay data).
create policy solve_run_manager on public.solve_run
  for all to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());

-- Grants for the new tables (the blanket grant in 0002 only covered tables that
-- existed then; new tables need their own).
grant select, insert, update, delete
  on public.roster, public.roster_position, public.shift, public.solve_run to authenticated;
grant all
  on public.roster, public.roster_position, public.shift, public.solve_run to service_role;
