-- Rosterly Module 6: Draft review & publish — audit trail (M6 §5).
--
-- Two tables the manager's review/publish flow writes into:
--   roster_change_log — who changed what and when. Essential when a staff member
--                       says "that's not what it said yesterday" (M6 §4.3).
--   roster_warning    — persisted rule overrides, so a knowingly-published
--                       exception stays visible until resolved rather than
--                       vanishing with a toast (M6 §3.2).
--
-- M6 warns, it does not block: the manager may publish with known exceptions
-- (M6 §4.1), but must never be able to FORGET them — which is what `resolved`
-- and the partial index below are for.
--
-- `action` and `rule` are text with CHECK constraints rather than enums,
-- deliberately: M6 will keep growing its vocabulary as edit affordances are
-- added, and a CHECK is amendable in a forward-only migration without the
-- ALTER TYPE dance an enum would need. The constraint still keeps the column
-- honest, so a typo cannot enter the audit trail.

-- ---------------------------------------------------------------------------
-- roster — who published it (M6 §4.2). published_at already exists from 0006.
-- ---------------------------------------------------------------------------
alter table public.roster
  add column published_by uuid references public.app_user (id) on delete set null;

-- ---------------------------------------------------------------------------
-- roster_change_log — append-only record of every roster edit (M6 §5).
-- `notified` records whether the affected staff member was told (M9).
-- ---------------------------------------------------------------------------
create table public.roster_change_log (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.business (id) on delete cascade,
  roster_id          uuid not null references public.roster (id) on delete cascade,
  shift_id           uuid references public.shift (id) on delete set null,
  action             text not null check (action in (
                       'assign', 'reassign', 'remove', 'add_position', 'delete_position',
                       'edit_times', 'lock', 'unlock', 'publish', 'unpublish'
                     )),
  before_json        jsonb,
  after_json         jsonb,
  changed_by_user_id uuid references public.app_user (id) on delete set null,
  changed_at         timestamptz not null default now(),
  notified           boolean not null default false
);

-- ---------------------------------------------------------------------------
-- roster_warning — a rule violation the manager has seen and may have accepted
-- (M6 §3.2). Persists as a visible flag until resolved.
-- ---------------------------------------------------------------------------
create table public.roster_warning (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.business (id) on delete cascade,
  roster_id       uuid not null references public.roster (id) on delete cascade,
  shift_id        uuid references public.shift (id) on delete set null,
  rule            text not null check (rule in (
                    'availability', 'max_hours', 'min_rest',
                    'consecutive_days', 'senior_coverage', 'min_hours'
                  )),
  detail          text,   -- names who, when and which rule (M6 §3.2)
  acknowledged_by uuid references public.app_user (id) on delete set null,
  acknowledged_at timestamptz,
  resolved        boolean not null default false,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes for hot paths (the change log renders newest-first for one roster;
-- the health panel only ever asks for the OUTSTANDING warnings).
-- ---------------------------------------------------------------------------
create index idx_roster_change_log_roster on public.roster_change_log (roster_id, changed_at);
create index idx_roster_warning_open      on public.roster_warning (roster_id) where not resolved;

-- ---------------------------------------------------------------------------
-- RLS (M11 §4.1 — "Change log / audit: Manager read, Staff none").
--
-- roster_change_log is APPEND-ONLY from the client's perspective: managers get
-- select and insert policies and nothing else, so there is no UPDATE or DELETE
-- path at all (M11 §8: "Nobody can edit it"). Corrections are new rows, never
-- rewritten history. Grants match — no update/delete privilege is handed out.
--
-- roster_warning is mutable by managers, because acknowledging and resolving a
-- warning IS the workflow (M6 §3.2); it is a live state, not a historical record.
-- ---------------------------------------------------------------------------
alter table public.roster_change_log enable row level security;
alter table public.roster_warning    enable row level security;

create policy roster_change_log_select_manager on public.roster_change_log
  for select to authenticated
  using (business_id = public.current_business_id() and public.is_manager());

create policy roster_change_log_insert_manager on public.roster_change_log
  for insert to authenticated
  with check (business_id = public.current_business_id() and public.is_manager());

create policy roster_warning_manager on public.roster_warning
  for all to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());

-- Grants for the new tables (the blanket grant in 0002 only covered tables that
-- existed then; new tables need their own).
grant select, insert on public.roster_change_log to authenticated;
grant select, insert, update, delete on public.roster_warning to authenticated;
grant all on public.roster_change_log, public.roster_warning to service_role;
