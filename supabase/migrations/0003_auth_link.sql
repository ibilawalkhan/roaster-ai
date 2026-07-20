-- User↔staff matching on first login.
--
-- A manager pre-creates each staff record (app_user) with their phone and a
-- NULL auth_user_id. On first phone-OTP login the auth user must be linked to
-- that record. RLS forbids an authenticated user from writing a row that isn't
-- yet theirs (app_user_update_own requires auth_user_id = auth.uid()), so the
-- link is performed by this SECURITY DEFINER function: it matches the caller's
-- verified phone (from auth.users) to an unlinked app_user and claims it.

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

  -- Already linked? Return the existing record (idempotent).
  select * into v_user from public.app_user where auth_user_id = v_auth;
  if found then
    return v_user;
  end if;

  -- Match the caller's verified phone to an unclaimed staff record.
  select phone into v_phone from auth.users where id = v_auth;

  update public.app_user
     set auth_user_id = v_auth
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
