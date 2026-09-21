-- supabase/seed_full_data.sql
-- Full seed: new manager + 20 staff + 6 roles + published roster + swaps + notifications
-- Run in Supabase SQL Editor (postgres / service_role) to bypass RLS.
-- Safe to re-run (idempotent).
--
-- Login: manager@altazah.com.au / Roster2026!

DO $$
DECLARE
  bid      uuid := '00000000-0000-0000-0000-0000000000a1';
  lid      uuid;  -- resolved dynamically to the first active location
  kid      uuid := '00000000-0000-0000-0000-0000000000c1';  -- Kitchen
  fid      uuid := '00000000-0000-0000-0000-0000000000c2';  -- FOH
  mgr_role uuid := '00000000-0000-0000-0000-0000000000c4';  -- Manager

  bar_id uuid; sup_id uuid;   -- new roles

  mgr_auth uuid; mgr_id uuid; -- new manager

  -- existing staff (looked up by phone)
  sara_id uuid; ahmed_id uuid; omar_id uuid;

  -- kitchen (9 new)
  ky1 uuid; ky2 uuid; ky3 uuid; ky4 uuid; ky5 uuid;
  ky6 uuid; ky7 uuid; ky8 uuid; ky9 uuid;

  -- FOH (8 new)
  fy1 uuid; fy2 uuid; fy3 uuid; fy4 uuid;
  fy5 uuid; fy6 uuid; fy7 uuid; fy8 uuid;

  tid uuid; rid uuid;  -- template, roster
  p   uuid;            -- reused position id
  s_swap uuid;         -- shift that enters swap flow

BEGIN
  -- Resolve the active location (may differ between remote and local)
  SELECT id INTO lid FROM public.location WHERE business_id = bid AND active = true ORDER BY created_at LIMIT 1;
  IF lid IS NULL THEN RAISE EXCEPTION 'No active location for business %', bid; END IF;

-- ══════════════════════════════════════════════════════════
-- 1. MANAGER auth.users + app_user
-- ══════════════════════════════════════════════════════════
  SELECT id INTO mgr_auth FROM auth.users WHERE email = 'manager@altazah.com.au';
  IF mgr_auth IS NULL THEN
    mgr_auth := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', mgr_auth,
      'authenticated', 'authenticated', 'manager@altazah.com.au',
      crypt('Roster2026!', gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
    );
  ELSE
    UPDATE auth.users
       SET encrypted_password  = crypt('Roster2026!', gen_salt('bf')),
           email_confirmed_at  = COALESCE(email_confirmed_at, now())
     WHERE id = mgr_auth;
  END IF;

  -- Ensure the auth identity row exists (required for email sign-in)
  INSERT INTO auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    'manager@altazah.com.au', mgr_auth,
    jsonb_build_object(
      'sub',            mgr_auth::text,
      'email',          'manager@altazah.com.au',
      'email_verified', true,
      'phone_verified', false
    ),
    'email', now(), now(), now()
  )
  ON CONFLICT (provider_id, provider) DO UPDATE
    SET identity_data = EXCLUDED.identity_data,
        updated_at    = now();

  SELECT id INTO mgr_id FROM public.app_user
    WHERE business_id = bid AND email = 'manager@altazah.com.au';
  IF mgr_id IS NULL THEN
    INSERT INTO public.app_user (
      business_id, auth_user_id, name, is_manager, level,
      employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, email
    ) VALUES (
      bid, mgr_auth, 'Tariq Al-Hassan', true, 'senior',
      'full_time', 45, mgr_role, lid, 'ember', '61400000009', 'manager@altazah.com.au'
    ) RETURNING id INTO mgr_id;
  ELSE
    UPDATE public.app_user SET auth_user_id = mgr_auth WHERE id = mgr_id;
  END IF;
  RAISE NOTICE 'Manager: % (%)', mgr_id, mgr_auth;

-- ══════════════════════════════════════════════════════════
-- 2. NEW ROLES
-- ══════════════════════════════════════════════════════════
  INSERT INTO public.role (business_id, name, short_code, colour)
    VALUES (bid, 'Barista', 'BAR', 'sky')
    ON CONFLICT (business_id, name) DO NOTHING;
  SELECT id INTO bar_id FROM public.role WHERE business_id = bid AND name = 'Barista';

  INSERT INTO public.role (business_id, name, short_code, colour)
    VALUES (bid, 'Supervisor', 'SUP', 'clay')
    ON CONFLICT (business_id, name) DO NOTHING;
  SELECT id INTO sup_id FROM public.role WHERE business_id = bid AND name = 'Supervisor';

-- ══════════════════════════════════════════════════════════
-- 3. EXISTING STAFF
-- ══════════════════════════════════════════════════════════
  SELECT id INTO sara_id  FROM public.app_user WHERE business_id = bid AND phone = '61400000002';
  SELECT id INTO ahmed_id FROM public.app_user WHERE business_id = bid AND phone = '61400000003';
  SELECT id INTO omar_id  FROM public.app_user WHERE business_id = bid AND phone = '61400000005';

