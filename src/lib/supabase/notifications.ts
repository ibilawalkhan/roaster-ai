// Data access for Module 9 (Notifications) — the in-app list and the enqueue.
//
// READS/UPDATES go straight to Postgres under RLS. Migration 0008's
// `notification_select_own` / `notification_update_own` policies restrict every
// user to their OWN rows in their OWN business, so a manager cannot read their
// staff's notifications and no tenant can see another's. That is the boundary —
// this file is not.
//
// WRITES DO NOT. There is deliberately NO client INSERT policy on `notification`
// (migration 0008): if the browser could insert, anyone could fabricate "your
// shift was cancelled". Rows are written by trusted server code. So
// `enqueueNotifications` posts to /api/notify, a Next route handler that runs
// with the service-role key, re-verifies the caller's JWT, and re-checks every
// recipient against the caller's own business before inserting. The browser
// never holds the service-role key and never sees another tenant's ids.
//
// Nothing in this file throws into a business action: `notify()` wraps every
// call in its own try/catch (see src/lib/notify/index.ts). The reads DO throw —
// a notifications SCREEN that cannot load must say so and offer a retry.

import { getSupabaseClient } from "./client";
import type { Tables } from "./database.types";
import type { NotificationDraft } from "../notify";
import { isEventCode, type EventCode } from "../notify/events";

export type NotificationRow = Tables<"notification">;

/** A sane upper bound so no phone ever pulls an unbounded list. */
const MAX_ROWS = 100;

/**
 * A failure with a sentence a person can act on. Same shape and intent as
 * `SwapError` (src/lib/supabase/swaps.ts) so screens handle both identically.
 */
export class NotificationError extends Error {
  readonly cause: unknown;
  constructor(cause: unknown, message?: string) {
    super(message ?? "We couldn't load your notifications. Check your signal and try again.");
    this.name = "NotificationError";
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// The in-app list (M7 §3.5)
// ---------------------------------------------------------------------------

/** One row, flattened for the screen. The in-app row IS the in-app notification. */
export interface MyNotification {
  id: string;
  event: EventCode | null;
  title: string;
  body: string;
  /** App-relative deep link, e.g. "/me/shifts/abc". Null if the row predates it. */
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

interface StoredPayload {
  title?: unknown;
  body?: unknown;
  link?: unknown;
}

function mapNotification(row: NotificationRow): MyNotification {
  const payload: StoredPayload =
    typeof row.payload_json === "object" && row.payload_json !== null
      ? (row.payload_json as StoredPayload)
      : {};
  return {
    id: row.id,
    event: isEventCode(row.event_type) ? row.event_type : null,
    // A row whose copy is missing still renders as something honest rather than
    // an empty card — the event code is at least true.
    title: typeof payload.title === "string" ? payload.title : "Update",
    body: typeof payload.body === "string" ? payload.body : "",
    link: typeof payload.link === "string" ? payload.link : null,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

/**
 * The caller's recent in-app notifications, newest first.
 *
 * Only the `inapp` channel: the `sms` row for the same event is a DELIVERY
 * record, not a second message, and showing both would double every item in the
 * list. Suppressed and failed rows are excluded for the same reason — a message
 * that was never meant to reach this screen should not appear on it.
 */
export async function fetchMyNotifications(limit = 40): Promise<MyNotification[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("notification")
    .select("*")
    .eq("channel", "inapp")
    .in("status", ["pending", "sent"])
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, MAX_ROWS));
  if (error) throw new NotificationError(error);
  return (data ?? []).map(mapNotification);
}

/** How many unread in-app notifications the caller has — drives the bell badge. */
export async function fetchUnreadCount(): Promise<number> {
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from("notification")
    .select("id", { count: "exact", head: true })
    .eq("channel", "inapp")
    .in("status", ["pending", "sent"])
    .is("read_at", null);
  if (error) throw new NotificationError(error, "Couldn't check for new notifications.");
  return count ?? 0;
}

/**
 * Mark one as read. RLS scopes the update to the caller's own row, so an id from
 * anywhere else simply matches nothing — the `.select()` makes that visible
 * instead of reporting a success that never happened.
 */
export async function markNotificationRead(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("notification")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new NotificationError(error, "Couldn't mark that as read.");
  // No row means it was already read (or is not ours). Neither is an error.
  void data;
}

/** Mark everything currently unread as read. One round trip, RLS-scoped. */
export async function markAllNotificationsRead(): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("notification")
    .update({ read_at: new Date().toISOString() })
    .eq("channel", "inapp")
    .is("read_at", null);
  if (error) throw new NotificationError(error, "Couldn't mark those as read.");
}

/**
 * Live in-app updates while the app is open (M9 §3).
 *
 * SCOPED, never a global firehose (REQUIREMENTS.md §8): the subscription filters
 * on `user_id`, and RLS would refuse anything else anyway. Returns an
 * unsubscribe function; a realtime failure is not fatal — the list still loads
 * on mount and on pull-to-refresh.
 */
export function subscribeToMyNotifications(userId: string, onInsert: () => void): () => void {
  const supabase = getSupabaseClient();

  // The topic MUST be unique per subscription. supabase-js caches channels by
  // topic, so a fixed name hands back the channel from a previous mount — and
  // `.on()` after `subscribe()` throws. React mounts, cleans up and remounts in
  // development, and `removeChannel` is async, so the stale channel is still in
  // the registry when the second mount runs. A nonce sidesteps that entirely.
  const topic = `notification:${userId}:${Math.random().toString(36).slice(2, 10)}`;

  try {
    const channel = supabase
      .channel(topic)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notification",
          filter: `user_id=eq.${userId}`,
        },
        () => onInsert(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  } catch (e) {
    // Live updates are an enhancement, never a dependency: the list already
    // loaded on mount and "Check again" always works. Honour that promise —
    // a realtime fault must not take the screen down with it.
    console.warn("Realtime notifications unavailable; falling back to manual refresh.", e);
    return () => {};
  }
}

// ---------------------------------------------------------------------------
// The enqueue (M9 §3 — the outbox write)
// ---------------------------------------------------------------------------

/**
 * Hand outbox rows to the trusted server endpoint. Called only by `notify()`,
 * which swallows every failure — so a Twilio outage, a signed-out session or a
 * 500 here can never break the shift approval that triggered it.
 *
 * @returns how many rows the server accepted.
 */
export async function enqueueNotifications(
  drafts: readonly NotificationDraft[],
): Promise<number> {
  if (drafts.length === 0) return 0;
  const supabase = getSupabaseClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Not signed in — nothing was enqueued.");

  const response = await fetch("/api/notify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ drafts }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Enqueue failed (${response.status}): ${detail.slice(0, 300)}`);
  }
  const body: unknown = await response.json().catch(() => null);
  const enqueued =
    typeof body === "object" && body !== null && typeof (body as { enqueued?: unknown }).enqueued === "number"
      ? (body as { enqueued: number }).enqueued
      : 0;
  return enqueued;
}
