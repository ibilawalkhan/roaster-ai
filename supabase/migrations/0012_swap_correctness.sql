-- Rosterly 0012 — correctness fixes on the swap flow, from the market-readiness
-- review (docs/MARKET_READINESS.md). Each was proved empirically against the
-- real policies, not inferred.
--
--   1. Only the FIRST person could ever claim an open shift. 0011 exposed only
--      `status = 'open'` to staff, but claim_shift flips the shift to
--      'claimed_pending' on the first claim — so it vanished from everyone
--      else's phone. "Two claim → manager picks one" (M8 §3.3, REQUIREMENTS
--      §5.3) was impossible. This is a regression introduced by 0011.
--
--   2. Direct reassignment left pending claims dangling forever: volunteers'
--      phones said "waiting for manager" indefinitely and one might turn up.
--      That is precisely the ownership ambiguity M8 §1 calls the invariant that
--      matters most.
--
--   3. request_drop had no guard against dropping a shift that has already
--      started, or one in a draft roster the staff member cannot even see.
--
--   4. claim_shift enforced NO eligibility — a Front-of-House-only worker could
--      claim a Kitchen shift by calling the RPC directly.

-- ---------------------------------------------------------------------------
-- 1. Open shifts stay visible while claims accumulate
-- ---------------------------------------------------------------------------
drop policy if exists shift_select on public.shift;

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
      -- A shift being covered stays visible to the team for as long as it is
      -- still up for grabs — 'claimed_pending' means "someone has offered",
      -- NOT "taken". The manager still chooses (M8 §3.3).
      or (
        status in ('open', 'claimed_pending')
        and exists (
          select 1 from public.roster r
          where r.id = shift.roster_id and r.status = 'published'
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. request_drop: guard past shifts and unpublished rosters
-- ---------------------------------------------------------------------------
-- Signature must match 0007 exactly, including the default — Postgres refuses
-- to drop a parameter default via CREATE OR REPLACE.
create or replace function public.request_drop(p_shift_id uuid, p_reason text default null)
returns public.shift
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_business uuid := public.current_business_id();
  v_shift public.shift;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;

  select * into v_shift from public.shift
   where id = p_shift_id and business_id = v_business for update;
  if not found then raise exception 'shift not found'; end if;

  if v_shift.assigned_user_id is distinct from v_actor then
    raise exception 'you can only drop your own shift';
  end if;

  if v_shift.status <> 'assigned' then
    raise exception 'this shift already has a cover request';
  end if;

  -- A roster the staff member cannot even see must not be droppable.
  if not exists (
    select 1 from public.roster r
    where r.id = v_shift.roster_id and r.status = 'published'
  ) then
    raise exception 'shift not found';
  end if;

  -- Dropping a shift that has already started is meaningless, and dropping one
  -- about to start is a phone call, not an app action (M8 §3.1 cutoff). The
  -- 4-hour business rule is enforced in the UI; this is the hard backstop.
  if v_shift.start_at <= now() then
    raise exception 'this shift has already started — speak to your manager';
  end if;

  update public.shift
     set status            = 'drop_requested',
         drop_requested_by = v_actor,
         drop_reason       = nullif(btrim(coalesce(p_reason, '')), ''),
         drop_requested_at = now(),
         original_user_id  = coalesce(original_user_id, v_actor)
   where id = p_shift_id
  returning * into v_shift;

  insert into public.shift_swap_event
    (business_id, shift_id, from_status, to_status, action, actor_user_id, target_user_id, note)
  values (v_business, p_shift_id, 'assigned', 'drop_requested', 'request_drop',
          v_actor, v_actor, v_shift.drop_reason);

  return v_shift;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. claim_shift: enforce the eligibility that is decidable in SQL
-- ---------------------------------------------------------------------------
-- Role capability, active staff, location and time-overlap are hard facts the
-- database owns, so it enforces them — the RPC is a public surface and must not
-- rely on the UI having filtered the list. Availability stays app-side (it is
-- resolved by the one shared function, M3 §6/TECH_STACK §7); duplicating that
-- resolution in SQL is the drift this project deliberately avoids.

create or replace function public.claim_shift(p_shift_id uuid)
returns public.shift_claim
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_business uuid := public.current_business_id();
  v_shift public.shift;
  v_me public.app_user;
  v_claim public.shift_claim;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;

  select * into v_shift from public.shift
   where id = p_shift_id and business_id = v_business for update;
  if not found then raise exception 'shift not found'; end if;

  -- Wording preserved from 0007: the app maps this exact message to
  -- "Sorry, this shift has already been filled."
  if v_shift.status not in ('open', 'claimed_pending') then
    raise exception 'sorry, this shift has already been filled';
  end if;

  select * into v_me from public.app_user where id = v_actor;
  if not found or not v_me.active then
    raise exception 'your account is not active';
  end if;

  -- You cannot cover your own dropped shift.
  if v_shift.assigned_user_id = v_actor then
    raise exception 'this is already your shift';
  end if;

  -- H1: you must hold the role.
  if not exists (
    select 1 from public.user_role ur
    where ur.user_id = v_actor and ur.role_id = v_shift.role_id
  ) then
    raise exception 'you are not signed off for that role';
  end if;

  -- H9: location eligibility.
  if not v_me.can_work_other_locations
     and v_me.home_location_id is distinct from v_shift.location_id then
    raise exception 'that shift is at a different location';
  end if;

  -- H10: required level, when the position specifies one.
  if v_shift.roster_position_id is not null then
    perform 1 from public.roster_position rp
      where rp.id = v_shift.roster_position_id
        and rp.required_level is not null
        and rp.required_level <> v_me.level;
    if found then
      raise exception 'that shift needs a different level of experience';
    end if;
  end if;

  -- H3: no overlapping shift of your own.
  if exists (
    select 1 from public.shift s
    where s.assigned_user_id = v_actor
      and s.id <> p_shift_id
      and s.start_at < v_shift.end_at
      and s.end_at   > v_shift.start_at
  ) then
    raise exception 'you are already rostered on a shift that overlaps this one';
  end if;

  -- Idempotent: a double-tap or retry yields one claim, never two (M8 §5).
  insert into public.shift_claim (business_id, shift_id, claimant_user_id, outcome)
  values (v_business, p_shift_id, v_actor, 'pending')
  on conflict (shift_id, claimant_user_id) do nothing;

  select * into v_claim from public.shift_claim
   where shift_id = p_shift_id and claimant_user_id = v_actor;

  if v_shift.status = 'open' then
    update public.shift set status = 'claimed_pending' where id = p_shift_id;
    insert into public.shift_swap_event
      (business_id, shift_id, from_status, to_status, action, actor_user_id, target_user_id)
    values (v_business, p_shift_id, 'open', 'claimed_pending', 'claim_shift', v_actor, v_actor);
  end if;

  return v_claim;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Direct reassignment — atomic, and it never orphans a claim
-- ---------------------------------------------------------------------------
create or replace function public.reassign_shift(p_shift_id uuid, p_user_id uuid)
returns public.shift
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_business uuid := public.current_business_id();
  v_shift public.shift;
  v_from public.shift_status;
begin
  if v_actor is null or not public.is_manager() then
    raise exception 'only a manager can reassign a shift';
  end if;

  select * into v_shift from public.shift
   where id = p_shift_id and business_id = v_business for update;
  if not found then raise exception 'shift not found'; end if;

  if not exists (
    select 1 from public.app_user u
    where u.id = p_user_id and u.business_id = v_business and u.active
  ) then
    raise exception 'that person is not an active member of your team';
  end if;

  v_from := v_shift.status;

  -- The snapshot follows the person who ends up on the shift (M10 §2.1, §8):
  -- a senior covering a junior's shift genuinely costs more, and the report
  -- must show that. Without this the cost silently stays at the dropper's rate.
  update public.shift
     set assigned_user_id  = p_user_id,
         status            = 'assigned',
         origin            = 'manual',
         pay_rate_snapshot = (select u.pay_rate from public.app_user u where u.id = p_user_id),
         original_user_id  = coalesce(original_user_id, v_shift.assigned_user_id),
         drop_requested_by = null,
         drop_reason       = null,
         drop_requested_at = null
   where id = p_shift_id
  returning * into v_shift;

  -- Nobody is left believing they might still be given this shift.
  update public.shift_claim
     set outcome = 'rejected'::public.claim_outcome,
         decided_at = now(), decided_by = v_actor
   where shift_id = p_shift_id and outcome = 'pending';

  insert into public.shift_swap_event
    (business_id, shift_id, from_status, to_status, action, actor_user_id, target_user_id)
  values (v_business, p_shift_id, v_from, 'assigned', 'reassign_shift', v_actor, p_user_id);

  return v_shift;
end;
$$;

grant execute on function public.request_drop(uuid, text) to authenticated;
grant execute on function public.claim_shift(uuid) to authenticated;
grant execute on function public.reassign_shift(uuid, uuid) to authenticated;
