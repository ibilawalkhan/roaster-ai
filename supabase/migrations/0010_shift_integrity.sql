-- Rosterly: shift integrity — closing two gaps M6 surfaced.
--
-- 1. Widen the roster_warning vocabulary so the live one-shift-per-day warning
--    can actually be persisted (it warned live and left no flag, which is the
--    exact "manager must never FORGET a known exception" failure M6 §3.2 exists
--    to prevent).
-- 2. Enforce "nobody is in two places at once" (M5 §5.1 H3) in the DATABASE.
--    Until now that block lived only in the UI (src/lib/domain/eligibility.ts)
--    and the solver, so a hand-rolled API call could double-book a person.
--    CLAUDE.md rule 2: never trust the client; the DB is the final gate.

-- ---------------------------------------------------------------------------
-- 1. roster_warning.rule — add 'one_shift_per_day' (forward-only: drop and
--    re-add the CHECK rather than editing 0009).
--
--    Vocabulary checked against ROSTER_WARNING_RULES in
--    src/lib/domain/eligibility.ts. That union lists six terms, all already
--    present, and 'one_shift_per_day' is the single genuinely missing one — its
--    EligibilityIssue.persistedRule is null today purely because this CHECK had
--    no term for it. The other null-persisted rules ('inactive', 'role',
--    'overlap') are BLOCKS, never overridable warnings, so they are deliberately
--    NOT added here: nothing ever emits them into roster_warning.
-- ---------------------------------------------------------------------------
alter table public.roster_warning drop constraint roster_warning_rule_check;

alter table public.roster_warning add constraint roster_warning_rule_check check (rule in (
  'availability', 'max_hours', 'min_rest',
  'consecutive_days', 'senior_coverage', 'min_hours',
  'one_shift_per_day'
));

-- ---------------------------------------------------------------------------
-- 2. No double-booking — enforced by trigger, not an exclusion constraint.
--
-- WHY A TRIGGER: the natural tool here is
--   exclude using gist (assigned_user_id with =, tstzrange(start_at, end_at) with &&)
-- which needs the btree_gist extension for the `=` operator on uuid. That
-- extension is NOT available in PGlite, the in-process Postgres the db test
-- suite runs on (verified: `create extension btree_gist` → "extension
-- btree_gist is not available"). Using it would mean the constraint could not be
-- exercised by any automated test — the guarantee would be asserted in
-- production and unverified everywhere else. A trigger holds identically in
-- PGlite and in managed Supabase, so the invariant is actually tested. If
-- btree_gist becomes available, this can be swapped for the exclusion
-- constraint in a later forward-only migration with no app change: the error
-- below deliberately raises SQLSTATE 23P01 (exclusion_violation), the same code
-- an exclusion constraint would, so callers need not care which is in force.
--
-- CONCURRENCY: a naive check-then-insert trigger is racy — two transactions can
-- each pass the SELECT without seeing the other's uncommitted row, and both
-- commit a double-booking. The advisory transaction lock keyed on the person
-- closes that: concurrent writes touching the SAME person serialise, while
-- different people never contend. This matters because approve_claim() (0007)
-- writes assigned_user_id, so a swap approval is exactly a path where two
-- managers could otherwise book one person into two overlapping shifts.
--
-- SCOPE: keyed on assigned_user_id alone, with no business_id term. A person
-- belongs to exactly one business (app_user.business_id), so the user id
-- already implies the tenant; adding business_id would be redundant and would
-- weaken the check to nothing if a row ever carried a mismatched business_id.
-- The scope is also deliberately NOT limited to one roster_id: being in two
-- places at once is a fact about a human being, not about a document, so a
-- draft roster may not double-book someone against a published one either.
-- (Trade-off: this means a second roster covering dates already published
-- cannot re-assign the same people. That is not a workflow M5/M6 has — the
-- regenerate flow re-solves within the SAME roster — but if it is ever added,
-- the fix is to add `and roster_id = new.roster_id` here, in a new migration.)
--
-- RANGE SEMANTICS: tstzrange defaults to '[)', half-open, so touching endpoints
-- do NOT overlap — 10:00–16:00 followed by 16:00–22:00 is a legal back-to-back
-- pair, which is a normal restaurant handover.
-- ---------------------------------------------------------------------------
create or replace function public.guard_shift_no_overlap()
returns trigger
language plpgsql
as $$
declare
  v_clash_id    uuid;
  v_clash_start timestamptz;
begin
  -- An unfilled position is nobody's shift; it cannot clash (M5 §5.2 keeps
  -- unfilled positions as first-class rows).
  if new.assigned_user_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.assigned_user_id::text, 0));

  select id, start_at into v_clash_id, v_clash_start
    from public.shift
   where assigned_user_id = new.assigned_user_id
     and id <> new.id
     and tstzrange(start_at, end_at) && tstzrange(new.start_at, new.end_at)
   limit 1;

  if v_clash_id is not null then
    raise exception
      'shift_no_overlap: this person is already rostered on an overlapping shift (% starting %)',
      v_clash_id, v_clash_start
      using errcode = 'exclusion_violation';
  end if;

  return new;
end;
$$;

-- The column list applies to the UPDATE event: re-check only when the person or
-- the window actually moves, never on an unrelated edit (status, locked, ...).
create trigger trg_shift_no_overlap
  before insert or update of assigned_user_id, start_at, end_at on public.shift
  for each row execute function public.guard_shift_no_overlap();
