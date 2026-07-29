// Module 9 §3 — the OUTBOX DRAIN. A Supabase Edge Function (Deno), run on cron.
//
// This is the only place in Rosterly that talks to Twilio. Nothing in the app
// calls it; features call `notify()`, which writes a `notification` row and
// returns. This worker picks those rows up afterwards. That separation is what
// makes "a Twilio outage cannot roll back a shift approval" true rather than
// aspirational (M9 §1, CLAUDE.md rule 7).
//
// What one run does:
//   1. claim up to BATCH_SIZE `pending` rows whose `scheduled_for` has passed
//      (null = due now), oldest first;
//   2. IN-APP rows are already delivered — the row IS the in-app notification,
//      and Supabase Realtime has streamed it to any open client (M9 §3). The
//      worker only stamps `sent_at`/`status` so the list and the audit agree;
//   3. SMS rows go to Twilio. Before sending it re-checks staleness (M9 §8): a
//      text held overnight about a shift that has since started is DISCARDED and
//      marked `suppressed`, never delivered at 7am as a pointless buzz;
//   4. every outcome is recorded — `attempts`, `last_error`, `sent_at`. Failures
//      back off and retry, and after MAX_ATTEMPTS land in a visible `failed`
//      state. Nothing is ever silently lost (M9 §9).
//
// CREDENTIALS come from the function's environment and never from a client:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER,
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PUBLIC_APP_URL.
// The service-role key is what lets this function write delivery fields that no
// user may write; it exists only inside the function.
//
// This file is Deno, not Next.js: it is excluded from the app's tsconfig and
// eslint, and cannot be executed locally without Docker/`supabase functions
// serve`. See README.md beside it for deploy + cron.

// @ts-nocheck — Deno remote-module types are not resolvable from the Next.js
// toolchain; this file is deployed and type-checked by `deno`/`supabase`.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Rows drained per run. Small enough that one bad batch cannot stall the queue. */
const BATCH_SIZE = 100;

/** M9 §3: three attempts, then a visible failed state. */
const MAX_ATTEMPTS = 3;

/** Backoff before an attempt is retried: 1 min, then 5, then 25. */
const BACKOFF_MINUTES = [1, 5, 25];

const env = (name: string): string => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
};

const optionalEnv = (name: string): string | null => Deno.env.get(name) ?? null;

// ---------------------------------------------------------------------------
// Twilio
// ---------------------------------------------------------------------------

interface SmsResult {
  ok: boolean;
  /** Twilio's message SID when sent — the handle for reconciling the bill (§5). */
  sid: string | null;
  error: string | null;
}

/**
 * Send one SMS. Plain `fetch` against the Twilio REST API rather than the SDK:
 * one HTTP call, no dependency to keep current in an edge runtime.
 *
 * `to` is E.164 WITHOUT the leading "+" in our database (see
 * src/lib/supabase/auth.ts), so it is added back here.
 */
