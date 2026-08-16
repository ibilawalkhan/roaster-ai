-- Fix: `required_level` is a MINIMUM, not an exact match.
--
-- The solver has always read it that way (constraints.check_required_level:
-- "a senior may cover a slot that requires a junior; the reverse is blocked"),
-- but `claim_shift` in 0012 compared with `<>`, so a SENIOR volunteering to
-- cover a Mid shift was refused with "that shift needs a different level of
-- experience".
--
-- That is wrong twice over: it contradicts the scheduler about the same shift,
-- and it turns away the most experienced person in the building when they offer
-- to help. Levels express a floor on capability, not a bracket.

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
  -- Same ordering the solver uses (context.LEVEL_RANK).
  v_rank constant jsonb := '{"junior": 1, "mid": 2, "senior": 3}'::jsonb;
  v_need int;
  v_have int;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;

  select * into v_shift from public.shift
   where id = p_shift_id and business_id = v_business for update;
  if not found then raise exception 'shift not found'; end if;

  if v_shift.status not in ('open', 'claimed_pending') then
    raise exception 'sorry, this shift has already been filled';
  end if;

  select * into v_me from public.app_user where id = v_actor;
  if not found or not v_me.active then
    raise exception 'your account is not active';
  end if;

  if v_shift.assigned_user_id = v_actor then
    raise exception 'this is already your shift';
  end if;

  if not exists (
    select 1 from public.user_role ur
    where ur.user_id = v_actor and ur.role_id = v_shift.role_id
  ) then
    raise exception 'you are not signed off for that role';
  end if;

  if not v_me.can_work_other_locations
     and v_me.home_location_id is distinct from v_shift.location_id then
    raise exception 'that shift is at a different location';
  end if;

  -- H10 — required_level is a FLOOR. Anyone at or above it qualifies.
  if v_shift.roster_position_id is not null then
    select (v_rank ->> rp.required_level::text)::int into v_need
      from public.roster_position rp
     where rp.id = v_shift.roster_position_id
       and rp.required_level is not null;

    if v_need is not null then
      v_have := (v_rank ->> v_me.level::text)::int;
      if v_have is null or v_have < v_need then
        raise exception 'that shift needs more experience than your level';
      end if;
    end if;
  end if;

  if exists (
    select 1 from public.shift s
    where s.assigned_user_id = v_actor
      and s.id <> p_shift_id
      and s.start_at < v_shift.end_at
      and s.end_at   > v_shift.start_at
  ) then
    raise exception 'you are already rostered on a shift that overlaps this one';
  end if;

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

grant execute on function public.claim_shift(uuid) to authenticated;