-- ══════════════════════════════════════════════════════════
-- 4. KITCHEN STAFF (9 new → 10 total with Sara)
-- ══════════════════════════════════════════════════════════
  INSERT INTO public.app_user (business_id, name, is_manager, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, email)
    VALUES (bid,'Hassan Yousef',   false,'senior','full_time', 35,kid,lid,'herb',   '61400000010','hassan.y@altazah.com.au')
    ON CONFLICT (business_id, phone) DO NOTHING;
  SELECT id INTO ky1 FROM public.app_user WHERE business_id = bid AND phone = '61400000010';

  INSERT INTO public.app_user (business_id, name, is_manager, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, email)
    VALUES (bid,'Fatima Al-Rashid',false,'mid',   'casual',    26,kid,lid,'herb',   '61400000011','fatima.a@altazah.com.au')
    ON CONFLICT (business_id, phone) DO NOTHING;
  SELECT id INTO ky2 FROM public.app_user WHERE business_id = bid AND phone = '61400000011';

  INSERT INTO public.app_user (business_id, name, is_manager, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, email)
    VALUES (bid,'Tariq Mahmoud',   false,'junior','casual',    23,kid,lid,'herb',   '61400000012','tariq.m@altazah.com.au')
    ON CONFLICT (business_id, phone) DO NOTHING;
  SELECT id INTO ky3 FROM public.app_user WHERE business_id = bid AND phone = '61400000012';

  INSERT INTO public.app_user (business_id, name, is_manager, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, email)
    VALUES (bid,'Nadia Kamal',     false,'mid',   'part_time', 28,kid,lid,'herb',   '61400000013','nadia.k@altazah.com.au')
    ON CONFLICT (business_id, phone) DO NOTHING;
  SELECT id INTO ky4 FROM public.app_user WHERE business_id = bid AND phone = '61400000013';

  INSERT INTO public.app_user (business_id, name, is_manager, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, email)
    VALUES (bid,'Yusuf Ibrahim',   false,'junior','casual',    23,kid,lid,'herb',   '61400000014','yusuf.i@altazah.com.au')
    ON CONFLICT (business_id, phone) DO NOTHING;
  SELECT id INTO ky5 FROM public.app_user WHERE business_id = bid AND phone = '61400000014';

  INSERT INTO public.app_user (business_id, name, is_manager, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, email)
    VALUES (bid,'Aisha Malik',     false,'mid',   'part_time', 27,kid,lid,'herb',   '61400000015','aisha.m@altazah.com.au')
    ON CONFLICT (business_id, phone) DO NOTHING;
  SELECT id INTO ky6 FROM public.app_user WHERE business_id = bid AND phone = '61400000015';

  INSERT INTO public.app_user (business_id, name, is_manager, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, email)
    VALUES (bid,'Bilal Qureshi',   false,'mid',   'full_time', 29,kid,lid,'herb',   '61400000016','bilal.q@altazah.com.au')
    ON CONFLICT (business_id, phone) DO NOTHING;
  SELECT id INTO ky7 FROM public.app_user WHERE business_id = bid AND phone = '61400000016';

  INSERT INTO public.app_user (business_id, name, is_manager, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, email)
    VALUES (bid,'Layla Hassan',    false,'junior','casual',    24,kid,lid,'herb',   '61400000017','layla.h@altazah.com.au')
    ON CONFLICT (business_id, phone) DO NOTHING;
  SELECT id INTO ky8 FROM public.app_user WHERE business_id = bid AND phone = '61400000017';

  INSERT INTO public.app_user (business_id, name, is_manager, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, email)
    VALUES (bid,'Samira Aziz',     false,'senior','part_time', 32,kid,lid,'herb',   '61400000018','samira.a@altazah.com.au')
    ON CONFLICT (business_id, phone) DO NOTHING;
  SELECT id INTO ky9 FROM public.app_user WHERE business_id = bid AND phone = '61400000018';

-- ══════════════════════════════════════════════════════════
-- 5. FOH STAFF (8 new → 10 total with Ahmed + Omar)
-- ══════════════════════════════════════════════════════════
  INSERT INTO public.app_user (business_id, name, is_manager, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, email)
    VALUES (bid,'Priya Singh',     false,'mid',   'full_time', 28,fid,lid,'saffron','61400000020','priya.s@altazah.com.au')
    ON CONFLICT (business_id, phone) DO NOTHING;
  SELECT id INTO fy1 FROM public.app_user WHERE business_id = bid AND phone = '61400000020';

  INSERT INTO public.app_user (business_id, name, is_manager, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, email)
    VALUES (bid,'James Wilson',    false,'junior','casual',    23,fid,lid,'saffron','61400000021','james.w@altazah.com.au')
    ON CONFLICT (business_id, phone) DO NOTHING;
  SELECT id INTO fy2 FROM public.app_user WHERE business_id = bid AND phone = '61400000021';

  INSERT INTO public.app_user (business_id, name, is_manager, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, email)
    VALUES (bid,'Emma Thompson',   false,'mid',   'part_time', 27,fid,lid,'saffron','61400000022','emma.t@altazah.com.au')
    ON CONFLICT (business_id, phone) DO NOTHING;
  SELECT id INTO fy3 FROM public.app_user WHERE business_id = bid AND phone = '61400000022';

  INSERT INTO public.app_user (business_id, name, is_manager, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, email)
    VALUES (bid,'Daniel Lee',      false,'senior','full_time', 33,fid,lid,'saffron','61400000023','daniel.l@altazah.com.au')
    ON CONFLICT (business_id, phone) DO NOTHING;
  SELECT id INTO fy4 FROM public.app_user WHERE business_id = bid AND phone = '61400000023';

  INSERT INTO public.app_user (business_id, name, is_manager, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, email)
    VALUES (bid,'Sophie Chen',     false,'junior','casual',    24,fid,lid,'saffron','61400000024','sophie.c@altazah.com.au')
    ON CONFLICT (business_id, phone) DO NOTHING;
  SELECT id INTO fy5 FROM public.app_user WHERE business_id = bid AND phone = '61400000024';

  INSERT INTO public.app_user (business_id, name, is_manager, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, email)
    VALUES (bid,'Marcus Johnson',  false,'mid',   'part_time', 26,fid,lid,'saffron','61400000025','marcus.j@altazah.com.au')
    ON CONFLICT (business_id, phone) DO NOTHING;
  SELECT id INTO fy6 FROM public.app_user WHERE business_id = bid AND phone = '61400000025';

  INSERT INTO public.app_user (business_id, name, is_manager, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, email)
    VALUES (bid,'Minal Patel',     false,'mid',   'casual',    27,fid,lid,'saffron','61400000026','minal.p@altazah.com.au')
    ON CONFLICT (business_id, phone) DO NOTHING;
  SELECT id INTO fy7 FROM public.app_user WHERE business_id = bid AND phone = '61400000026';

  INSERT INTO public.app_user (business_id, name, is_manager, level, employment_type, pay_rate, primary_role_id, home_location_id, colour, phone, email)
    VALUES (bid,'Simran Kaur',     false,'junior','casual',    24,fid,lid,'saffron','61400000027','simran.k@altazah.com.au')
    ON CONFLICT (business_id, phone) DO NOTHING;
  SELECT id INTO fy8 FROM public.app_user WHERE business_id = bid AND phone = '61400000027';

