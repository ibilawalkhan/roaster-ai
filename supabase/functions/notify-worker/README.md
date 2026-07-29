# notify-worker

The Module 9 outbox drain. Runs on a schedule, picks up `notification` rows that
are `pending` and due, delivers them, and records the outcome on the row.

Features never call this. They call `notify()` (`src/lib/notify/index.ts`), which
only writes rows — so a Twilio outage can never roll back a shift approval
(M9 §1, CLAUDE.md rule 7).

## What one run does

| Row | Action |
|---|---|
| `channel = 'inapp'` | Already delivered — the row *is* the in-app notification and Realtime has streamed it. Stamped `sent`. |
| `channel = 'sms'`, stale | The shift it was about has started (queued behind quiet hours overnight). Marked `suppressed` / `stale` — never sent as a pointless 7am text (M9 §8). |
| `channel = 'sms'`, no number or deactivated recipient | Marked `suppressed` / `no_phone` or `inactive`. Logged, never swallowed (M9 §8). |
| `channel = 'sms'` | Sent via Twilio with the absolute deep link appended. `sent_at`, `attempts` recorded. |
| Twilio failure | `attempts + 1`, `last_error` recorded, retried after 1 / 5 / 25 minutes; on the 3rd attempt the row lands in a **visible `failed` state** (M9 §3). |

## Environment

Set as function secrets — never in the client, never in `NEXT_PUBLIC_*`.

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Injected by the platform. |
| `SUPABASE_SERVICE_ROLE_KEY` | Injected by the platform. Lets the worker write delivery fields no user may write. |
| `TWILIO_ACCOUNT_SID` | Twilio account. |
| `TWILIO_AUTH_TOKEN` | Twilio auth token. |
| `TWILIO_FROM_NUMBER` | Sending number, E.164 with `+`. |
| `PUBLIC_APP_URL` | Origin prefixed to the app-relative deep link, e.g. `https://app.rosterly.com.au`. A relative path is useless in a text message. |
| `NOTIFY_WORKER_SECRET` | Optional. When set, the function requires a matching `x-notify-worker-secret` header — draining is not a public operation. |

```bash
supabase secrets set \
  TWILIO_ACCOUNT_SID=AC... \
  TWILIO_AUTH_TOKEN=... \
  TWILIO_FROM_NUMBER=+61400000000 \
  PUBLIC_APP_URL=https://app.rosterly.com.au \
  NOTIFY_WORKER_SECRET=$(openssl rand -hex 24)
```

## Deploy

```bash
supabase functions deploy notify-worker --no-verify-jwt
```

`--no-verify-jwt` because the caller is `pg_cron`, not a signed-in user; the
`NOTIFY_WORKER_SECRET` header is the gate instead.

## Cron

Every 5 minutes is the right cadence: quiet-hours releases and batch windows are
measured in tens of minutes, and time-critical events (E10 "you're on",
E13 "uncovered, starting soon") tolerate a few minutes' latency by design.

Run once, in the SQL editor of the target project (staging first — CLAUDE.md
rule 9):

```sql
select cron.schedule(
  'notify-worker',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://<project-ref>.supabase.co/functions/v1/notify-worker',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-notify-worker-secret', '<NOTIFY_WORKER_SECRET>'
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

Requires the `pg_cron` and `pg_net` extensions (both available on hosted
Supabase). To stop it: `select cron.unschedule('notify-worker');`.

## Manual drain / smoke test

```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/notify-worker \
  -H "x-notify-worker-secret: <NOTIFY_WORKER_SECRET>"
# {"picked":3,"sent":3,"failed":0,"suppressed":0}
```

## Watching it

Nothing is silently lost, so everything is a query:

```sql
-- what failed, and why
select event_type, channel, attempts, last_error, created_at
from notification
where status = 'failed'
order by created_at desc;

-- what was deliberately not sent, and why (answers "I never got told")
select event_type, suppressed_reason, count(*)
from notification
where status = 'suppressed'
group by 1, 2;
```

## Local development

This file is Deno, not Next.js — it is excluded from the app's `tsconfig.json`
and ESLint config, so `npx tsc --noEmit` and `npx eslint` do not cover it.
Running it needs Docker (`supabase functions serve notify-worker`), which the
current dev environment does not have; it is verified by deployment to staging.
