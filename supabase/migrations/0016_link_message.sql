-- Fix the failed-link message.
--
-- It read "ask your manager to add you", which is nonsense when the person
-- reading it IS the manager — and the manager is exactly who hits this, because
-- they are the first person to sign in at a new business. Telling an owner to
-- go and ask themselves is the kind of small thing that makes software feel
-- like it wasn't written for you.
--
-- The replacement states the actual situation (this login isn't attached to a
-- Rosterly account yet) without guessing who is reading it.

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

  select * into v_user from public.app_user where auth_user_id = v_auth;
  if found then
    return v_user;
  end if;

  select phone, email into v_phone, v_email from auth.users where id = v_auth;

  if v_phone is not null then
    update public.app_user
       set auth_user_id = v_auth, invite_status = 'active'
     where phone = v_phone and auth_user_id is null and active = true
    returning * into v_user;
    if found then
      return v_user;
    end if;
  end if;

  if v_email is not null then
    update public.app_user
       set auth_user_id = v_auth, invite_status = 'active'
     where lower(email) = lower(v_email) and auth_user_id is null and active = true
    returning * into v_user;
    if found then
      return v_user;
    end if;
  end if;

  raise exception
    'This login isn''t connected to a Rosterly account yet. If you own this '
    'business, your account needs setting up; if you work here, your manager '
    'adds you first.';
end;
$$;

grant execute on function public.link_current_user() to authenticated;