-- ══════════════════════════════════════════════════════════
-- 6. USER_ROLE ASSIGNMENTS
-- ══════════════════════════════════════════════════════════
  -- Kitchen staff → Kitchen role
  INSERT INTO public.user_role (business_id, user_id, role_id)
    SELECT bid, u, kid FROM unnest(ARRAY[sara_id,ky1,ky2,ky3,ky4,ky5,ky6,ky7,ky8,ky9]) AS u
    WHERE u IS NOT NULL
    ON CONFLICT (user_id, role_id) DO NOTHING;

  -- FOH staff → FOH role
  INSERT INTO public.user_role (business_id, user_id, role_id)
    SELECT bid, u, fid FROM unnest(ARRAY[ahmed_id,omar_id,fy1,fy2,fy3,fy4,fy5,fy6,fy7,fy8]) AS u
    WHERE u IS NOT NULL
    ON CONFLICT (user_id, role_id) DO NOTHING;

  -- Cross-trained: Sara + Priya + Emma → Barista
  INSERT INTO public.user_role (business_id, user_id, role_id)
    SELECT bid, u, bar_id FROM unnest(ARRAY[sara_id,fy1,fy3]) AS u
    WHERE u IS NOT NULL AND bar_id IS NOT NULL
    ON CONFLICT (user_id, role_id) DO NOTHING;

  -- Seniors: Hassan + Samira + Daniel → Supervisor
  INSERT INTO public.user_role (business_id, user_id, role_id)
    SELECT bid, u, sup_id FROM unnest(ARRAY[ky1,ky9,fy4]) AS u
    WHERE u IS NOT NULL AND sup_id IS NOT NULL
    ON CONFLICT (user_id, role_id) DO NOTHING;

-- ══════════════════════════════════════════════════════════
-- 7. AVAILABILITY PATTERNS  (0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat)
-- ══════════════════════════════════════════════════════════
  -- Full-time (Mon–Fri)
  INSERT INTO public.availability_pattern (business_id, user_id, day_of_week, is_available)
    SELECT bid, u, d, (d BETWEEN 1 AND 5)
    FROM unnest(ARRAY[ky1,ky7,sara_id,fy1,fy4]) AS u
    CROSS JOIN generate_series(0,6) d
    WHERE u IS NOT NULL
    ON CONFLICT (user_id, day_of_week) DO UPDATE SET is_available = EXCLUDED.is_available;

  -- Part-time (Tue/Wed/Thu/Sat/Sun)
  INSERT INTO public.availability_pattern (business_id, user_id, day_of_week, is_available)
    SELECT bid, u, d, (d IN (0,2,3,4,6))
    FROM unnest(ARRAY[ky4,ky6,ky9,fy3,fy6]) AS u
    CROSS JOIN generate_series(0,6) d
    WHERE u IS NOT NULL
    ON CONFLICT (user_id, day_of_week) DO UPDATE SET is_available = EXCLUDED.is_available;

  -- Casual Mon–Sat
  INSERT INTO public.availability_pattern (business_id, user_id, day_of_week, is_available)
    SELECT bid, u, d, (d BETWEEN 1 AND 6)
    FROM unnest(ARRAY[ky2,ky3,ahmed_id,fy2]) AS u
    CROSS JOIN generate_series(0,6) d
    WHERE u IS NOT NULL
    ON CONFLICT (user_id, day_of_week) DO UPDATE SET is_available = EXCLUDED.is_available;

  -- Casual Tue/Thu/Sat/Sun
  INSERT INTO public.availability_pattern (business_id, user_id, day_of_week, is_available)
    SELECT bid, u, d, (d IN (0,2,4,6))
    FROM unnest(ARRAY[ky5,ky8,omar_id]) AS u
    CROSS JOIN generate_series(0,6) d
    WHERE u IS NOT NULL
    ON CONFLICT (user_id, day_of_week) DO UPDATE SET is_available = EXCLUDED.is_available;

  -- Casual Mon/Thu/Fri/Sat
  INSERT INTO public.availability_pattern (business_id, user_id, day_of_week, is_available)
    SELECT bid, u, d, (d IN (1,4,5,6))
    FROM unnest(ARRAY[fy5,fy8]) AS u
    CROSS JOIN generate_series(0,6) d
    WHERE u IS NOT NULL
    ON CONFLICT (user_id, day_of_week) DO UPDATE SET is_available = EXCLUDED.is_available;

  -- Casual Wed/Thu/Sat
  INSERT INTO public.availability_pattern (business_id, user_id, day_of_week, is_available)
    SELECT bid, u, d, (d IN (3,4,6))
    FROM unnest(ARRAY[fy7]) AS u
    CROSS JOIN generate_series(0,6) d
    WHERE u IS NOT NULL
    ON CONFLICT (user_id, day_of_week) DO UPDATE SET is_available = EXCLUDED.is_available;

-- ══════════════════════════════════════════════════════════
-- 8. AVAILABILITY EXCEPTIONS (this week)
-- ══════════════════════════════════════════════════════════
  INSERT INTO public.availability_exception (business_id, user_id, date, is_available, reason, source)
    VALUES (bid, ky3, '2026-09-24', false, 'Sick day', 'staff')
    ON CONFLICT (user_id, date) DO UPDATE SET is_available = false;

  INSERT INTO public.availability_exception (business_id, user_id, date, is_available, reason, source)
    VALUES (bid, fy2, '2026-09-25', false, 'Personal commitment', 'staff')
    ON CONFLICT (user_id, date) DO UPDATE SET is_available = false;

  INSERT INTO public.availability_exception (business_id, user_id, date, is_available, reason, source)
    VALUES (bid, fy5, '2026-09-22', false, 'Prior booking', 'staff')
    ON CONFLICT (user_id, date) DO UPDATE SET is_available = false;

  INSERT INTO public.availability_exception (business_id, user_id, date, is_available, from_time, to_time, reason, source)
    VALUES (bid, ky1, '2026-09-27', true, '14:00', '23:00', 'Morning appointment', 'staff')
    ON CONFLICT (user_id, date) DO UPDATE SET from_time = '14:00', to_time = '23:00';

