-- Payment enforcement (REQUIREMENTS.md §1.1, M11 §9).
--
-- `business.subscription_status` existed from 0001 but gated nothing: a
-- suspended customer had full use of the product. This makes it real.
--
-- WHAT IS BLOCKED — writes only, and only for `suspended`.
--   · reads are untouched. A staff member must not lose sight of tomorrow's
--     shift because the owner's invoice is late; the spec is explicit that data
--     stays intact and staff keep a read-only view. Punishing the team for the
--     owner's billing would be the wrong behaviour.
--   · `trial` and `past_due` still write. Past-due is a conversation, not a
--     shutdown — cutting a restaurant off mid-week over an overdue invoice
--     would do more commercial damage than the unpaid amount.
--   · `service_role` and the database owner are never blocked, so the cron
--     sweep, the notification worker, seed scripts and manual repair all keep
--     working while an account is suspended. Reinstating must never require
--     first undoing a lockout.
--
-- Enforced with triggers rather than by rewriting every RLS policy: the check
-- is orthogonal to "who may touch this row", and keeping the two separate means
-- a future policy change cannot accidentally drop the billing gate.

-- ---------------------------------------------------------------------------
-- Is this business suspended? SECURITY DEFINER so the check works regardless of
-- the caller's own visibility of the business row.
-- ---------------------------------------------------------------------------
create or replace function public.business_is_suspended(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select subscription_status = 'suspended'
       from public.business where id = p_business_id),
    false
  );
$$;

grant execute on function public.business_is_suspended(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The guard. Attached to every table that represents *using* the product.
-- ---------------------------------------------------------------------------
-- NOT security definer, deliberately: inside a definer function `current_user`
-- is the function owner, so the "trusted server code is exempt" check below
-- would match every caller and the gate would never fire. It does not need
-- elevated rights anyway — business_is_suspended() is the definer that reads
-- the business row. (Same reasoning as guard_app_user_update in 0002.)
create or replace function public.guard_suspended_business()
returns trigger
language plpgsql
as $$
declare
  v_business uuid;
begin
  -- Trusted server code is exempt: it must be able to operate ON a suspended
  -- account (and to reinstate it).
  if current_user <> 'authenticated' then
    return coalesce(new, old);
  end if;

  v_business := coalesce(
    case when new is null then null else (to_jsonb(new) ->> 'business_id')::uuid end,
    case when old is null then null else (to_jsonb(old) ->> 'business_id')::uuid end
  );

  if v_business is not null and public.business_is_suspended(v_business) then
    raise exception
      'This account is suspended. Please contact us to reactivate it.'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- Attach to the mutable business tables. Read-only surfaces (notification,
-- shift_swap_event, roster_change_log) are deliberately excluded: they are
-- written by trusted code, which is exempt anyway.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  targets text[] := array[
    'location', 'role', 'trading_hours', 'scheduling_rule', 'break_rule',
    'app_user', 'user_role',
    'availability_pattern', 'availability_exception',
    'week_template', 'template_slot',
    'roster', 'roster_position', 'shift', 'shift_claim'
  ];
begin
  foreach t in array targets loop
    execute format(
      'create trigger trg_%1$s_subscription_gate
         before insert or update or delete on public.%1$I
         for each row execute function public.guard_suspended_business()', t);
  end loop;
end
$$;
