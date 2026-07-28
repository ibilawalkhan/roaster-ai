-- Rosterly Module 8: Shift Swaps (drop → claim → approve).
--
-- The manager is the gate (M8 §1): a drop notifies ONLY the manager; nothing is
-- broadcast to the team until the manager explicitly opens the shift. The
-- invariant that matters most: a shift is never owned by two people, and never
-- quietly owned by nobody (CLAUDE.md rule 4).
--
-- The state machine (M8 §2) lives on shift.status, whose enum was defined in
-- full by 0006 — this migration does NOT alter it. Transitions:
--   assigned        --staff requests drop-->  drop_requested   (notify manager)
--   drop_requested  --manager declines---->   assigned
--   drop_requested  --manager opens------->   open             (notify eligible)
--   open            --staff claims-------->   claimed_pending  (notify manager)
--   claimed_pending --manager approves X->    assigned (to X)
-- A reassignment returns to 'assigned'; there is deliberately no 'reassigned'.
--
-- Every transition is recorded in shift_swap_event (M8 §6) — an append-only
-- audit no client can forge (M11 §8: nobody can edit the audit log).
--
-- The approval step is THE critical section (M8 §5, CLAUDE.md rule 3): it runs
-- as one transaction in public.approve_claim() below, which re-checks the shift
-- is still claimable under a row lock. Concurrent approvals: exactly one wins.