-- ══════════════════════════════════════════════════════════
-- 8b. TRADING HOURS + SCHEDULING RULE + BREAK RULES
-- ══════════════════════════════════════════════════════════
  -- All 7 days open 07:00–23:00 (covers K-open, K-close, FOH lunch, FOH dinner)
  INSERT INTO public.trading_hours (business_id, location_id, day_of_week, is_open, opens_at, closes_at, is_24h)
    SELECT bid, lid, d, true, '07:00'::time, '23:00'::time, false
    FROM generate_series(0, 6) AS d
  ON CONFLICT (location_id, day_of_week) DO UPDATE
    SET is_open = true, opens_at = '07:00'::time, closes_at = '23:00'::time;

  INSERT INTO public.scheduling_rule (business_id)
    VALUES (bid)
  ON CONFLICT (business_id) DO NOTHING;

  -- Break rules: <4h = no break, 4-8h = 30 min, >8h = 45 min
  DELETE FROM public.break_rule WHERE business_id = bid;
  INSERT INTO public.break_rule (business_id, min_hours, max_hours, break_minutes)
    VALUES (bid, 0, 4, 0), (bid, 4, 8, 30), (bid, 8, NULL, 45);

-- ══════════════════════════════════════════════════════════
-- 9. WEEK TEMPLATE + SLOTS
-- ══════════════════════════════════════════════════════════
  SELECT id INTO tid FROM public.week_template WHERE business_id = bid AND is_default = true ORDER BY created_at LIMIT 1;
  IF tid IS NULL THEN
    INSERT INTO public.week_template (business_id, name, is_default)
      VALUES (bid, 'Normal Week', true) RETURNING id INTO tid;
  END IF;
  DELETE FROM public.template_slot WHERE template_id = tid;

  -- Kitchen open (07:00–15:00, count=2) every day
  INSERT INTO public.template_slot (business_id, template_id, location_id, day_of_week, role_id, start_time, end_time, count, label, crosses_midnight)
    SELECT bid, tid, lid, d, kid, '07:00', '15:00', 2, 'Open', false FROM generate_series(0,6) d;

  -- Kitchen close (14:00–22:30, count=1, senior) every day
  INSERT INTO public.template_slot (business_id, template_id, location_id, day_of_week, role_id, start_time, end_time, count, required_level, label, crosses_midnight)
    SELECT bid, tid, lid, d, kid, '14:00', '22:30', 1, 'senior', 'Close', false FROM generate_series(0,6) d;

  -- FOH lunch (10:00–16:00, count=2) every day
  INSERT INTO public.template_slot (business_id, template_id, location_id, day_of_week, role_id, start_time, end_time, count, label, crosses_midnight)
    SELECT bid, tid, lid, d, fid, '10:00', '16:00', 2, 'Lunch', false FROM generate_series(0,6) d;

  -- FOH dinner (16:00–22:30, count=2 Mon–Thu; count=3 Fri–Sun)
  INSERT INTO public.template_slot (business_id, template_id, location_id, day_of_week, role_id, start_time, end_time, count, label, crosses_midnight)
    SELECT bid, tid, lid, d, fid, '16:00', '22:30',
      CASE WHEN d IN (0,5,6) THEN 3 ELSE 2 END, 'Dinner', false
    FROM generate_series(0,6) d;

  -- Barista (07:00–14:00, count=1) Fri/Sat/Sun only
  INSERT INTO public.template_slot (business_id, template_id, location_id, day_of_week, role_id, start_time, end_time, count, label, crosses_midnight)
    SELECT bid, tid, lid, d, bar_id, '07:00', '14:00', 1, 'Barista', false
    FROM (VALUES (5),(6),(0)) AS t(d)
    WHERE bar_id IS NOT NULL;

  RAISE NOTICE 'Template: %', tid;

-- ══════════════════════════════════════════════════════════
-- 10. ROSTER (Mon 22 Sep – Sun 28 Sep 2026), published
--     Timestamps: AEST = UTC+10, no DST. '2026-09-22T07:00:00+10:00' etc.
-- ══════════════════════════════════════════════════════════
  DELETE FROM public.roster WHERE business_id = bid AND start_date = '2026-09-22';

  INSERT INTO public.roster (business_id, location_scope, start_date, days, status, template_id, created_by, published_at, published_by)
    VALUES (bid, NULL, '2026-09-22', 7, 'published', tid, mgr_id, now() - interval '1 hour', mgr_id)
    RETURNING id INTO rid;
  RAISE NOTICE 'Roster: %', rid;