async function sendSms(to: string, body: string): Promise<SmsResult> {
  const sid = env("TWILIO_ACCOUNT_SID");
  const authToken = env("TWILIO_AUTH_TOKEN");
  const from = env("TWILIO_FROM_NUMBER");

  const form = new URLSearchParams({
    To: to.startsWith("+") ? to : `+${to}`,
    From: from,
    Body: body,
  });

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${sid}:${authToken}`)}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { ok: false, sid: null, error: `Twilio ${response.status}: ${detail.slice(0, 400)}` };
  }
  const payload = await response.json().catch(() => ({}));
  return { ok: true, sid: typeof payload.sid === "string" ? payload.sid : null, error: null };
}

// ---------------------------------------------------------------------------
// The drain
// ---------------------------------------------------------------------------

interface NotificationRow {
  id: string;
  business_id: string;
  user_id: string;
  event_type: string;
  channel: "inapp" | "sms";
  attempts: number;
  scheduled_for: string | null;
  payload_json: {
    smsText?: string;
    link?: string;
    relevantUntil?: string | null;
  } | null;
}

/** Absolute deep link for an SMS. Relative paths are useless in a text message. */
function absoluteLink(path: string): string {
  const origin = (optionalEnv("PUBLIC_APP_URL") ?? "https://app.rosterly.com.au").replace(
    /\/+$/,
    "",
  );
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

Deno.serve(async (request: Request): Promise<Response> => {
  // The function is invoked by cron (or by hand for a manual drain). Anything
  // else is refused: draining is not a public operation.
  const expected = optionalEnv("NOTIFY_WORKER_SECRET");
  if (expected) {
    const provided = request.headers.get("x-notify-worker-secret");
    if (provided !== expected) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    }
  }

  const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  const nowISO = new Date().toISOString();

  // Due = pending, and either unscheduled or past its quiet-hours release.
  const { data: due, error: readError } = await supabase
    .from("notification")
    .select("id, business_id, user_id, event_type, channel, attempts, scheduled_for, payload_json")
    .eq("status", "pending")
    .or(`scheduled_for.is.null,scheduled_for.lte.${nowISO}`)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (readError) {
    return new Response(JSON.stringify({ error: readError.message }), { status: 500 });
  }

  const rows = (due ?? []) as NotificationRow[];
  let sent = 0;
  let failed = 0;
  let suppressed = 0;

  for (const row of rows) {
    try {
      // --- in-app: the row itself is the message; Realtime already pushed it ---
      if (row.channel === "inapp") {
        await supabase
          .from("notification")
          .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
          .eq("id", row.id);
        sent += 1;
        continue;
      }

      // --- M9 §8: queued behind quiet hours, and now stale ---
      const relevantUntil = row.payload_json?.relevantUntil ?? null;
      if (relevantUntil && new Date(relevantUntil).getTime() <= Date.now()) {
        await supabase
          .from("notification")
          .update({ status: "suppressed", suppressed_reason: "stale" })
          .eq("id", row.id);
        suppressed += 1;
        continue;
      }

      // --- SMS ---
      const { data: recipient } = await supabase
        .from("app_user")
        .select("phone, active")
        .eq("id", row.user_id)
        .maybeSingle();

      if (!recipient?.active || !recipient.phone) {
        // A deactivated staff member or a missing number (M9 §8): logged with a
        // reason so the manager's team screen can show "couldn't reach Ahmed",
        // never silently swallowed.
        await supabase
          .from("notification")
          .update({
            status: "suppressed",
            suppressed_reason: recipient?.active === false ? "inactive" : "no_phone",
          })
          .eq("id", row.id);
        suppressed += 1;
        continue;
      }

      const text = row.payload_json?.smsText ?? "Rosterly: there's an update on your roster.";
      const link = row.payload_json?.link ? ` ${absoluteLink(row.payload_json.link)}` : "";
      const result = await sendSms(recipient.phone, `${text}${link}`);
      const attempts = row.attempts + 1;

      if (result.ok) {
        await supabase
          .from("notification")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            attempts,
            last_error: null,
          })
          .eq("id", row.id);
        sent += 1;
        continue;
      }

      // Retry with backoff, then a VISIBLE failed state (M9 §3, §9).
      const exhausted = attempts >= MAX_ATTEMPTS;
      const delay = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
      await supabase
        .from("notification")
        .update({
          status: exhausted ? "failed" : "pending",
          attempts,
          last_error: result.error,
          scheduled_for: exhausted
            ? row.scheduled_for
            : new Date(Date.now() + delay * 60_000).toISOString(),
        })
        .eq("id", row.id);
      failed += 1;
    } catch (e) {
      // One poisoned row must never stop the drain. Record and move on.
      const attempts = row.attempts + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      const delay = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
      await supabase
        .from("notification")
        .update({
          status: exhausted ? "failed" : "pending",
          attempts,
          last_error: e instanceof Error ? e.message : String(e),
          scheduled_for: exhausted
            ? row.scheduled_for
            : new Date(Date.now() + delay * 60_000).toISOString(),
        })
        .eq("id", row.id);
      failed += 1;
    }
  }

  return new Response(JSON.stringify({ picked: rows.length, sent, failed, suppressed }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
