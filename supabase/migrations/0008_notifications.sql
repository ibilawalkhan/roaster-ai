-- Rosterly Module 9: Notifications.
--
-- Two channels, deliberately separated (M9 §1): in-app (free, via Supabase
-- Realtime) and SMS (costs money, interrupts a real person's evening, so it is
-- reserved for what genuinely cannot wait). Quiet by default.
--
-- TRANSACTIONAL OUTBOX (M9 §3) — this is what makes "a failed notification must
-- never fail the action that triggered it" (CLAUDE.md rule 7) actually true:
--   1. the business action (publish, approve, drop) writes its data AND a
--      `notification` row in the SAME transaction — both or neither;
--   2. a separate worker picks up pending rows and delivers them (Realtime
--      in-app; Twilio via an Edge Function for SMS);
--   3. success or failure is recorded on the row — attempts/last_error — and
--      retries back off, landing in a visible 'failed' state, never lost.
-- A Twilio outage therefore cannot roll back a shift approval.
--
-- event_type holds the M9 §2 catalogue codes 'E1'..'E16' (named constants in
-- code). Nothing outside that catalogue sends a notification; it is kept as text
-- rather than an enum so adding a catalogued event needs no migration, while the
-- catalogue itself stays the deliberate gate.
--
-- Timezone: scheduled_for is a UTC instant; quiet hours (default 22:00–07:00,
-- M9 §4) are evaluated in the BUSINESS timezone (M1) by the sender, not here.

-- ---------------------------------------------------------------------------
-- Controlled vocabularies
-- ---------------------------------------------------------------------------
create type public.notification_channel as enum ('inapp', 'sms');
create type public.notification_status  as enum ('pending', 'sent', 'failed', 'suppressed');

-- ---------------------------------------------------------------------------
-- notification — the outbox row (M9 §7). read_at drives the in-app list (M7 §3.5).
-- suppressed_reason records WHY a message was not sent ('quiet_hours',
-- 'rate_cap', 'budget', 'user_pref') so "I never got told" is always answerable.
-- ---------------------------------------------------------------------------
create table public.notification (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.business (id) on delete cascade,
  user_id           uuid not null references public.app_user (id) on delete cascade,
  event_type        text not null,                       -- 'E1'..'E16' (M9 §2)
  payload_json      jsonb not null default '{}'::jsonb,  -- render + deep-link target
  channel           public.notification_channel not null,
  status            public.notification_status not null default 'pending',
  suppressed_reason text,
  attempts          integer not null default 0 check (attempts >= 0),
  last_error        text,
  scheduled_for     timestamptz,   -- set when queued behind quiet hours
  sent_at           timestamptz,
  read_at           timestamptz,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- notification_batch — collapses related events into one message (M9 §4), e.g.
-- several claims on one shift within a 10-minute window become
-- "3 people have offered to cover Friday 16:00". key is like 'claims:shift_123';
-- unique per business so a concurrent second event joins the open window.
-- ---------------------------------------------------------------------------
create table public.notification_batch (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.business (id) on delete cascade,
  key            text not null,
  window_ends_at timestamptz not null,
  sent           boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (business_id, key)
);

-- ---------------------------------------------------------------------------
-- Indexes for hot paths: the in-app list is "my unread, newest first"; the
-- delivery worker sweeps "pending and due".
-- ---------------------------------------------------------------------------
create index idx_notification_user_read     on public.notification (user_id, read_at);
create index idx_notification_due           on public.notification (status, scheduled_for);
create index idx_notification_business      on public.notification (business_id);
create index idx_notification_batch_window  on public.notification_batch (window_ends_at) where not sent;

-- ---------------------------------------------------------------------------
-- RLS (M9 §7 / M11 §5.1).
--   notification       — a user reads and updates ONLY their own rows. Rows are
--                        CREATED by trusted server code (the triggering action's
--                        transaction / the worker) running as service_role,
--                        which bypasses RLS — so there is deliberately no client
--                        insert policy: nobody can fabricate a notification.
--                        The client update path exists solely to set read_at;
--                        the delivery fields are only ever written by the worker.
--   notification_batch — manager/service only; it is delivery plumbing, never
--                        user-facing content.
-- ---------------------------------------------------------------------------
alter table public.notification       enable row level security;
alter table public.notification_batch enable row level security;

create policy notification_select_own on public.notification
  for select to authenticated
  using (
    business_id = public.current_business_id()
    and user_id = public.current_app_user_id()
  );

create policy notification_update_own on public.notification
  for update to authenticated
  using (
    business_id = public.current_business_id()
    and user_id = public.current_app_user_id()
  )
  with check (
    business_id = public.current_business_id()
    and user_id = public.current_app_user_id()
  );

create policy notification_batch_manager on public.notification_batch
  for all to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());

-- Grants for the new tables (the blanket grant in 0002 only covered tables that
-- existed then; new tables need their own).
grant select, update on public.notification to authenticated;
grant select, insert, update, delete on public.notification_batch to authenticated;
grant all on public.notification, public.notification_batch to service_role;