-- ── Monday 2026-09-22 ───────────────────────────────────
  -- K Open 1: Sara
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-22', kid,
      '2026-09-21T21:00:00+00:00'::timestamptz, '2026-09-22T05:00:00+00:00'::timestamptz, 'Open')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-22', kid,
      '2026-09-21T21:00:00+00:00'::timestamptz, '2026-09-22T05:00:00+00:00'::timestamptz, 45, sara_id, 30, 'assigned');

  -- K Open 2: Fatima
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-22', kid,
      '2026-09-21T21:00:00+00:00'::timestamptz, '2026-09-22T05:00:00+00:00'::timestamptz, 'Open')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-22', kid,
      '2026-09-21T21:00:00+00:00'::timestamptz, '2026-09-22T05:00:00+00:00'::timestamptz, 45, ky2, 26, 'assigned');

  -- K Close: Hassan (senior)
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, required_level, label)
    VALUES (bid, rid, lid, '2026-09-22', kid,
      '2026-09-22T04:00:00+00:00'::timestamptz, '2026-09-22T12:30:00+00:00'::timestamptz, 'senior', 'Close')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-22', kid,
      '2026-09-22T04:00:00+00:00'::timestamptz, '2026-09-22T12:30:00+00:00'::timestamptz, 45, ky1, 35, 'assigned');

  -- FOH Lunch 1: Ahmed
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-22', fid,
      '2026-09-22T00:00:00+00:00'::timestamptz, '2026-09-22T06:00:00+00:00'::timestamptz, 'Lunch')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-22', fid,
      '2026-09-22T00:00:00+00:00'::timestamptz, '2026-09-22T06:00:00+00:00'::timestamptz, 30, ahmed_id, 28, 'assigned');

  -- FOH Lunch 2: Priya
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-22', fid,
      '2026-09-22T00:00:00+00:00'::timestamptz, '2026-09-22T06:00:00+00:00'::timestamptz, 'Lunch')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-22', fid,
      '2026-09-22T00:00:00+00:00'::timestamptz, '2026-09-22T06:00:00+00:00'::timestamptz, 30, fy1, 28, 'assigned');

  -- FOH Dinner 1: Daniel
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-22', fid,
      '2026-09-22T06:00:00+00:00'::timestamptz, '2026-09-22T12:30:00+00:00'::timestamptz, 'Dinner')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-22', fid,
      '2026-09-22T06:00:00+00:00'::timestamptz, '2026-09-22T12:30:00+00:00'::timestamptz, 30, fy4, 33, 'assigned');

  -- FOH Dinner 2: Emma
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-22', fid,
      '2026-09-22T06:00:00+00:00'::timestamptz, '2026-09-22T12:30:00+00:00'::timestamptz, 'Dinner')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-22', fid,
      '2026-09-22T06:00:00+00:00'::timestamptz, '2026-09-22T12:30:00+00:00'::timestamptz, 30, fy3, 27, 'assigned');

-- ── Tuesday 2026-09-23 ──────────────────────────────────
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-23', kid,
      '2026-09-22T21:00:00+00:00'::timestamptz, '2026-09-23T05:00:00+00:00'::timestamptz, 'Open')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-23', kid,
      '2026-09-22T21:00:00+00:00'::timestamptz, '2026-09-23T05:00:00+00:00'::timestamptz, 45, ky7, 29, 'assigned'); -- Bilal

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-23', kid,
      '2026-09-22T21:00:00+00:00'::timestamptz, '2026-09-23T05:00:00+00:00'::timestamptz, 'Open')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-23', kid,
      '2026-09-22T21:00:00+00:00'::timestamptz, '2026-09-23T05:00:00+00:00'::timestamptz, 45, ky4, 28, 'assigned'); -- Nadia

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, required_level, label)
    VALUES (bid, rid, lid, '2026-09-23', kid,
      '2026-09-23T04:00:00+00:00'::timestamptz, '2026-09-23T12:30:00+00:00'::timestamptz, 'senior', 'Close')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-23', kid,
      '2026-09-23T04:00:00+00:00'::timestamptz, '2026-09-23T12:30:00+00:00'::timestamptz, 45, ky9, 32, 'assigned'); -- Samira

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-23', fid,
      '2026-09-23T00:00:00+00:00'::timestamptz, '2026-09-23T06:00:00+00:00'::timestamptz, 'Lunch')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-23', fid,
      '2026-09-23T00:00:00+00:00'::timestamptz, '2026-09-23T06:00:00+00:00'::timestamptz, 30, fy1, 28, 'assigned'); -- Priya

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-23', fid,
      '2026-09-23T00:00:00+00:00'::timestamptz, '2026-09-23T06:00:00+00:00'::timestamptz, 'Lunch')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-23', fid,
      '2026-09-23T00:00:00+00:00'::timestamptz, '2026-09-23T06:00:00+00:00'::timestamptz, 30, fy5, 24, 'assigned'); -- Sophie

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-23', fid,
      '2026-09-23T06:00:00+00:00'::timestamptz, '2026-09-23T12:30:00+00:00'::timestamptz, 'Dinner')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-23', fid,
      '2026-09-23T06:00:00+00:00'::timestamptz, '2026-09-23T12:30:00+00:00'::timestamptz, 30, fy4, 33, 'assigned'); -- Daniel

  -- Tue Dinner 2: Emma — will become the SWAP shift
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-23', fid,
      '2026-09-23T06:00:00+00:00'::timestamptz, '2026-09-23T12:30:00+00:00'::timestamptz, 'Dinner')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id,
    start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot,
    status, drop_requested_by, drop_reason, drop_requested_at, original_user_id)
    VALUES (bid, rid, p, lid, '2026-09-23', fid,
      '2026-09-23T06:00:00+00:00'::timestamptz, '2026-09-23T12:30:00+00:00'::timestamptz,
      30, fy3, 27,
      'claimed_pending', fy3, 'Medical appointment', now() - interval '18 hours', fy3)
    RETURNING id INTO s_swap;

