-- Rosterly 0011 — make the swap flow and colleague view actually reachable.
--
-- Three gaps surfaced once M7 (staff app) and M8 (swaps) were built on top of
-- the 0006 policies. Each is a case where the feature was correct in the app but
-- unreachable at the database, which is the right way round to discover it.
--
--   1. Staff could never see an OPEN shift. `shift_select` only admitted a
--      non-manager's OWN assigned shift, but an open shift is still assigned to
--      the dropper — so "Shifts available to cover" was always empty and the
--      whole claim half of M8 was inert.
--
--   2. Staff could not see who else is on (M7 §3.2), because reading a
--      colleague's shift row is (correctly) forbidden.
--
--   3. Manager-side swap transitions (decline / open to team / cancel) had no
--      way to append to the audit trail: `shift_swap_event` had no INSERT
--      policy at all.

-- ---------------------------------------------------------------------------
-- 1. Open shifts are visible to the whole business (M8 §3.3)
-- ---------------------------------------------------------------------------
-- Widen shift_select: a member may also read a shift that is OPEN in a
-- published roster of their business.
--
-- Why this scope, deliberately: full eligibility (role, location, availability,
-- overlap) is resolved by ONE shared function in the app (TECH_STACK §7, M3 §6).
-- Re-implementing it in SQL would create a second copy that silently drifts —
-- the exact failure that rule exists to prevent. So the database exposes the
-- narrow, non-sensitive fact "this shift is going" (its time, role and
-- location — things a person is told the moment they're offered it) and the app
-- filters the list to those who may validly take it. No wage, no contact
-- detail, and no other person's assignment is reachable through this: an open
-- shift by definition is one the business wants covered.

drop policy if exists shift_select on public.shift;

create policy shift_select on public.shift
  for select to authenticated
  using (
    business_id = public.current_business_id()
    and (
      public.is_manager()
      -- Own shift, published roster only (drafts stay invisible — M11 §6 #9).
      or (
        assigned_user_id = public.current_app_user_id()
        and exists (
          select 1 from public.roster r
          where r.id = shift.roster_id and r.status = 'published'
        )
      )
      -- An open shift in a published roster, offered to the team.
      or (
        status = 'open'
        and exists (
          select 1 from public.roster r
          where r.id = shift.roster_id and r.status = 'published'
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Who else is on (M7 §3.2) — name and job role ONLY
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because reading a colleague's shift/app_user row is rightly
-- forbidden by RLS. The function is the entire permitted surface: it returns
-- name + role_id and nothing else — never a pay rate, phone, email or hours.
-- The caller must be rostered on the shift themselves, so this cannot be used
-- to enumerate the team.

create or replace function public.colleagues_on_shift(p_shift_id uuid)
returns table (user_id uuid, name text, role_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me       uuid := public.current_app_user_id();
  v_business uuid := public.current_business_id();
  v_shift    public.shift;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  select * into v_shift
    from public.shift
   where id = p_shift_id and business_id = v_business;

  if not found then
    return;  -- not our business: reveal nothing, not even that it exists
  end if;

  -- Only someone actually on the shift (or a manager) may ask.
  if not public.is_manager() and v_shift.assigned_user_id is distinct from v_me then
    return;
  end if;

  -- Published rosters only — a draft must never leak through this path.
  if not exists (
    select 1 from public.roster r
    where r.id = v_shift.roster_id and r.status = 'published'
  ) then
    return;
  end if;

  return query
    select u.id, u.name, s.role_id
      from public.shift s
      join public.app_user u on u.id = s.assigned_user_id
     where s.business_id      = v_business
       and s.location_id      = v_shift.location_id
       and s.id              <> v_shift.id
       and s.assigned_user_id is not null
       and s.start_at         < v_shift.end_at    -- overlapping in time
       and s.end_at           > v_shift.start_at
       and exists (
         select 1 from public.roster r
         where r.id = s.roster_id and r.status = 'published'
       )
     order by u.name;
end;
$$;

grant execute on function public.colleagues_on_shift(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The remaining swap transitions, as atomic SECURITY DEFINER functions
-- ---------------------------------------------------------------------------
-- Decline / open-to-team / cancel / withdraw were previously plain table
-- UPDATEs from the client, which left them unaudited (there is deliberately no
-- client INSERT policy on shift_swap_event, so the trail cannot be forged) and,
-- in cancel's case, NOT ATOMIC — the status change and the rejection of
-- outstanding claims were two round trips, so a failure between them could
-- leave claimants believing they might still be given the shift.
--
-- Each function below does the state change, any claim clean-up, and the audit
-- row in ONE transaction, matching the approve_claim pattern from 0007. The
-- audit table keeps NO client insert/update/delete policy at all — every row is
-- written by trusted code alongside the change it records (M11 §8).

-- Manager declines: the shift stays with the dropper (M8 §3.2).
create or replace function public.decline_drop(p_shift_id uuid)
returns public.shift
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_business uuid := public.current_business_id();
  v_shift public.shift;
begin
  if v_actor is null or not public.is_manager() then
    raise exception 'only a manager can decline a cover request';
  end if;

  select * into v_shift from public.shift
   where id = p_shift_id and business_id = v_business for update;
  if not found then raise exception 'shift not found'; end if;
  if v_shift.status <> 'drop_requested' then
    raise exception 'shift is no longer available';
  end if;

  update public.shift set status = 'assigned' where id = p_shift_id
  returning * into v_shift;

  insert into public.shift_swap_event
    (business_id, shift_id, from_status, to_status, action, actor_user_id, target_user_id)
  values (v_business, p_shift_id, 'drop_requested', 'assigned', 'decline_drop',
          v_actor, v_shift.assigned_user_id);

  return v_shift;
end;
$$;

-- Manager opens the shift to eligible staff — the ONLY path that makes a
-- dropped shift visible to the team (M8 §1: the manager is the gate).
create or replace function public.open_shift_to_team(p_shift_id uuid)
returns public.shift
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_business uuid := public.current_business_id();
  v_shift public.shift;
begin
  if v_actor is null or not public.is_manager() then
    raise exception 'only a manager can open a shift to the team';
  end if;

  select * into v_shift from public.shift
   where id = p_shift_id and business_id = v_business for update;
  if not found then raise exception 'shift not found'; end if;
  if v_shift.status <> 'drop_requested' then
    raise exception 'shift is no longer available';
  end if;

  -- The dropper stays assigned while it is open, so the shift is never
  -- ownerless (M8 §7, CLAUDE.md rule 4).
  update public.shift set status = 'open' where id = p_shift_id
  returning * into v_shift;

  insert into public.shift_swap_event
    (business_id, shift_id, from_status, to_status, action, actor_user_id, target_user_id)
  values (v_business, p_shift_id, 'drop_requested', 'open', 'open_to_team',
          v_actor, v_shift.assigned_user_id);

  return v_shift;
end;
$$;

-- Manager cancels an open shift, or the dropper withdraws their request.
-- Either way it reverts to the dropper and every outstanding claim is rejected
-- in the SAME transaction (M8 §7).
create or replace function public.cancel_open_shift(p_shift_id uuid)
returns public.shift
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_business uuid := public.current_business_id();
  v_shift public.shift;
  v_action text;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;

  select * into v_shift from public.shift
   where id = p_shift_id and business_id = v_business for update;
  if not found then raise exception 'shift not found'; end if;

  -- A manager may cancel; otherwise only the dropper may withdraw their own.
  if not public.is_manager() then
    if v_shift.drop_requested_by is distinct from v_actor then
      raise exception 'you can only withdraw your own cover request';
    end if;
    v_action := 'withdraw_drop';
  else
    v_action := 'cancel_open_shift';
  end if;

  if v_shift.status not in ('drop_requested', 'open', 'claimed_pending') then
    raise exception 'shift is no longer available';
  end if;

  update public.shift
     set status = 'assigned', drop_requested_by = null,
         drop_reason = null, drop_requested_at = null
   where id = p_shift_id
  returning * into v_shift;

  update public.shift_claim
     set outcome = 'rejected'::public.claim_outcome,
         decided_at = now(), decided_by = v_actor
   where shift_id = p_shift_id and outcome = 'pending';

  insert into public.shift_swap_event
    (business_id, shift_id, from_status, to_status, action, actor_user_id, target_user_id)
  values (v_business, p_shift_id, v_shift.status, 'assigned', v_action,
          v_actor, v_shift.assigned_user_id);

  return v_shift;
end;
$$;

grant execute on function public.decline_drop(uuid) to authenticated;
grant execute on function public.open_shift_to_team(uuid) to authenticated;
grant execute on function public.cancel_open_shift(uuid) to authenticated;
