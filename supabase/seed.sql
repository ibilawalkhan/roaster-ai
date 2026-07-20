-- Local-dev seed, run automatically by `supabase db reset` 
-- §11 D1–2: "seed 2 businesses to prove isolation early"). NOT run in
-- staging/production — real tenants are created by the sign-up seed script.
--
-- Auth users are NOT seeded here (creating GoTrue users via raw SQL is brittle).
-- app_user rows carry a phone with auth_user_id = NULL; on first phone-OTP login
-- the auth user is created and linked by link_current_user(). Log in with a
-- seeded phone below + the local test OTP (config.toml [auth.sms.test_otp]).

-- ── Tenants ───────────────────────────────────────────────────────────────
insert into public.business (id, name, logo_initial) values
  ('00000000-0000-0000-0000-0000000000a1', 'Al Tazah Charcoal Chicken', 'A'),
  ('00000000-0000-0000-0000-0000000000b1', 'Guildford Restaurant', 'G');

insert into public.location (id, business_id, name) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'Regents Park'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a1', 'Wollongong'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1', 'Guildford');

-- ── People (phones match test OTPs in config.toml) ────────────────────────
insert into public.app_user
  (id, business_id, name, role, position, employment_type, pay_rate, home_location_id, colour, phone, email) values
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000a1', 'Khaled Nasser', 'manager', 'Manager',        'full-time', 38, '00000000-0000-0000-0000-0000000000a2', 'ember',   '61400000001', 'khaled@altazah.com.au'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000a1', 'Sara Haddad',   'staff',   'Kitchen',        'part-time', 30, '00000000-0000-0000-0000-0000000000a2', 'herb',    '61400000002', 'sara.h@altazah.com.au'),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000a1', 'Ahmed Khan',    'staff',   'Front of House', 'casual',    28, '00000000-0000-0000-0000-0000000000a2', 'saffron', '61400000003', 'ahmed.k@altazah.com.au'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-0000000000a1', 'Omar Farouk',   'staff',   'Driver',         'casual',    26, '00000000-0000-0000-0000-0000000000a4', 'teal',    '61400000005', 'omar.f@altazah.com.au'),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000b1', 'Guildford Manager', 'manager', 'Manager',     'full-time', 40, '00000000-0000-0000-0000-0000000000b2', 'clay',    '61400000004', 'manager@guildford.com.au');

-- ── Rosters (fortnight starting Mon 2026-07-20) ───────────────────────────
insert into public.roster (id, business_id, fortnight_start, status) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a1', '2026-07-20', 'published'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b1', '2026-07-20', 'draft');

-- ── Shifts for Al Tazah (both weeks) ──────────────────────────────────────
insert into public.shift
  (business_id, roster_id, location_id, assigned_user_id, date, start_time, end_time, break_minutes, role, status) values
  -- Week 1
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a5', '2026-07-20', '10:00', '18:00', 45, 'Manager',        'ASSIGNED'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a6', '2026-07-20', '10:00', '16:30', 30, 'Kitchen',        'ASSIGNED'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a7', '2026-07-20', '16:00', '22:30', 30, 'Front of House', 'ASSIGNED'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a6', '2026-07-22', '10:00', '16:30', 30, 'Kitchen',        'ASSIGNED'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a7', '2026-07-23', '16:00', '22:30', 30, 'Front of House', 'ASSIGNED'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a8', '2026-07-24', '15:30', '22:30', 30, 'Driver',         'ASSIGNED'),
  -- Week 2
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a5', '2026-07-27', '10:00', '18:00', 45, 'Manager',        'ASSIGNED'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a6', '2026-07-27', '10:00', '16:30', 30, 'Kitchen',        'ASSIGNED'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a7', '2026-07-29', '16:00', '22:30', 30, 'Front of House', 'ASSIGNED');
