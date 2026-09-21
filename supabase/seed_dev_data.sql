-- supabase/seed_dev_data.sql
-- Run this ONCE in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: uses ON CONFLICT DO NOTHING for all inserts except the roster
-- (which is deleted+recreated so you always get a fresh current week).
--
-- Creates:
--   · Kitchen and Front of House roles (if missing)
--   · 6 staff members across both roles
--   · Trading hours for the full week (if missing)
--   · A week template with realistic Kitchen + FOH slots
--   · A roster for 2026-09-22 (Mon) → 2026-09-28 (Sun) with filled and
--     unfilled positions so both role tabs have visible data
--
-- Timestamps: September 2026 is AEST (UTC+10), no DST.

DO $$
DECLARE
  bid  uuid;   -- business_id
  lid  uuid;   -- location_id
  kid  uuid;   -- Kitchen role id
  fid  uuid;   -- Front of House role id
  tid  uuid;   -- week_template id
  rid  uuid;   -- roster id

  -- staff ids
  s_sara   uuid;
  s_ahmed  uuid;
  s_renu   uuid;
  s_omar   uuid;
  s_minal  uuid;
  s_simran uuid;

  -- loop helpers
  d    date;
  dow  int;
  pos  uuid;
  pos2 uuid;
  pos3 uuid;

BEGIN

-- ── 1. Find business ────────────────────────────────────────────────────────
  SELECT id INTO bid FROM public.business ORDER BY created_at LIMIT 1;
  IF bid IS NULL THEN
    RAISE EXCEPTION 'No business found. Apply migrations first, then add your business.';
  END IF;
  RAISE NOTICE 'Using business %', bid;

-- ── 2. Find / create location ───────────────────────────────────────────────
  SELECT id INTO lid
  FROM   public.location
  WHERE  business_id = bid AND active
  ORDER  BY created_at
  LIMIT  1;

  IF lid IS NULL THEN
    INSERT INTO public.location (business_id, name, address)
    VALUES (bid, 'Main Store', '1 Main Street')
    RETURNING id INTO lid;
    RAISE NOTICE 'Created location %', lid;
  END IF;

-- ── 3. Ensure roles ──────────────────────────────────────────────────────────
  INSERT INTO public.role (business_id, name, short_code, colour)
  VALUES (bid, 'Kitchen',        'KIT', 'herb')
  ON CONFLICT (business_id, name) DO NOTHING;
  SELECT id INTO kid FROM public.role WHERE business_id = bid AND name = 'Kitchen';

  INSERT INTO public.role (business_id, name, short_code, colour)
  VALUES (bid, 'Front of House', 'FOH', 'saffron')
  ON CONFLICT (business_id, name) DO NOTHING;
  SELECT id INTO fid FROM public.role WHERE business_id = bid AND name = 'Front of House';

  RAISE NOTICE 'Kitchen=% FOH=%', kid, fid;

-- ── 4. Ensure scheduling rule ────────────────────────────────────────────────
  INSERT INTO public.scheduling_rule (business_id)
  VALUES (bid)
  ON CONFLICT (business_id) DO NOTHING;

-- ── 5. Trading hours: open 10:00–22:30 Mon–Sun ──────────────────────────────
  INSERT INTO public.trading_hours (business_id, location_id, day_of_week, opens_at, closes_at)
  SELECT bid, lid, d, '10:00'::time, '22:30'::time
  FROM   generate_series(0, 6) AS d
  ON CONFLICT (location_id, day_of_week) DO NOTHING;

