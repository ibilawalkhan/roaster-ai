-- Local-dev seed for the M1 foundation, run by `supabase db reset`
-- (REQUIREMENTS §11 D1–2: two businesses to prove isolation early). NOT run in
-- staging/production. roster/shift seeding returns with M4/M5.
--
-- Auth users are NOT seeded here; app_user rows carry a phone with
-- auth_user_id = NULL and are linked on first phone-OTP login by
-- link_current_user() (M11 §3.2). Log in with a seeded phone + the local test
-- OTP (config.toml [auth.sms.test_otp]).

-- ── Tenants ───────────────────────────────────────────────────────────────
insert into public.business (id, name, logo_initial) values
  ('00000000-0000-0000-0000-0000000000a1', 'Al Tazah Charcoal Chicken', 'A'),
  ('00000000-0000-0000-0000-0000000000b1', 'Guildford Restaurant', 'G');

insert into public.location (id, business_id, name) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'Regents Park'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a1', 'Wollongong'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1', 'Guildford');

insert into public.role (id, business_id, name, short_code, colour) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Kitchen',        'KIT', 'herb'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1', 'Front of House', 'FOH', 'saffron'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a1', 'Driver',         'DRV', 'teal'),
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000a1', 'Manager',        'MGR', 'ember'),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'Kitchen',        'KIT', 'herb'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b1', 'Manager',        'MGR', 'ember');

-- Default scheduling rules (all M1 §3.6 defaults) and break tiers (M1 §3.7).
insert into public.scheduling_rule (business_id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b1');

insert into public.break_rule (business_id, min_hours, max_hours, break_minutes) values
  ('00000000-0000-0000-0000-0000000000a1', 0, 5, 0),
  ('00000000-0000-0000-0000-0000000000a1', 5, 8, 30),
  ('00000000-0000-0000-0000-0000000000a1', 8, null, 45);

-- Trading hours: Al Tazah Regents Park open Mon–Sun 10:00–22:30.
insert into public.trading_hours (business_id, location_id, day_of_week, opens_at, closes_at)
select '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', d, '10:00', '22:30'
from generate_series(0, 6) as d;

-- ── People (phones match test OTPs in config.toml) ────────────────────────
insert into public.app_user
  (business_id, name, is_manager, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'Khaled Nasser', true,  'senior', 'full_time', 38, '00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000a2', 'ember',   '61400000001', 'khaled@altazah.com.au'),
  ('00000000-0000-0000-0000-0000000000a1', 'Sara Haddad',   false, 'mid',    'part_time', 30, '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a2', 'herb',    '61400000002', 'sara.h@altazah.com.au'),
  ('00000000-0000-0000-0000-0000000000a1', 'Ahmed Khan',    false, 'mid',    'casual',    28, '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a2', 'saffron', '61400000003', 'ahmed.k@altazah.com.au'),
  ('00000000-0000-0000-0000-0000000000a1', 'Omar Farouk',   false, 'junior', 'casual',    26, '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a4', 'teal',    '61400000005', 'omar.f@altazah.com.au'),
  ('00000000-0000-0000-0000-0000000000b1', 'Guildford Manager', true, 'senior', 'full_time', 40, '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b2', 'clay', '61400000004', 'manager@guildford.com.au');

-- Roles each person can work (M2 user_role). Primary role at minimum.
insert into public.user_role (business_id, user_id, role_id)
select a.business_id, a.id, a.primary_role_id from public.app_user a where a.primary_role_id is not null;
