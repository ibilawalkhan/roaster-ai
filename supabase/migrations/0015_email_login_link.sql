-- Manager email + password sign-in (M11 §3.1).
--
-- `link_current_user` matched the caller's verified PHONE to a pre-created
-- staff record. An email sign-in produces an auth user with an email and no
-- phone, so it could never link — the manager would authenticate successfully
-- and then be told "no active staff record for this phone".
--
-- This widens the match to email as well. The rule is otherwise unchanged and
-- still the important one (M11 §3.2): there is NO self-signup. An address with
-- no pre-created record gains nothing, which is what removes the whole class of
-- account-takeover and spam problems.
--
-- Email is matched case-insensitively — people capitalise inconsistently, and
-- "Khaled@…" failing to find "khaled@…" would be an infuriating bug.

create or replace function public.link_current_user()
returns public.app_user
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth  uuid := auth.uid();
  v_phone text;
  v_email text;
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

  select phone, email into v_phone, v_email from auth.users where id = v_auth;

  -- Phone first: it is the primary identity for staff, and the only one most
  -- of them have on their record.
  if v_phone is not null then
    update public.app_user
       set auth_user_id  = v_auth,
           invite_status = 'active'
     where phone = v_phone
       and auth_user_id is null
       and active = true
    returning * into v_user;

    if found then
      return v_user;
    end if;
  end if;

  -- Then email, for the manager fallback.
  if v_email is not null then
    update public.app_user
       set auth_user_id  = v_auth,
           invite_status = 'active'
     where lower(email) = lower(v_email)
       and auth_user_id is null
       and active = true
    returning * into v_user;

    if found then
      return v_user;
    end if;
  end if;

  raise exception
    'no active account for this login; ask your manager to add you';
end;
$$;

grant execute on function public.link_current_user() to authenticated;

-- Email must be unique within a business, or a login could match two records
-- and the choice would be arbitrary. Partial index: plenty of staff have no
-- email at all, and NULLs must not collide.
create unique index if not exists idx_app_user_business_email
  on public.app_user (business_id, lower(email))
  where email is not null;