-- ── 6. Ensure staff (phone unique per business) ──────────────────────────────
  -- Sara Haddad — Kitchen, senior
  INSERT INTO public.app_user
    (business_id, name, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, is_manager, active)
  VALUES
    (bid, 'Sara Haddad', 'senior', 'part_time', 32.00, kid, lid, 'herb', '61411000001', false, true)
  ON CONFLICT (business_id, phone) DO NOTHING;
  SELECT id INTO s_sara FROM public.app_user WHERE business_id = bid AND phone = '61411000001';

  -- Ahmed Khan — Kitchen + FOH, mid
  INSERT INTO public.app_user
    (business_id, name, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, is_manager, active)
  VALUES
    (bid, 'Ahmed Khan', 'mid', 'casual', 28.00, kid, lid, 'ember', '61411000002', false, true)
  ON CONFLICT (business_id, phone) DO NOTHING;
  SELECT id INTO s_ahmed FROM public.app_user WHERE business_id = bid AND phone = '61411000002';

  -- Renu Sharma — Kitchen, mid
  INSERT INTO public.app_user
    (business_id, name, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, is_manager, active)
  VALUES
    (bid, 'Renu Sharma', 'mid', 'casual', 27.50, kid, lid, 'teal', '61411000003', false, true)
  ON CONFLICT (business_id, phone) DO NOTHING;
  SELECT id INTO s_renu FROM public.app_user WHERE business_id = bid AND phone = '61411000003';

  -- Omar Abbas — FOH, mid
  INSERT INTO public.app_user
    (business_id, name, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, is_manager, active)
  VALUES
    (bid, 'Omar Abbas', 'mid', 'casual', 27.00, fid, lid, 'clay', '61411000004', false, true)
  ON CONFLICT (business_id, phone) DO NOTHING;
  SELECT id INTO s_omar FROM public.app_user WHERE business_id = bid AND phone = '61411000004';

  -- Minal Patel — FOH + Kitchen, mid
  INSERT INTO public.app_user
    (business_id, name, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, is_manager, active)
  VALUES
    (bid, 'Minal Patel', 'mid', 'part_time', 29.00, fid, lid, 'saffron', '61411000005', false, true)
  ON CONFLICT (business_id, phone) DO NOTHING;
  SELECT id INTO s_minal FROM public.app_user WHERE business_id = bid AND phone = '61411000005';

  -- Simran Kaur — FOH, junior
  INSERT INTO public.app_user
    (business_id, name, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, is_manager, active)
  VALUES
    (bid, 'Simran Kaur', 'junior', 'casual', 24.00, fid, lid, 'herb', '61411000006', false, true)
  ON CONFLICT (business_id, phone) DO NOTHING;
  SELECT id INTO s_simran FROM public.app_user WHERE business_id = bid AND phone = '61411000006';

  RAISE NOTICE 'Staff: sara=% ahmed=% renu=% omar=% minal=% simran=%',
    s_sara, s_ahmed, s_renu, s_omar, s_minal, s_simran;

-- ── 7. Assign roles ──────────────────────────────────────────────────────────
  -- Kitchen workers
  INSERT INTO public.user_role (business_id, user_id, role_id)
  VALUES
    (bid, s_sara,   kid),
    (bid, s_ahmed,  kid),
    (bid, s_renu,   kid),
    (bid, s_minal,  kid)   -- Minal can do both
  ON CONFLICT (user_id, role_id) DO NOTHING;

  -- FOH workers
  INSERT INTO public.user_role (business_id, user_id, role_id)
  VALUES
    (bid, s_ahmed,  fid),  -- Ahmed can do both
    (bid, s_omar,   fid),
    (bid, s_minal,  fid),
    (bid, s_simran, fid)
  ON CONFLICT (user_id, role_id) DO NOTHING;

-- ── 8. Availability: all 6 staff available every day ────────────────────────
  INSERT INTO public.availability_pattern (business_id, user_id, day_of_week, is_available)
  SELECT bid, u, d, true
  FROM   unnest(ARRAY[s_sara, s_ahmed, s_renu, s_omar, s_minal, s_simran]) AS u
  CROSS  JOIN generate_series(0, 6) AS d
  ON CONFLICT (user_id, day_of_week) DO NOTHING;