-- ---------------------------------------------------------------------------
-- shift — the swap columns (M8 §6). The status enum already covers every state.
-- ---------------------------------------------------------------------------
alter table public.shift
  add column drop_requested_by  uuid references public.app_user (id) on delete set null,
  add column drop_reason        text,
  add column drop_requested_at  timestamptz,
  -- who the shift was rostered to before any swap, for audit (M8 §6)
  add column original_user_id   uuid references public.app_user (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Controlled vocabularies
-- ---------------------------------------------------------------------------
create type public.claim_outcome as enum ('pending', 'approved', 'rejected', 'withdrawn');

-- ---------------------------------------------------------------------------
-- shift_claim — "I can cover this" (M8 §3.3, §6). The unique constraint is what
-- makes claiming idempotent under a double-tap or a retried request (M8 §5).
-- ---------------------------------------------------------------------------
create table public.shift_claim (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.business (id) on delete cascade,
  shift_id          uuid not null references public.shift (id) on delete cascade,
  claimant_user_id  uuid not null references public.app_user (id) on delete cascade,
  outcome           public.claim_outcome not null default 'pending',
  created_at        timestamptz not null default now(),
  decided_at        timestamptz,
  decided_by        uuid references public.app_user (id) on delete set null,
  unique (shift_id, claimant_user_id)
);

-- ---------------------------------------------------------------------------
-- shift_swap_event — append-only audit of every transition (M8 §6, M11 §8).
-- Written only by the SECURITY DEFINER RPCs below; no client write policy exists.
-- ---------------------------------------------------------------------------
create table public.shift_swap_event (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.business (id) on delete cascade,
  shift_id       uuid not null references public.shift (id) on delete cascade,
  from_status    public.shift_status,
  to_status      public.shift_status not null,
  action         text not null,
  actor_user_id  uuid references public.app_user (id) on delete set null,
  target_user_id uuid references public.app_user (id) on delete set null,
  note           text,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes for hot paths (the manager's approval screen lists a shift's claims;
-- staff list their own claims; the audit view is per shift).
-- ---------------------------------------------------------------------------
create index idx_shift_claim_shift        on public.shift_claim (shift_id);
create index idx_shift_claim_claimant     on public.shift_claim (claimant_user_id);
create index idx_shift_claim_business     on public.shift_claim (business_id);
create index idx_shift_swap_event_shift   on public.shift_swap_event (shift_id);
create index idx_shift_swap_event_business on public.shift_swap_event (business_id);
create index idx_shift_drop_requested_by  on public.shift (drop_requested_by);

-- ---------------------------------------------------------------------------
-- request_drop — staff drop their OWN assigned shift (M8 §3.1).
-- SECURITY DEFINER because staff have no write policy on shift; authorisation
-- is asserted explicitly here (M11 §5.2: elevated privilege is not permission
-- to skip checks). The dropper stays responsible until the manager acts.
-- ---------------------------------------------------------------------------
create or replace function public.request_drop(p_shift_id uuid, p_reason text default null)
returns public.shift
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid    := public.current_app_user_id();
  v_business uuid    := public.current_business_id();
  v_shift    public.shift;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  select * into v_shift
    from public.shift
   where id = p_shift_id and business_id = v_business
   for update;

  if not found then
    raise exception 'shift not found';
  end if;

  -- Own shift only; a manager uses the roster editor, not this path.
  if v_shift.assigned_user_id is distinct from v_actor then
    raise exception 'you can only drop your own shift';
  end if;

  if v_shift.status <> 'assigned' then
    raise exception 'this shift already has a cover request in progress';
  end if;

  update public.shift
     set status            = 'drop_requested',
         drop_requested_by = v_actor,
         drop_reason       = p_reason,
         drop_requested_at = now(),
         original_user_id  = coalesce(original_user_id, v_actor)
   where id = p_shift_id
  returning * into v_shift;

  insert into public.shift_swap_event
    (business_id, shift_id, from_status, to_status, action, actor_user_id, note)
  values (v_business, p_shift_id, 'assigned', 'drop_requested', 'request_drop', v_actor, p_reason);

  return v_shift;
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_shift — "I can cover this" (M8 §3.3). Transactional and idempotent: a
-- claim is only recorded while the shift is still open/claimed_pending, and a
-- double-tap yields ONE claim row, not two (M8 §5).
-- ---------------------------------------------------------------------------
create or replace function public.claim_shift(p_shift_id uuid)
returns public.shift_claim
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid := public.current_app_user_id();
  v_business uuid := public.current_business_id();
  v_shift    public.shift;
  v_claim    public.shift_claim;
  v_from     public.shift_status;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  select * into v_shift
    from public.shift
   where id = p_shift_id and business_id = v_business
   for update;

  if not found then
    raise exception 'shift not found';
  end if;

  if v_shift.status not in ('open', 'claimed_pending') then
    raise exception 'sorry, this shift has already been filled';
  end if;

  v_from := v_shift.status;

  insert into public.shift_claim (business_id, shift_id, claimant_user_id)
  values (v_business, p_shift_id, v_actor)
  on conflict (shift_id, claimant_user_id) do nothing
  returning * into v_claim;

  -- Idempotent: a retry returns the existing claim rather than erroring.
  if v_claim.id is null then
    select * into v_claim
      from public.shift_claim
     where shift_id = p_shift_id and claimant_user_id = v_actor;
    return v_claim;
  end if;

  if v_from = 'open' then
    update public.shift set status = 'claimed_pending' where id = p_shift_id;
  end if;

  insert into public.shift_swap_event
    (business_id, shift_id, from_status, to_status, action, actor_user_id, target_user_id)
  values (v_business, p_shift_id, v_from, 'claimed_pending', 'claim_shift', v_actor, v_actor);

  return v_claim;
end;
$$;

-- ---------------------------------------------------------------------------
-- approve_claim — THE CRITICAL SECTION (M8 §5, CLAUDE.md rule 3).
--
-- One transaction that:
--   1. asserts the caller is a manager of the shift's business;
--   2. re-reads the shift under `for update` — a concurrent approval BLOCKS
--      here and only proceeds once the first has committed;
--   3. asserts the status is STILL 'open' or 'claimed_pending', so the loser of
--      a race fails cleanly with 'shift is no longer available' rather than
--      silently overwriting the winner;
--   4. reassigns the shift and sets status → 'assigned';
--   5. marks the winning claim 'approved' and every other pending claim
--      'rejected';
--   6. writes the audit event.
-- Concurrent approvals therefore produce exactly one winner.
--
-- Note: re-validating the claimant against the M5 §5.1 hard constraints is
-- mandatory before approval (M8 §5) and is performed by the shared eligibility
-- logic in the app layer, which surfaces the warnings the manager must see
-- (M8 §4). This function is the transactional gate, not the rules engine.
-- ---------------------------------------------------------------------------
create or replace function public.approve_claim(p_shift_id uuid, p_claim_id uuid)
returns public.shift
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid := public.current_app_user_id();
  v_business uuid := public.current_business_id();
  v_shift    public.shift;
  v_claimant uuid;
  v_from     public.shift_status;
begin
  if v_actor is null or not public.is_manager() then
    raise exception 'only a manager can approve a claim';
  end if;

  -- Serialise concurrent approvals on this shift.
  select * into v_shift
    from public.shift
   where id = p_shift_id and business_id = v_business
   for update;

  if not found then
    raise exception 'shift not found';
  end if;

  -- Re-check AFTER acquiring the lock: this is what makes exactly one win.
  if v_shift.status not in ('open', 'claimed_pending') then
    raise exception 'shift is no longer available';
  end if;

  select claimant_user_id into v_claimant
    from public.shift_claim
   where id = p_claim_id
     and shift_id = p_shift_id
     and business_id = v_business
     and outcome = 'pending';

  if not found then
    raise exception 'claim is no longer pending';
  end if;

  v_from := v_shift.status;

  update public.shift
     set assigned_user_id = v_claimant,
         status           = 'assigned',
         original_user_id = coalesce(original_user_id, v_shift.assigned_user_id)
   where id = p_shift_id
  returning * into v_shift;

  -- Winner approved, every other pending claim rejected — in the same statement.
  -- The branches are cast explicitly: a bare CASE resolves to text, which will
  -- not assign to a claim_outcome column.
  update public.shift_claim
     set outcome    = case
                        when id = p_claim_id then 'approved'::public.claim_outcome
                        else 'rejected'::public.claim_outcome
                      end,
         decided_at = now(),
         decided_by = v_actor
   where shift_id = p_shift_id
     and outcome  = 'pending';

  insert into public.shift_swap_event
    (business_id, shift_id, from_status, to_status, action, actor_user_id, target_user_id)
  values (v_business, p_shift_id, v_from, 'assigned', 'approve_claim', v_actor, v_claimant);

  return v_shift;
end;
$$;

grant execute on function public.request_drop(uuid, text)   to authenticated;
grant execute on function public.claim_shift(uuid)          to authenticated;
grant execute on function public.approve_claim(uuid, uuid)  to authenticated;

-- ---------------------------------------------------------------------------
-- RLS (M8 §6 / M11 §5.1).
--   shift_claim      — managers all in business; staff see and create only
--                      their OWN claims. Deciding an outcome is manager-only
--                      (and in practice happens inside approve_claim).
--   shift_swap_event — managers read the whole business audit; staff read only
--                      the events they are a party to (actor or target), which
--                      is what M7 needs to show "your cover request" history.
--                      There is deliberately NO client write policy: the audit
--                      is append-only via the SECURITY DEFINER RPCs, so it
--                      cannot be forged or edited (M11 §8).
-- ---------------------------------------------------------------------------
alter table public.shift_claim      enable row level security;
alter table public.shift_swap_event enable row level security;

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

create policy shift_claim_write_manager on public.shift_claim
  for all to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());

create policy shift_swap_event_select on public.shift_swap_event
  for select to authenticated
  using (
    business_id = public.current_business_id()
    and (
      public.is_manager()
      or actor_user_id  = public.current_app_user_id()
      or target_user_id = public.current_app_user_id()
    )
  );

-- Grants for the new tables (the blanket grant in 0002 only covered tables that
-- existed then; new tables need their own).
grant select, insert, update, delete on public.shift_claim to authenticated;
grant select                          on public.shift_swap_event to authenticated;
grant all on public.shift_claim, public.shift_swap_event to service_role;
