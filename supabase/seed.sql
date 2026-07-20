-- Local-dev seed, run automatically by `supabase db reset` (REQUIREMENTS.md
-- §11 D1–2: "seed 2 businesses to prove isolation early"). NOT run in
-- staging/production — real tenants are created by the sign-up seed script.
--
-- Auth users are NOT seeded here: creating GoTrue users via raw SQL is brittle.
-- app_user rows are seeded with auth_user_id = NULL and linked to a real auth
-- user on first phone-OTP login (REQUIREMENTS.md §4). To demo RLS locally,
-- create a user via the Studio Auth UI, then set the matching app_user's
-- auth_user_id. Automated RLS proof lives in the isolation test (no auth needed).

-- Two isolated tenants.
insert into public.business (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Al Tazah Charcoal Chicken'),
  ('00000000-0000-0000-0000-0000000000b1', 'Guildford Restaurant');

insert into public.location (id, business_id, name) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'Regents Park'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1', 'Guildford');

insert into public.app_user
  (business_id, name, role, employment_type, pay_rate, home_location_id, phone) values
  ('00000000-0000-0000-0000-0000000000a1', 'Khaled Nasser', 'manager', 'full-time', 38, '00000000-0000-0000-0000-0000000000a2', '61400000001'),
  ('00000000-0000-0000-0000-0000000000a1', 'Sara Haddad',   'staff',   'part-time', 30, '00000000-0000-0000-0000-0000000000a2', '61400000002'),
  ('00000000-0000-0000-0000-0000000000a1', 'Ahmed Khan',    'staff',   'casual',    27, '00000000-0000-0000-0000-0000000000a2', '61400000003'),
  ('00000000-0000-0000-0000-0000000000b1', 'Guildford Manager', 'manager', 'full-time', 40, '00000000-0000-0000-0000-0000000000b2', '61400000004');

insert into public.roster (id, business_id, fortnight_start, status) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a1', '2026-07-20', 'draft'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b1', '2026-07-20', 'draft');
