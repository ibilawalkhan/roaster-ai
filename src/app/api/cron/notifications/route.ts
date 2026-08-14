// Notification reconciliation sweep (M9 §3).
//
// `notify()` runs after the action commits, over a separate HTTP hop, so that a
// messaging failure can never undo a shift approval the manager has already
// been shown (CLAUDE.md rule 7). The cost of that ordering is a window: a crash
// or a 500 between the two loses the message while the action stands.
//
// `roster_change_log.notified` is the durable record M6 has been writing all
// along, waiting for exactly this. The sweep finds rows the live path never
// confirmed, sends what is genuinely missing, and closes them off.
//
// Delivery is therefore AT-LEAST-ONCE, not exactly-once — the honest guarantee
// for a post-commit sender. Duplicates are prevented by checking what has
// already been sent, not by hoping the first attempt worked.
//
// Same protection as the uncovered sweep: CRON_SECRET, fails closed.

import { createClient } from "@supabase/supabase-js";
import { buildNotificationDrafts, type NotifyRecipient } from "@/lib/notify";
import { periodWhen, shiftWhen } from "@/lib/notify/labels";
import {
  reconcileChangeLog,
  type ChangeLogEntry,
  type PendingNotification,
} from "@/lib/domain/notification-reconcile";
import type { EventCode } from "@/lib/notify/events";
import type { TablesInsert } from "@/lib/supabase/database.types";

const MAX_ROWS_PER_RUN = 500;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The payload each event needs. Kept beside the mapping it serves. */
function payloadFor(
  event: EventCode,
  p: PendingNotification,
  when: string,
  startAt: string | null,
): Record<string, unknown> {
  switch (event) {
    case "E1":
      return { rosterId: p.rosterId, when, shiftCount: 0 };
    case "E5":
      return { rosterId: p.rosterId, when };
    case "E2":
    case "E3":
    case "E4":
      return { shiftId: p.shiftId, rosterId: p.rosterId, when, startAt };
    default:
      return { rosterId: p.rosterId, when };
  }
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

  const { data: logRows, error: logError } = await service
    .from("roster_change_log")
    .select("id, business_id, roster_id, shift_id, action, before_json, after_json, changed_at")
    .eq("notified", false)
    .order("changed_at")
    .limit(MAX_ROWS_PER_RUN);

  if (logError) return json({ error: "query_failed", detail: logError.message }, 500);
  if (!logRows || logRows.length === 0) return json({ scanned: 0, sent: 0 }, 200);

  // What has already gone out, so a message the live path delivered is never
  // repeated. Scoped to the events this sweep can raise.
  const { data: sentRows } = await service
    .from("notification")
    .select("event_type, user_id, payload_json")
    .in("event_type", ["E1", "E2", "E3", "E4", "E5"]);

  const alreadySent = new Set<string>();
  for (const row of sentRows ?? []) {
    const payload = row.payload_json as { shiftId?: unknown; rosterId?: unknown } | null;
    const target =
      (typeof payload?.shiftId === "string" && payload.shiftId) ||
      (typeof payload?.rosterId === "string" && payload.rosterId) ||
      "";
    alreadySent.add(`${row.event_type}:${target}:${row.user_id}`);
    alreadySent.add(`${row.event_type}:${target}:all`);
  }

  const entries: ChangeLogEntry[] = logRows.map((r) => ({
    id: r.id,
    businessId: r.business_id,
    rosterId: r.roster_id,
    shiftId: r.shift_id,
    action: r.action,
    before: r.before_json as ChangeLogEntry["before"],
    after: r.after_json as ChangeLogEntry["after"],
    changedAt: r.changed_at,
  }));

  const { pending, silent } = reconcileChangeLog(entries, alreadySent, now);

  // Business timezones — "when" and quiet hours are business-local (M1 §3.1).
  const businessIds = [...new Set(pending.map((p) => p.businessId))];
  const { data: businessRows } = businessIds.length
    ? await service.from("business").select("id, timezone").in("id", businessIds)
    : { data: [] };
  const timezoneOf = new Map((businessRows ?? []).map((b) => [b.id, b.timezone]));

  // Shift start times, for the "when" line on shift-level events.
  const shiftIds = [...new Set(pending.map((p) => p.shiftId).filter((v): v is string => !!v))];
  const { data: shiftRows } = shiftIds.length
    ? await service.from("shift").select("id, start_at").in("id", shiftIds)
    : { data: [] };
  const startOf = new Map((shiftRows ?? []).map((s) => [s.id, s.start_at]));

  const rows: TablesInsert<"notification">[] = [];
  const handled = new Set<string>();

  for (const p of pending) {
    const timezone = timezoneOf.get(p.businessId) ?? "Australia/Sydney";
    const startAt = p.shiftId ? (startOf.get(p.shiftId) ?? null) : null;
    const when = startAt ? shiftWhen(startAt, timezone) : periodWhen(now.toISOString(), timezone);

    // A fan-out event (publish/withdraw) needs the people actually rostered.
    let userIds: string[] = [];
    if (p.userId) {
      userIds = [p.userId];
    } else {
      const { data: assignees } = await service
        .from("shift")
        .select("assigned_user_id")
        .eq("roster_id", p.rosterId)
        .not("assigned_user_id", "is", null);
      userIds = [
        ...new Set(
          (assignees ?? [])
            .map((a) => a.assigned_user_id)
            .filter((v): v is string => typeof v === "string"),
        ),
      ];
    }
    if (userIds.length === 0) {
      handled.add(p.logId);
      continue;
    }

    const recipients: NotifyRecipient[] = userIds.map((id) => ({ userId: id }));

    const drafts = buildNotificationDrafts({
      event: p.event,
      businessId: p.businessId,
      timezone,
      recipients,
      // The payload shape is per-event; the catalogue's renderer validates it.
      payload: payloadFor(p.event, p, when, startAt) as never,
      now,
    });

    for (const draft of drafts) {
      if (!draft.userId) continue;
      rows.push({
        business_id: p.businessId,
        user_id: draft.userId,
        event_type: draft.eventType,
        channel: draft.channel,
        status: draft.status,
        suppressed_reason: draft.suppressedReason,
        scheduled_for: draft.scheduledFor,
        payload_json: draft.payload as unknown as TablesInsert<"notification">["payload_json"],
      });
    }
    handled.add(p.logId);
  }

  if (rows.length > 0) {
    const { error: insertError } = await service.from("notification").insert(rows);
    if (insertError) {
      // Do NOT mark the log rows notified — leaving them false means the next
      // run tries again, which is the whole point of at-least-once.
      return json({ error: "enqueue_failed", detail: insertError.message }, 500);
    }
  }

  // Close off everything settled this run: sent, plus the ones nobody needed.
  const toClose = [...new Set([...handled, ...silent])];
  if (toClose.length > 0) {
    await service.from("roster_change_log").update({ notified: true }).in("id", toClose);
  }

  return json(
    { scanned: logRows.length, sent: rows.length, closed: toClose.length },
    200,
  );
}
