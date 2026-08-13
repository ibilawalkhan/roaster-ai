// The uncovered-shift sweep (M8 §7, M9 E13).
//
// A shift that was dropped and never picked up still legally belongs to the
// dropper — but if nobody notices, nobody turns up. CLAUDE.md rule 4 says a
// shift is never quietly owned by nobody, and this endpoint is what makes that
// promise true after everyone has stopped looking at the screen.
//
// It ONLY raises an alarm. It never reassigns, reverts or otherwise mutates a
// roster: silently rewriting who works tomorrow on a timer would be far more
// dangerous than the problem it solves.
//
// Runs across ALL businesses, so it holds the service-role key and bypasses
// RLS. It therefore does its own scoping: every notification row is written
// with the business_id of the shift it concerns, and managers are looked up per
// business — a manager of one restaurant can never be told about another's.
//
// Scheduled by Vercel Cron (see vercel.json). Protected by CRON_SECRET so the
// endpoint cannot be triggered by anyone who finds the URL.

import { createClient } from "@supabase/supabase-js";
import { buildNotificationDrafts, MANAGERS } from "@/lib/notify";
import { shiftWhen } from "@/lib/notify/labels";
import {
  DEFAULT_LEAD_HOURS,
  selectUncoveredAlerts,
  UNCOVERED_STATUSES,
  type SweepShift,
} from "@/lib/domain/uncovered";
import type { TablesInsert } from "@/lib/supabase/database.types";

/** Never let one run stampede: a backlog this large means something else is wrong. */
const MAX_ALERTS_PER_RUN = 200;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Fail CLOSED. An unset secret must not silently expose the endpoint — unlike
  // the solver's dev-friendly fallback, nothing here needs to work locally
  // without configuration.
  if (!secret) return json({ error: "cron_not_configured" }, 503);

  const presented =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ??
    request.headers.get("x-cron-key")?.trim() ??
    "";
  if (presented !== secret) return json({ error: "unauthorised" }, 401);

  if (!supabaseUrl || !serviceKey) return json({ error: "server_misconfigured" }, 500);

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();
  const horizon = new Date(now.getTime() + DEFAULT_LEAD_HOURS * 3_600_000);

  // Candidate shifts: unsettled in the swap flow and starting inside the window.
  const { data: shiftRows, error: shiftError } = await service
    .from("shift")
    .select("id, business_id, status, start_at, roster_id")
    .in("status", [...UNCOVERED_STATUSES])
    .gte("start_at", now.toISOString())
    .lte("start_at", horizon.toISOString());

  if (shiftError) return json({ error: "query_failed", detail: shiftError.message }, 500);
  if (!shiftRows || shiftRows.length === 0) return json({ scanned: 0, alerted: 0 }, 200);

  // Which of these has already been alerted about? One query, not one per shift.
  const { data: priorRows } = await service
    .from("notification")
    .select("payload_json")
    .eq("event_type", "E13");

  const alerted = new Set<string>();
  for (const row of priorRows ?? []) {
    const payload = row.payload_json as { shiftId?: unknown } | null;
    if (payload && typeof payload.shiftId === "string") alerted.add(payload.shiftId);
  }

  const candidates: SweepShift[] = shiftRows.map((s) => ({
    id: s.id,
    businessId: s.business_id,
    status: s.status,
    startAt: s.start_at,
    alreadyAlerted: alerted.has(s.id),
  }));

  const due = selectUncoveredAlerts(candidates, now).slice(0, MAX_ALERTS_PER_RUN);
  if (due.length === 0) return json({ scanned: shiftRows.length, alerted: 0 }, 200);

  // Managers, grouped per business — the scoping this route must impose itself.
  const businessIds = [...new Set(due.map((a) => a.businessId))];
  const { data: managerRows, error: managerError } = await service
    .from("app_user")
    .select("id, business_id")
    .in("business_id", businessIds)
    .eq("is_manager", true)
    .eq("active", true);

  if (managerError) return json({ error: "query_failed", detail: managerError.message }, 500);

  // Each business keeps its own timezone (M1 §3.1). "Starts in about 3 hours"
  // and the quiet-hours decision are both business-local, so this must come
  // from the row, never from the server's clock or a hard-coded default.
  const { data: businessRows } = await service
    .from("business")
    .select("id, timezone")
    .in("id", businessIds);

  const timezoneOf = new Map<string, string>(
    (businessRows ?? []).map((b) => [b.id, b.timezone]),
  );

  const managersByBusiness = new Map<string, string[]>();
  for (const m of managerRows ?? []) {
    const list = managersByBusiness.get(m.business_id) ?? [];
    list.push(m.id);
    managersByBusiness.set(m.business_id, list);
  }

  const rows: TablesInsert<"notification">[] = [];
  for (const alert of due) {
    const managerIds = managersByBusiness.get(alert.businessId) ?? [];
    if (managerIds.length === 0) continue; // nobody to tell; nothing to write

    const timezone = timezoneOf.get(alert.businessId) ?? "Australia/Sydney";

    const drafts = buildNotificationDrafts({
      event: "E13",
      businessId: alert.businessId,
      timezone,
      recipients: MANAGERS,
      payload: {
        shiftId: alert.shiftId,
        when: shiftWhen(alert.startAt, timezone),
        startAt: alert.startAt,
        hoursUntilStart: alert.hoursUntilStart,
      },
      now,
    });

    for (const draft of drafts) {
      for (const userId of managerIds) {
        rows.push({
          business_id: alert.businessId,
          user_id: userId,
          event_type: draft.eventType,
          channel: draft.channel,
          status: draft.status,
          suppressed_reason: draft.suppressedReason,
          scheduled_for: draft.scheduledFor,
          payload_json: draft.payload as unknown as TablesInsert<"notification">["payload_json"],
        });
      }
    }
  }

  if (rows.length === 0) return json({ scanned: shiftRows.length, alerted: 0 }, 200);

  const { error: insertError } = await service.from("notification").insert(rows);
  if (insertError) return json({ error: "enqueue_failed", detail: insertError.message }, 500);

  return json(
    { scanned: shiftRows.length, alerted: due.length, notifications: rows.length },
    200,
  );
}