-- ── Wednesday 2026-09-24 (Tariq sick) ──────────────────
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-24', kid,
      '2026-09-23T21:00:00+00:00'::timestamptz, '2026-09-24T05:00:00+00:00'::timestamptz, 'Open')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-24', kid,
      '2026-09-23T21:00:00+00:00'::timestamptz, '2026-09-24T05:00:00+00:00'::timestamptz, 45, ky5, 23, 'assigned'); -- Yusuf

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-24', kid,
      '2026-09-23T21:00:00+00:00'::timestamptz, '2026-09-24T05:00:00+00:00'::timestamptz, 'Open')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-24', kid,
      '2026-09-23T21:00:00+00:00'::timestamptz, '2026-09-24T05:00:00+00:00'::timestamptz, 45, ky6, 27, 'assigned'); -- Aisha

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, required_level, label)
    VALUES (bid, rid, lid, '2026-09-24', kid,
      '2026-09-24T04:00:00+00:00'::timestamptz, '2026-09-24T12:30:00+00:00'::timestamptz, 'senior', 'Close')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-24', kid,
      '2026-09-24T04:00:00+00:00'::timestamptz, '2026-09-24T12:30:00+00:00'::timestamptz, 45, ky1, 35, 'assigned'); -- Hassan

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-24', fid,
      '2026-09-24T00:00:00+00:00'::timestamptz, '2026-09-24T06:00:00+00:00'::timestamptz, 'Lunch')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-24', fid,
      '2026-09-24T00:00:00+00:00'::timestamptz, '2026-09-24T06:00:00+00:00'::timestamptz, 30, ahmed_id, 28, 'assigned');

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-24', fid,
      '2026-09-24T00:00:00+00:00'::timestamptz, '2026-09-24T06:00:00+00:00'::timestamptz, 'Lunch')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-24', fid,
      '2026-09-24T00:00:00+00:00'::timestamptz, '2026-09-24T06:00:00+00:00'::timestamptz, 30, fy6, 26, 'assigned'); -- Marcus

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-24', fid,
      '2026-09-24T06:00:00+00:00'::timestamptz, '2026-09-24T12:30:00+00:00'::timestamptz, 'Dinner')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-24', fid,
      '2026-09-24T06:00:00+00:00'::timestamptz, '2026-09-24T12:30:00+00:00'::timestamptz, 30, fy4, 33, 'assigned'); -- Daniel

  -- Wed Dinner 2: UNFILLED (position only, no shift)
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-24', fid,
      '2026-09-24T06:00:00+00:00'::timestamptz, '2026-09-24T12:30:00+00:00'::timestamptz, 'Dinner');

-- ── Thursday 2026-09-25 (James unavailable) ────────────
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-25', kid,
      '2026-09-24T21:00:00+00:00'::timestamptz, '2026-09-25T05:00:00+00:00'::timestamptz, 'Open')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-25', kid,
      '2026-09-24T21:00:00+00:00'::timestamptz, '2026-09-25T05:00:00+00:00'::timestamptz, 45, sara_id, 30, 'assigned');

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-25', kid,
      '2026-09-24T21:00:00+00:00'::timestamptz, '2026-09-25T05:00:00+00:00'::timestamptz, 'Open')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-25', kid,
      '2026-09-24T21:00:00+00:00'::timestamptz, '2026-09-25T05:00:00+00:00'::timestamptz, 45, ky8, 24, 'assigned'); -- Layla

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, required_level, label)
    VALUES (bid, rid, lid, '2026-09-25', kid,
      '2026-09-25T04:00:00+00:00'::timestamptz, '2026-09-25T12:30:00+00:00'::timestamptz, 'senior', 'Close')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-25', kid,
      '2026-09-25T04:00:00+00:00'::timestamptz, '2026-09-25T12:30:00+00:00'::timestamptz, 45, ky9, 32, 'assigned'); -- Samira

  -- Thu Lunch 1: UNFILLED
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-25', fid,
      '2026-09-25T00:00:00+00:00'::timestamptz, '2026-09-25T06:00:00+00:00'::timestamptz, 'Lunch');

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-25', fid,
      '2026-09-25T00:00:00+00:00'::timestamptz, '2026-09-25T06:00:00+00:00'::timestamptz, 'Lunch')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-25', fid,
      '2026-09-25T00:00:00+00:00'::timestamptz, '2026-09-25T06:00:00+00:00'::timestamptz, 30, fy7, 27, 'assigned'); -- Minal

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-25', fid,
      '2026-09-25T06:00:00+00:00'::timestamptz, '2026-09-25T12:30:00+00:00'::timestamptz, 'Dinner')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-25', fid,
      '2026-09-25T06:00:00+00:00'::timestamptz, '2026-09-25T12:30:00+00:00'::timestamptz, 30, fy4, 33, 'assigned'); -- Daniel

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-25', fid,
      '2026-09-25T06:00:00+00:00'::timestamptz, '2026-09-25T12:30:00+00:00'::timestamptz, 'Dinner')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-25', fid,
      '2026-09-25T06:00:00+00:00'::timestamptz, '2026-09-25T12:30:00+00:00'::timestamptz, 30, fy8, 24, 'assigned'); -- Simran

-- ── Friday 2026-09-26 ────────────────────────────────────
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-26', kid,
      '2026-09-25T21:00:00+00:00'::timestamptz, '2026-09-26T05:00:00+00:00'::timestamptz, 'Open')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-26', kid,
      '2026-09-25T21:00:00+00:00'::timestamptz, '2026-09-26T05:00:00+00:00'::timestamptz, 45, ky2, 26, 'assigned'); -- Fatima

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-26', kid,
      '2026-09-25T21:00:00+00:00'::timestamptz, '2026-09-26T05:00:00+00:00'::timestamptz, 'Open')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-26', kid,
      '2026-09-25T21:00:00+00:00'::timestamptz, '2026-09-26T05:00:00+00:00'::timestamptz, 45, ky7, 29, 'assigned'); -- Bilal

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, required_level, label)
    VALUES (bid, rid, lid, '2026-09-26', kid,
      '2026-09-26T04:00:00+00:00'::timestamptz, '2026-09-26T12:30:00+00:00'::timestamptz, 'senior', 'Close')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-26', kid,
      '2026-09-26T04:00:00+00:00'::timestamptz, '2026-09-26T12:30:00+00:00'::timestamptz, 45, ky1, 35, 'assigned'); -- Hassan

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-26', fid,
      '2026-09-26T00:00:00+00:00'::timestamptz, '2026-09-26T06:00:00+00:00'::timestamptz, 'Lunch')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-26', fid,
      '2026-09-26T00:00:00+00:00'::timestamptz, '2026-09-26T06:00:00+00:00'::timestamptz, 30, ahmed_id, 28, 'assigned');

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-26', fid,
      '2026-09-26T00:00:00+00:00'::timestamptz, '2026-09-26T06:00:00+00:00'::timestamptz, 'Lunch')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-26', fid,
      '2026-09-26T00:00:00+00:00'::timestamptz, '2026-09-26T06:00:00+00:00'::timestamptz, 30, fy6, 26, 'assigned'); -- Marcus

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-26', fid,
      '2026-09-26T06:00:00+00:00'::timestamptz, '2026-09-26T12:30:00+00:00'::timestamptz, 'Dinner')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-26', fid,
      '2026-09-26T06:00:00+00:00'::timestamptz, '2026-09-26T12:30:00+00:00'::timestamptz, 30, fy4, 33, 'assigned'); -- Daniel

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-26', fid,
      '2026-09-26T06:00:00+00:00'::timestamptz, '2026-09-26T12:30:00+00:00'::timestamptz, 'Dinner')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-26', fid,
      '2026-09-26T06:00:00+00:00'::timestamptz, '2026-09-26T12:30:00+00:00'::timestamptz, 30, fy3, 27, 'assigned'); -- Emma

  -- Fri Dinner 3 (busy night): Priya
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-26', fid,
      '2026-09-26T06:00:00+00:00'::timestamptz, '2026-09-26T12:30:00+00:00'::timestamptz, 'Dinner')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-26', fid,
      '2026-09-26T06:00:00+00:00'::timestamptz, '2026-09-26T12:30:00+00:00'::timestamptz, 30, fy1, 28, 'assigned'); -- Priya