-- ── 9. Week template ─────────────────────────────────────────────────────────
  -- Get existing default template or create one.
  SELECT id INTO tid FROM public.week_template WHERE business_id = bid ORDER BY created_at LIMIT 1;
  IF tid IS NULL THEN
    INSERT INTO public.week_template (business_id, name, is_default)
    VALUES (bid, 'Normal week', true)
    RETURNING id INTO tid;
  END IF;

  -- Replace template slots so re-runs stay idempotent.
  DELETE FROM public.template_slot WHERE template_id = tid;

  -- Mon–Fri base: K-open, K-close(senior), FOH-lunch, FOH-dinner
  INSERT INTO public.template_slot
    (business_id, template_id, location_id, day_of_week, role_id, start_time, end_time, count, required_level, label)
  SELECT bid, tid, lid, d.dow, r.role_id, s.start_t, s.end_t, s.cnt, s.lvl::public.user_level, s.lbl
  FROM   generate_series(1, 5) AS d(dow)
  CROSS  JOIN (VALUES
    ('KIT'::text, '10:00'::time, '18:00'::time, 1, null,     'open'),
    ('KIT',       '16:00'::time, '22:30'::time, 1, 'senior', 'close'),
    ('FOH',       '11:00'::time, '19:00'::time, 1, null,     'lunch'),
    ('FOH',       '17:00'::time, '22:30'::time, 1, null,     'dinner')
  ) AS s(role_code, start_t, end_t, cnt, lvl, lbl)
  CROSS  JOIN LATERAL (
    SELECT CASE s.role_code WHEN 'KIT' THEN kid ELSE fid END AS role_id
  ) AS r;

  -- Fri + Sat: extra FOH hand for dinner rush
  INSERT INTO public.template_slot
    (business_id, template_id, location_id, day_of_week, role_id, start_time, end_time, count, label)
  SELECT bid, tid, lid, d.dow, fid, '17:00'::time, '22:30'::time, 1, 'dinner rush'
  FROM   (VALUES (5), (6)) AS d(dow);

  -- Weekend (Sat+Sun): same base shifts
  INSERT INTO public.template_slot
    (business_id, template_id, location_id, day_of_week, role_id, start_time, end_time, count, required_level, label)
  SELECT bid, tid, lid, d.dow, r.role_id, s.start_t, s.end_t, s.cnt, s.lvl::public.user_level, s.lbl
  FROM   (VALUES (6), (0)) AS d(dow)
  CROSS  JOIN (VALUES
    ('KIT'::text, '10:00'::time, '18:00'::time, 1, null,     'open'),
    ('KIT',       '16:00'::time, '22:30'::time, 1, 'senior', 'close'),
    ('FOH',       '11:00'::time, '19:00'::time, 1, null,     'lunch'),
    ('FOH',       '17:00'::time, '22:30'::time, 1, null,     'dinner')
  ) AS s(role_code, start_t, end_t, cnt, lvl, lbl)
  CROSS  JOIN LATERAL (
    SELECT CASE s.role_code WHEN 'KIT' THEN kid ELSE fid END AS role_id
  ) AS r;

-- ── 10. Roster for week of 2026-09-22 ────────────────────────────────────────
  -- Delete any existing roster for this week so we start fresh.
  DELETE FROM public.roster
  WHERE business_id = bid AND start_date = '2026-09-22';

  INSERT INTO public.roster (business_id, location_scope, start_date, days, status, template_id)
  VALUES (bid, lid, '2026-09-22', 7, 'draft', tid)
  RETURNING id INTO rid;

  RAISE NOTICE 'Roster id=%', rid;

