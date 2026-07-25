-- User↔staff matching on first login (M11 §3.2).
--
-- The manager pre-creates each app_user with a phone and NULL auth_user_id.
-- On first phone-OTP login this SECURITY DEFINER function matches the caller's
-- verified phone (from auth.users) to an unclaimed, active staff record, links
-- it, and marks the invite active. Idempotent; refuses unknown phones. RLS
-- forbids an authenticated user from claiming a not-yet-linked row directly,
-- which is exactly why this runs as definer.

create or replace function public.link_current_user()
returns public.app_user
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth  uuid := auth.uid();
  v_phone text;
  v_user  public.app_user;
begin
  if v_auth is null then
    raise exception 'not authenticated';
  end if;

  -- Already linked? Return it (idempotent).
  select * into v_user from public.app_user where auth_user_id = v_auth;
  if found then
    return v_user;
  end if;

  select phone into v_phone from auth.users where id = v_auth;

  update public.app_user
     set auth_user_id  = v_auth,
         invite_status = 'active'
   where phone = v_phone
     and auth_user_id is null
     and active = true
  returning * into v_user;

  if not found then
    raise exception 'no active staff record for this phone; ask your manager to add you';
  end if;

  return v_user;
end;
$$;

grant execute on function public.link_current_user() to authenticated;
