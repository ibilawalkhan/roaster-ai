-- Per-business notification settings (M9 §4 throttling, §5 SMS cost control).
--
-- The policy logic for quiet hours, the daily SMS cap and the monthly budget
-- has existed and been tested since M9 — but every value arrived as a function
-- parameter with a hardcoded default, so there was nowhere to actually
-- configure it. A cost control nobody can set is not a cost control.
--
-- SMS is the one part of Rosterly with a per-message cost, and it interrupts a
-- real person's evening. Both dials belong to the business, not to us.

create table public.notification_setting (
  business_id            uuid primary key references public.business (id) on delete cascade,

  -- M9 §5: a business may run in-app only and pay nothing for messaging.
  sms_enabled            boolean not null default true,

  -- M9 §4 quiet hours, in BUSINESS local time (M1 timezone). Time-critical
  -- events (E10 "you're on", E13 "still uncovered") override these by design —
  -- the catalogue decides that, not this table.
  quiet_hours_start      time not null default '22:00',
  quiet_hours_end        time not null default '07:00',

  -- Per-person daily ceiling. Excess degrades to in-app, never silently
  -- dropped, so hitting the cap costs visibility rather than the message.
  daily_sms_cap          integer not null default 5 check (daily_sms_cap >= 0),

  -- M9 §5 monthly budget. NULL = uncapped. At 80% the manager is warned; at
  -- 100% SMS degrades to in-app only and the product keeps working, quieter.
  monthly_sms_budget     integer check (monthly_sms_budget is null or monthly_sms_budget >= 0),

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create trigger trg_notification_setting_updated_at
  before update on public.notification_setting
  for each row execute function public.set_updated_at();

-- Suspended accounts are read-only (0013); settings are part of "using the
-- product", so the same gate applies.
create trigger trg_notification_setting_subscription_gate
  before insert or update or delete on public.notification_setting
  for each row execute function public.guard_suspended_business();

-- ---------------------------------------------------------------------------
-- RLS: manager-only, like every other settings surface (M11 §4.1).
-- ---------------------------------------------------------------------------
alter table public.notification_setting enable row level security;

create policy notification_setting_manager on public.notification_setting
  for all to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());

grant select, insert, update, delete on public.notification_setting to authenticated;
grant all on public.notification_setting to service_role;

-- ---------------------------------------------------------------------------
-- Monthly SMS usage, for the budget check.
-- ---------------------------------------------------------------------------
-- Counted from the notification table rather than kept as a running total: a
-- counter that drifts from reality is worse than no counter, and at this volume
-- the query is trivial. Only rows that actually went out are billable.
create or replace function public.sms_used_this_month(p_business_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.notification
   where business_id = p_business_id
     and channel = 'sms'
     and status = 'sent'
     and sent_at >= date_trunc('month', now());
$$;

grant execute on function public.sms_used_this_month(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Every business has settings, always.
-- ---------------------------------------------------------------------------
-- A trigger rather than only a backfill: signing customer #2 must not depend on
-- anyone remembering to create this row, and code that reads settings should
-- never have to handle "no row yet". The backfill below covers businesses that
-- already existed when this migration ran.
create or replace function public.create_default_notification_setting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_setting (business_id)
  values (new.id)
  on conflict (business_id) do nothing;
  return new;
end;
$$;

create trigger trg_business_default_notification_setting
  after insert on public.business
  for each row execute function public.create_default_notification_setting();

insert into public.notification_setting (business_id)
select id from public.business
on conflict (business_id) do nothing;