-- ── 11. Positions + shifts ────────────────────────────────────────────────────
-- Helper: insert one position, return its id.
-- Timestamps: AEST = UTC+10 in September.
-- Format: 'YYYY-MM-DD HH24:MI Australia/Sydney'

  -- ── MONDAY 2026-09-22 ──────────────────────────────────────────────────────
  d := '2026-09-22';

  -- Kitchen open  10:00-18:00  → Sara
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
  VALUES (bid, rid, lid, d, kid,
          (d || ' 10:00')::timestamptz AT TIME ZONE 'Australia/Sydney',
          (d || ' 18:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 'open')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id,
    start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, kid,
          (d || ' 10:00')::timestamptz AT TIME ZONE 'Australia/Sydney',
          (d || ' 18:00')::timestamptz AT TIME ZONE 'Australia/Sydney',
          30, s_sara, 'auto', 32.00);

  -- Kitchen close 16:00-22:30  → Ahmed
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, required_level, label)
  VALUES (bid, rid, lid, d, kid,
          (d || ' 16:00')::timestamptz AT TIME ZONE 'Australia/Sydney',
          (d || ' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 'senior', 'close')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id,
    start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, kid,
          (d || ' 16:00')::timestamptz AT TIME ZONE 'Australia/Sydney',
          (d || ' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney',
          0, s_ahmed, 'auto', 28.00);

  -- FOH lunch  11:00-19:00  → Omar
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
  VALUES (bid, rid, lid, d, fid,
          (d || ' 11:00')::timestamptz AT TIME ZONE 'Australia/Sydney',
          (d || ' 19:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 'lunch')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id,
    start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, fid,
          (d || ' 11:00')::timestamptz AT TIME ZONE 'Australia/Sydney',
          (d || ' 19:00')::timestamptz AT TIME ZONE 'Australia/Sydney',
          30, s_omar, 'auto', 27.00);

  -- FOH dinner  17:00-22:30  → Minal
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
  VALUES (bid, rid, lid, d, fid,
          (d || ' 17:00')::timestamptz AT TIME ZONE 'Australia/Sydney',
          (d || ' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 'dinner')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id,
    start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, fid,
          (d || ' 17:00')::timestamptz AT TIME ZONE 'Australia/Sydney',
          (d || ' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney',
          0, s_minal, 'auto', 29.00);

  -- ── TUESDAY 2026-09-23 ─────────────────────────────────────────────────────
  d := '2026-09-23';

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
  VALUES (bid, rid, lid, d, kid, (d||' 10:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 18:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 'open')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, kid, (d||' 10:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 18:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 30, s_sara, 'auto', 32.00);

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, required_level, label)
  VALUES (bid, rid, lid, d, kid, (d||' 16:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 'senior', 'close')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, kid, (d||' 16:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 0, s_renu, 'auto', 27.50);

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
  VALUES (bid, rid, lid, d, fid, (d||' 11:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 19:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 'lunch')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, fid, (d||' 11:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 19:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 30, s_minal, 'auto', 29.00);

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
  VALUES (bid, rid, lid, d, fid, (d||' 17:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 'dinner')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, fid, (d||' 17:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 0, s_omar, 'auto', 27.00);

  -- ── WEDNESDAY 2026-09-24 ───────────────────────────────────────────────────
  d := '2026-09-24';

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
  VALUES (bid, rid, lid, d, kid, (d||' 10:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 18:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 'open')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, kid, (d||' 10:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 18:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 30, s_ahmed, 'auto', 28.00);

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, required_level, label)
  VALUES (bid, rid, lid, d, kid, (d||' 16:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 'senior', 'close')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, kid, (d||' 16:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 0, s_sara, 'auto', 32.00);

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
  VALUES (bid, rid, lid, d, fid, (d||' 11:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 19:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 'lunch')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, fid, (d||' 11:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 19:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 30, s_minal, 'auto', 29.00);

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
  VALUES (bid, rid, lid, d, fid, (d||' 17:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 'dinner')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, fid, (d||' 17:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 0, s_omar, 'auto', 27.00);

  -- ── THURSDAY 2026-09-25 ────────────────────────────────────────────────────
  d := '2026-09-25';

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
  VALUES (bid, rid, lid, d, kid, (d||' 10:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 18:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 'open')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, kid, (d||' 10:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 18:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 30, s_sara, 'auto', 32.00);

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, required_level, label)
  VALUES (bid, rid, lid, d, kid, (d||' 16:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 'senior', 'close')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, kid, (d||' 16:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 0, s_ahmed, 'auto', 28.00);

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
  VALUES (bid, rid, lid, d, fid, (d||' 11:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 19:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 'lunch')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, fid, (d||' 11:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 19:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 30, s_simran, 'auto', 24.00);

  -- FOH dinner on Thursday → UNFILLED (position only, no shift)
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
  VALUES (bid, rid, lid, d, fid, (d||' 17:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 'dinner');

  -- ── FRIDAY 2026-09-26 (busier — extra FOH) ─────────────────────────────────
  d := '2026-09-26';

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
  VALUES (bid, rid, lid, d, kid, (d||' 10:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 18:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 'open')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, kid, (d||' 10:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 18:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 30, s_sara, 'auto', 32.00);

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, required_level, label)
  VALUES (bid, rid, lid, d, kid, (d||' 16:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 'senior', 'close')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, kid, (d||' 16:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 0, s_ahmed, 'auto', 28.00);

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
  VALUES (bid, rid, lid, d, fid, (d||' 11:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 19:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 'lunch')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, fid, (d||' 11:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 19:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 30, s_omar, 'auto', 27.00);

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
  VALUES (bid, rid, lid, d, fid, (d||' 17:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 'dinner')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, fid, (d||' 17:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 0, s_minal, 'auto', 29.00);

  -- Extra FOH (dinner rush)
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
  VALUES (bid, rid, lid, d, fid, (d||' 17:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 'dinner rush')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, fid, (d||' 17:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 0, s_simran, 'auto', 24.00);

  -- ── SATURDAY 2026-09-27 (busiest) ──────────────────────────────────────────
  d := '2026-09-27';

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
  VALUES (bid, rid, lid, d, kid, (d||' 10:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 18:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 'open')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, kid, (d||' 10:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 18:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 30, s_renu, 'auto', 27.50);

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, required_level, label)
  VALUES (bid, rid, lid, d, kid, (d||' 16:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 'senior', 'close')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, kid, (d||' 16:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 0, s_sara, 'auto', 32.00);

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
  VALUES (bid, rid, lid, d, fid, (d||' 11:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 19:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 'lunch')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, fid, (d||' 11:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 19:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 30, s_omar, 'auto', 27.00);

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
  VALUES (bid, rid, lid, d, fid, (d||' 17:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 'dinner')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, fid, (d||' 17:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 0, s_minal, 'auto', 29.00);

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
  VALUES (bid, rid, lid, d, fid, (d||' 17:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 'dinner rush')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, fid, (d||' 17:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 0, s_simran, 'auto', 24.00);

  -- ── SUNDAY 2026-09-28 ──────────────────────────────────────────────────────
  d := '2026-09-28';

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
  VALUES (bid, rid, lid, d, kid, (d||' 10:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 18:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 'open')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, kid, (d||' 10:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 18:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 30, s_ahmed, 'auto', 28.00);

  -- Kitchen close Sunday → UNFILLED
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, required_level, label)
  VALUES (bid, rid, lid, d, kid, (d||' 16:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 'senior', 'close');

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
  VALUES (bid, rid, lid, d, fid, (d||' 11:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 19:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 'lunch')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, fid, (d||' 11:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 19:00')::timestamptz AT TIME ZONE 'Australia/Sydney', 30, s_simran, 'auto', 24.00);

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
  VALUES (bid, rid, lid, d, fid, (d||' 17:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 'dinner')
  RETURNING id INTO pos;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, origin, pay_rate_snapshot)
  VALUES (bid, rid, pos, lid, d, fid, (d||' 17:00')::timestamptz AT TIME ZONE 'Australia/Sydney', (d||' 22:30')::timestamptz AT TIME ZONE 'Australia/Sydney', 0, s_renu, 'auto', 27.50);

  RAISE NOTICE 'Done! Roster % seeded with Mon-Sun 2026-09-22 data.', rid;

END $$;
