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

-- Availability (M3): Sara works evenings Mon–Fri, off weekends; a sample.
insert into public.availability_pattern (business_id, user_id, day_of_week, is_available, from_time, to_time)
select a.business_id, a.id, d.dow, d.avail, d.f, d.t
from public.app_user a
cross join (values
  (1, true,  '16:00'::time, '23:00'::time),
  (2, true,  '16:00'::time, '23:00'::time),
  (3, true,  null::time,    null::time),
  (4, true,  '16:00'::time, '23:00'::time),
  (5, true,  '16:00'::time, '23:00'::time),
  (6, false, null::time,    null::time),
  (0, false, null::time,    null::time)
) as d(dow, avail, f, t)
where a.phone = '61400000002';

-- ── Week template (M4) ──────────────────────────────────────────────────────
-- Al Tazah's one default template (MVP ships exactly one — M4 §4.5). A minimal
-- but realistic Regents Park week: a Kitchen + FOH day slot each weekday, with a
-- second Kitchen closing shift and an extra FOH hand on the busy Fri/Sat.
insert into public.week_template (id, business_id, name, is_default) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Normal week', true);

-- Weekday base (Mon–Fri = dow 1..5): open Kitchen + FOH, plus a Kitchen close.
insert into public.template_slot
  (business_id, template_id, location_id, day_of_week, role_id, start_time, end_time, count, required_level, label)
select
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000e1',
  '00000000-0000-0000-0000-0000000000a2',
  d.dow, s.role_id, s.start_time, s.end_time, s.count, s.required_level, s.label
from generate_series(1, 5) as d(dow)
cross join (values
  ('00000000-0000-0000-0000-0000000000c1'::uuid, '10:00'::time, '18:00'::time, 1, null::public.user_level, 'open'),
  ('00000000-0000-0000-0000-0000000000c2'::uuid, '11:00'::time, '19:00'::time, 1, null::public.user_level, 'lunch'),
  ('00000000-0000-0000-0000-0000000000c1'::uuid, '16:00'::time, '22:30'::time, 1, 'senior'::public.user_level, 'close')
) as s(role_id, start_time, end_time, count, required_level, label);

-- Busy Fri/Sat (dow 5,6): an extra FOH hand for the evening rush.
insert into public.template_slot
  (business_id, template_id, location_id, day_of_week, role_id, start_time, end_time, count, label)
select
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000e1',
  '00000000-0000-0000-0000-0000000000a2',
  d.dow, '00000000-0000-0000-0000-0000000000c2', '17:00'::time, '22:30'::time, 2, 'dinner rush'
from (values (5), (6)) as d(dow);

-- ── Roster (M5) ─────────────────────────────────────────────────────────────
-- One draft roster for Al Tazah's Regents Park week beginning Mon 2026-08-03,
-- seeded from the Normal week template. Timestamps are UTC (August = AEST +10, no
-- DST); the wall-clock times below are Australia/Sydney and converted on insert.
insert into public.roster (id, business_id, location_scope, start_date, days, status, template_id)
values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000a2', '2026-08-03', 7, 'draft',
        '00000000-0000-0000-0000-0000000000e1');

-- Three concrete Monday requirements copied from the template (M5 §9).
insert into public.roster_position
  (id, business_id, roster_id, location_id, date, role_id, start_at, end_at, required_level, label)
values
  ('00000000-0000-0000-0000-000000000f11', '00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2',
   '2026-08-03', '00000000-0000-0000-0000-0000000000c1',
   '2026-08-03 10:00 Australia/Sydney', '2026-08-03 18:00 Australia/Sydney', null, 'open'),
  ('00000000-0000-0000-0000-000000000f12', '00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2',
   '2026-08-03', '00000000-0000-0000-0000-0000000000c2',
   '2026-08-03 11:00 Australia/Sydney', '2026-08-03 19:00 Australia/Sydney', null, 'lunch'),
  ('00000000-0000-0000-0000-000000000f13', '00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2',
   '2026-08-03', '00000000-0000-0000-0000-0000000000c1',
   '2026-08-03 16:00 Australia/Sydney', '2026-08-03 22:30 Australia/Sydney', 'senior', 'close');

-- Two of the three positions filled by seeded staff (Sara → Kitchen open,
-- Ahmed → FOH lunch); the senior close stays unfilled (a first-class gap, M5 §5.2).
insert into public.shift
  (business_id, roster_id, roster_position_id, location_id, date, start_at, end_at,
   break_minutes, role_id, assigned_user_id, origin, pay_rate_snapshot)
select
  '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1',
  s.position_id, '00000000-0000-0000-0000-0000000000a2', '2026-08-03',
  s.start_at, s.end_at, s.brk, s.role_id, a.id, 'auto', a.pay_rate
from (values
  ('00000000-0000-0000-0000-000000000f11'::uuid, '2026-08-03 10:00 Australia/Sydney'::timestamptz,
   '2026-08-03 18:00 Australia/Sydney'::timestamptz, 30, '00000000-0000-0000-0000-0000000000c1'::uuid, '61400000002'),
  ('00000000-0000-0000-0000-000000000f12'::uuid, '2026-08-03 11:00 Australia/Sydney'::timestamptz,
   '2026-08-03 19:00 Australia/Sydney'::timestamptz, 30, '00000000-0000-0000-0000-0000000000c2'::uuid, '61400000003')
) as s(position_id, start_at, end_at, brk, role_id, phone)
join public.app_user a on a.phone = s.phone;