-- ── Saturday 2026-09-27 ──────────────────────────────────
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-27', kid,
      '2026-09-26T21:00:00+00:00'::timestamptz, '2026-09-27T05:00:00+00:00'::timestamptz, 'Open')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-27', kid,
      '2026-09-26T21:00:00+00:00'::timestamptz, '2026-09-27T05:00:00+00:00'::timestamptz, 45, sara_id, 30, 'assigned');

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-27', kid,
      '2026-09-26T21:00:00+00:00'::timestamptz, '2026-09-27T05:00:00+00:00'::timestamptz, 'Open')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-27', kid,
      '2026-09-26T21:00:00+00:00'::timestamptz, '2026-09-27T05:00:00+00:00'::timestamptz, 45, ky4, 28, 'assigned'); -- Nadia

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, required_level, label)
    VALUES (bid, rid, lid, '2026-09-27', kid,
      '2026-09-27T04:00:00+00:00'::timestamptz, '2026-09-27T12:30:00+00:00'::timestamptz, 'senior', 'Close')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-27', kid,
      '2026-09-27T04:00:00+00:00'::timestamptz, '2026-09-27T12:30:00+00:00'::timestamptz, 45, ky9, 32, 'assigned'); -- Samira

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-27', fid,
      '2026-09-27T00:00:00+00:00'::timestamptz, '2026-09-27T06:00:00+00:00'::timestamptz, 'Lunch')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-27', fid,
      '2026-09-27T00:00:00+00:00'::timestamptz, '2026-09-27T06:00:00+00:00'::timestamptz, 30, fy5, 24, 'assigned'); -- Sophie

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-27', fid,
      '2026-09-27T00:00:00+00:00'::timestamptz, '2026-09-27T06:00:00+00:00'::timestamptz, 'Lunch')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-27', fid,
      '2026-09-27T00:00:00+00:00'::timestamptz, '2026-09-27T06:00:00+00:00'::timestamptz, 30, fy8, 24, 'assigned'); -- Simran

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-27', fid,
      '2026-09-27T06:00:00+00:00'::timestamptz, '2026-09-27T12:30:00+00:00'::timestamptz, 'Dinner')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-27', fid,
      '2026-09-27T06:00:00+00:00'::timestamptz, '2026-09-27T12:30:00+00:00'::timestamptz, 30, ahmed_id, 28, 'assigned');

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-27', fid,
      '2026-09-27T06:00:00+00:00'::timestamptz, '2026-09-27T12:30:00+00:00'::timestamptz, 'Dinner')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-27', fid,
      '2026-09-27T06:00:00+00:00'::timestamptz, '2026-09-27T12:30:00+00:00'::timestamptz, 30, fy7, 27, 'assigned'); -- Minal

  -- Sat Dinner 3 + Barista
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-27', fid,
      '2026-09-27T06:00:00+00:00'::timestamptz, '2026-09-27T12:30:00+00:00'::timestamptz, 'Dinner')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-27', fid,
      '2026-09-27T06:00:00+00:00'::timestamptz, '2026-09-27T12:30:00+00:00'::timestamptz, 30, fy2, 23, 'assigned'); -- James

  -- Sat Barista: Priya (cross-trained)
  IF bar_id IS NOT NULL THEN
    INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
      VALUES (bid, rid, lid, '2026-09-27', bar_id,
        '2026-09-26T21:00:00+00:00'::timestamptz, '2026-09-27T04:00:00+00:00'::timestamptz, 'Barista')
      RETURNING id INTO p;
    INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
      VALUES (bid, rid, p, lid, '2026-09-27', bar_id,
        '2026-09-26T21:00:00+00:00'::timestamptz, '2026-09-27T04:00:00+00:00'::timestamptz, 30, fy1, 28, 'assigned'); -- Priya
  END IF;

-- ── Sunday 2026-09-28 ────────────────────────────────────
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-28', kid,
      '2026-09-27T21:00:00+00:00'::timestamptz, '2026-09-28T05:00:00+00:00'::timestamptz, 'Open')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-28', kid,
      '2026-09-27T21:00:00+00:00'::timestamptz, '2026-09-28T05:00:00+00:00'::timestamptz, 45, ky5, 23, 'assigned'); -- Yusuf

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-28', kid,
      '2026-09-27T21:00:00+00:00'::timestamptz, '2026-09-28T05:00:00+00:00'::timestamptz, 'Open')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-28', kid,
      '2026-09-27T21:00:00+00:00'::timestamptz, '2026-09-28T05:00:00+00:00'::timestamptz, 45, ky8, 24, 'assigned'); -- Layla

  -- Sun K Close: UNFILLED (Hassan/Samira day off)
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, required_level, label)
    VALUES (bid, rid, lid, '2026-09-28', kid,
      '2026-09-28T04:00:00+00:00'::timestamptz, '2026-09-28T12:30:00+00:00'::timestamptz, 'senior', 'Close');

  -- Sun FOH Lunch 1: UNFILLED
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-28', fid,
      '2026-09-28T00:00:00+00:00'::timestamptz, '2026-09-28T06:00:00+00:00'::timestamptz, 'Lunch');

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-28', fid,
      '2026-09-28T00:00:00+00:00'::timestamptz, '2026-09-28T06:00:00+00:00'::timestamptz, 'Lunch')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-28', fid,
      '2026-09-28T00:00:00+00:00'::timestamptz, '2026-09-28T06:00:00+00:00'::timestamptz, 30, omar_id, 26, 'assigned');

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-28', fid,
      '2026-09-28T06:00:00+00:00'::timestamptz, '2026-09-28T12:30:00+00:00'::timestamptz, 'Dinner')
    RETURNING id INTO p;
  INSERT INTO public.shift (business_id, roster_id, roster_position_id, location_id, date, role_id, start_at, end_at, break_minutes, assigned_user_id, pay_rate_snapshot, status)
    VALUES (bid, rid, p, lid, '2026-09-28', fid,
      '2026-09-28T06:00:00+00:00'::timestamptz, '2026-09-28T12:30:00+00:00'::timestamptz, 30, fy6, 26, 'assigned'); -- Marcus

  -- Sun Dinner 2+3: UNFILLED
  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-28', fid,
      '2026-09-28T06:00:00+00:00'::timestamptz, '2026-09-28T12:30:00+00:00'::timestamptz, 'Dinner');

  INSERT INTO public.roster_position (business_id, roster_id, location_id, date, role_id, start_at, end_at, label)
    VALUES (bid, rid, lid, '2026-09-28', fid,
      '2026-09-28T06:00:00+00:00'::timestamptz, '2026-09-28T12:30:00+00:00'::timestamptz, 'Dinner');

-- ══════════════════════════════════════════════════════════
-- 11. SHIFT CLAIMS (swap on Tue dinner — Emma dropped, Omar + Marcus claiming)
-- ══════════════════════════════════════════════════════════
  IF s_swap IS NOT NULL AND omar_id IS NOT NULL THEN
    INSERT INTO public.shift_claim (business_id, shift_id, claimant_user_id, outcome)
      VALUES (bid, s_swap, omar_id, 'pending')
      ON CONFLICT (shift_id, claimant_user_id) DO NOTHING;

    INSERT INTO public.shift_claim (business_id, shift_id, claimant_user_id, outcome)
      VALUES (bid, s_swap, fy6, 'pending')
      ON CONFLICT (shift_id, claimant_user_id) DO NOTHING;

    -- Audit trail
    INSERT INTO public.shift_swap_event (business_id, shift_id, from_status, to_status, action, actor_user_id, note)
      VALUES
        (bid, s_swap, 'assigned',      'drop_requested', 'request_drop', fy3,    'Medical appointment'),
        (bid, s_swap, 'drop_requested','open',            'open_shift',   mgr_id, 'Approved drop, opened for cover'),
        (bid, s_swap, 'open',          'claimed_pending', 'claim_shift',  omar_id, NULL);
  END IF;

-- ══════════════════════════════════════════════════════════
-- 12. NOTIFICATIONS (unread, for manager)
-- ══════════════════════════════════════════════════════════
  INSERT INTO public.notification (business_id, user_id, event_type, payload_json, channel, status, sent_at)
    VALUES
      (bid, mgr_id, 'E6',
        jsonb_build_object('shiftId', s_swap, 'date', '2026-09-23', 'staffName', 'Emma Thompson', 'reason', 'Medical appointment'),
        'inapp', 'sent', now() - interval '19 hours'),
      (bid, mgr_id, 'E7',
        jsonb_build_object('shiftId', s_swap, 'date', '2026-09-23', 'claimantName', 'Omar Farouk'),
        'inapp', 'sent', now() - interval '10 hours'),
      (bid, mgr_id, 'E7',
        jsonb_build_object('shiftId', s_swap, 'date', '2026-09-23', 'claimantName', 'Marcus Johnson'),
        'inapp', 'sent', now() - interval '8 hours');

  -- Notification for Omar that his claim is pending
  IF omar_id IS NOT NULL THEN
    INSERT INTO public.notification (business_id, user_id, event_type, payload_json, channel, status, sent_at)
      VALUES (bid, omar_id, 'E5',
        jsonb_build_object('shiftId', s_swap, 'date', '2026-09-23', 'role', 'Front of House'),
        'inapp', 'sent', now() - interval '10 hours');
  END IF;

-- ══════════════════════════════════════════════════════════
-- 13. ROSTER CHANGE LOG
-- ══════════════════════════════════════════════════════════
  INSERT INTO public.roster_change_log (business_id, roster_id, action, after_json, changed_by_user_id, changed_at, notified)
    VALUES
      (bid, rid, 'publish',
        jsonb_build_object('rosterId', rid, 'startDate', '2026-09-22', 'days', 7),
        mgr_id, now() - interval '1 hour', true),
      (bid, rid, 'assign',
        jsonb_build_object('date', '2026-09-22', 'role', 'Kitchen', 'staff', 'Sara Haddad'),
        mgr_id, now() - interval '2 hours', true),
      (bid, rid, 'assign',
        jsonb_build_object('date', '2026-09-22', 'role', 'Kitchen', 'staff', 'Hassan Yousef'),
        mgr_id, now() - interval '2 hours', true);

-- ══════════════════════════════════════════════════════════
-- 14. ROSTER WARNINGS
-- ══════════════════════════════════════════════════════════
  INSERT INTO public.roster_warning (business_id, roster_id, rule, detail, resolved)
    VALUES
      (bid, rid, 'availability',
        'Tariq Mahmoud is rostered on Wed 24 Sep but marked unavailable (sick day)',
        false),
      (bid, rid, 'availability',
        'James Wilson is rostered on Sat 27 Sep — check preferences',
        false),
      (bid, rid, 'senior_coverage',
        'Sunday Kitchen Close is unfilled — no senior cover for that shift',
        false);

  RAISE NOTICE '✓ Seed complete. Login: manager@altazah.com.au / Roster2026!';
  RAISE NOTICE '  Roster id: %', rid;
  RAISE NOTICE '  Template id: %', tid;

END;
$$;
