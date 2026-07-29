// Module 9 §3 — `notify()`, the ONE channel-agnostic entry point every feature
// calls (TECH_STACK §3.4). Import this; never write a `notification` row by hand,
// and never call Twilio from a feature.
//
// THE LOAD-BEARING RULE OF THIS MODULE (CLAUDE.md rule 7, M9 §1):
//
//     A failed notification must never fail the action that triggered it.
//
// It is enforced structurally, not by asking callers to be careful:
//
//   * `notify()` returns `Promise<NotifyOutcome>` and its ENTIRE body is inside
//     one try/catch. It has no throw path. A Twilio outage, an RLS refusal, a
//     dropped connection, a malformed payload — all come back as
//     `{ ok: false, error }`, never as a rejected promise. A shift approval that
//     calls it therefore cannot be rolled back by it.
//   * the returned promise never rejects, so `void notify(...)` at a call site
//     cannot produce an unhandled rejection either.
//   * it ENQUEUES; it does not send. Delivery is the worker's job
//     (supabase/functions/notify-worker), so the caller never waits on Twilio.
//
// TRANSACTIONALITY — read this before assuming the outbox is complete.
// M9 §3 wants the `notification` rows written in the SAME transaction as the
// triggering action. The truly atomic version of that lives inside the SECURITY
// DEFINER RPCs (supabase/migrations/0007, 0011) — owned by the database
// engineer. Until those RPCs write their own outbox rows, this module enqueues
// immediately AFTER the action has been confirmed by the server. The trade-off
// is deliberate and is the safe direction: a crash between the two loses a
// NOTIFICATION (recoverable — `roster_change_log.notified` and
// `shift_swap_event` are the durable seams a sweeper can replay from), whereas
// enqueuing first could announce a change that never happened. Nothing here can
// undo the action, which is the property that actually matters.

import {
  EVENTS,
  deepLinkFor,
  relevantUntil,
  renderEvent,
  targetKeyFor,
  type EventCode,
  type EventPayloadMap,
} from "./events";
import {
  batchKey,
  decideDelivery,
  type BusinessSmsBudget,
  type NotifyChannel,
  type NotifySettings,
  type RecipientState,
  type SuppressedReason,
} from "./policy";

export type { EventCode, EventPayloadMap } from "./events";
export type { NotifySettings, SuppressedReason } from "./policy";

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

/** One person this event is for, plus the throttling state known about them. */
export interface NotifyRecipient extends Omit<RecipientState, "active" | "hasPhone"> {
  /** Defaults to true; pass false for a deactivated staff member (M9 §8). */
  active?: boolean;
  /** Defaults to true; pass false when there is no mobile number on file. */
  hasPhone?: boolean;
}

/**
 * "Every manager of this business, whoever they are."
 *
 * Staff CANNOT read the team list — migration 0002 lets a non-manager select
 * only their own `app_user` row, which is exactly right and is why a staff
 * member has no way to learn who the managers are. But E6 (drop requested) and
 * E9 (shift claimed) are triggered BY staff and addressed TO the manager. So the
 * recipient list for those is resolved by the trusted server endpoint, which can
 * see the team; the browser never learns the answer.
 *
 * It is the ONLY server-side expansion, and it only ever expands to managers of
 * the CALLER'S OWN business (src/app/api/notify/route.ts).
 */
export const MANAGERS = "managers" as const;
export type ManagerRecipients = typeof MANAGERS;

export interface NotifyRequest<K extends EventCode = EventCode> {
  /** A code from the M9 §2 catalogue. The type is the gate: nothing else exists. */
  event: K;
  businessId: string;
  /** Business timezone (M1) — quiet hours are business time (M9 §8). */
  timezone: string;
  /**
   * Who is told, or `MANAGERS` to have the server resolve them.
   *
   * For an explicit list the CALLER applies the catalogue's recipient rule
   * (eligible staff only for E8, the other claimants for E11, …) because only
   * the caller knows who those people are. The catalogue records the rule so a
   * reviewer can check the call site against it in one line.
   */
  recipients: readonly NotifyRecipient[] | ManagerRecipients;
  payload: EventPayloadMap[K];
  now?: Date;
  settings?: Partial<NotifySettings>;
  budget?: BusinessSmsBudget;
  /** Overrides the catalogue's de-dup/batch target when the caller knows better. */
  targetKey?: string;
}

/** What gets written to `payload_json`. Rendered here so the worker stays dumb. */
export interface NotificationPayload {
  title: string;
  body: string;
  /** SMS sentence without the URL; the worker appends the absolute deep link. */
  smsText: string;
  /** App-relative path, e.g. "/me/shifts/abc" (M9 §3 — never a home screen). */
  link: string;
  /** De-duplication / batching target, e.g. "shift:abc". */
  targetKey: string;
  /** Batch this collapses under, or null (M9 §4). */
  batchKey: string | null;
  /** Instant after which a queued SMS is stale and discarded (M9 §8). */
  relevantUntil: string | null;
  /** Anything the screen needs to render, straight from the event payload. */
  data: Record<string, unknown>;
}

/** One outbox row, ready to insert. Mirrors `notification` (migration 0008). */
export interface NotificationDraft {
  businessId: string;
  /** Null only when `recipientRule` asks the server to resolve the recipients. */
  userId: string | null;
  /** Set to 'manager' when the server must fan this row out to the managers. */
  recipientRule: "manager" | null;
  eventType: EventCode;
  channel: NotifyChannel;
  status: "pending" | "suppressed";
  suppressedReason: SuppressedReason | null;
  /** Set when held behind quiet hours; null means "as soon as the worker runs". */
  scheduledFor: string | null;
  payload: NotificationPayload;
}

export interface NotifyOutcome {
  /** False when the enqueue itself failed. The caller's action is unaffected. */
  ok: boolean;
  /** Rows accepted by the server (pending + suppressed — both are records). */
  enqueued: number;
  /** The rows that were built, whether or not they were accepted. */
  drafts: NotificationDraft[];
  /** Diagnostic text for Sentry / the console. Never shown to a user. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Building the rows (pure — exported so it can be unit-tested)
// ---------------------------------------------------------------------------

/**
 * Turn one request into outbox rows: the catalogue decides the channels and the
 * copy, the policy decides send / schedule / suppress.
 *
 * A SUPPRESSED row is still written. That is the point of §7's
 * `suppressed_reason`: "I never got told" must always be answerable, and a
 * decision nobody recorded is indistinguishable from a bug.
 */
export function buildNotificationDrafts<K extends EventCode>(
  request: NotifyRequest<K>,
): NotificationDraft[] {
  const spec = EVENTS[request.event];
  const now = request.now ?? new Date();
  const rendered = renderEvent(request.event, request.payload);
  const target = request.targetKey ?? targetKeyFor(request.event, request.payload);
  const stale = relevantUntil(request.event, request.payload);
  const data: Record<string, unknown> = { ...request.payload };

  // A server-resolved audience is one anonymous "recipient": the policy inputs
  // that vary per person (mute, daily SMS count) are not knowable here, so the
  // documented defaults apply and the quiet-hours / dedupe rules — which do not
  // depend on WHO — still hold.
  const recipients: readonly NotifyRecipient[] =
    request.recipients === MANAGERS ? [{ userId: "" }] : request.recipients;
  const serverResolved = request.recipients === MANAGERS;

  const drafts: NotificationDraft[] = [];
  for (const recipient of recipients) {
    const decisions = decideDelivery({
      event: spec.code,
      now,
      timezone: request.timezone,
      settings: request.settings,
      budget: request.budget,
      recipient: {
        userId: recipient.userId,
        active: recipient.active ?? true,
        hasPhone: recipient.hasPhone ?? true,
        smsMuted: recipient.smsMuted,
        smsSentToday: recipient.smsSentToday,
        recentIdenticalAt: recipient.recentIdenticalAt,
      },
    });

    const payload: NotificationPayload = {
      title: rendered.title,
      body: rendered.body,
      smsText: rendered.smsText,
      link: deepLinkFor(request.event, request.payload),
      targetKey: target,
      batchKey: batchKey(spec.code, {
        shiftId: typeof data.shiftId === "string" ? data.shiftId : null,
        rosterId: typeof data.rosterId === "string" ? data.rosterId : null,
        userId: serverResolved ? "manager" : recipient.userId,
      }),
      relevantUntil: stale,
      data,
    };

    for (const decision of decisions) {
      drafts.push({
        businessId: request.businessId,
        userId: serverResolved ? null : recipient.userId,
        recipientRule: serverResolved ? "manager" : null,
        eventType: spec.code,
        channel: decision.channel,
        status: decision.action === "suppress" ? "suppressed" : "pending",
        suppressedReason: decision.action === "suppress" ? decision.reason : null,
        scheduledFor: decision.action === "schedule" ? decision.scheduledFor : null,
        payload,
      });
    }
  }
  return drafts;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * Where drafts go. Swappable so the policy and the catalogue can be tested
 * without a network, and so a future sender (WhatsApp, email — M9 §10) is a new
 * transport rather than a redesign.
 */
export interface NotifyTransport {
  enqueue(drafts: readonly NotificationDraft[]): Promise<number>;
}

let transport: NotifyTransport | null = null;

/** Install a transport (tests, or a server-side runner). Pass null to reset. */
export function setNotifyTransport(next: NotifyTransport | null): void {
  transport = next;
}

/**
 * The default transport: the trusted server enqueue endpoint.
 *
 * Imported lazily so that importing `notify` in a pure unit test — or in any
 * context without Supabase env vars — cannot throw at module load. A failure to
 * even load the transport is just another swallowed enqueue failure.
 */
async function defaultTransport(): Promise<NotifyTransport> {
  const mod = await import("../supabase/notifications");
  return { enqueue: (drafts) => mod.enqueueNotifications(drafts) };
}

// ---------------------------------------------------------------------------
// notify()
// ---------------------------------------------------------------------------

/**
 * Enqueue a catalogued event. Never throws, never rejects, never blocks on a
 * network send — see the module header.
 *
 * Typical call site (note the `void`: the action does not wait on the outbox):
 *
 *     await approveClaim(shiftId, claimId);      // the action, which may throw
 *     void notify({ event: "E10", … });          // the message, which cannot
 */
export async function notify<K extends EventCode>(
  request: NotifyRequest<K>,
): Promise<NotifyOutcome> {
  let drafts: NotificationDraft[] = [];
  try {
    if (request.recipients !== MANAGERS && request.recipients.length === 0) {
      // Nobody to tell. Not an error — an open shift with no eligible staff is a
      // real situation, and it must not look like a failure.
      return { ok: true, enqueued: 0, drafts: [], error: null };
    }
    drafts = buildNotificationDrafts(request);
    const t = transport ?? (await defaultTransport());
    const enqueued = await t.enqueue(drafts);
    return { ok: true, enqueued, drafts, error: null };
  } catch (e) {
    // The whole point of this catch. The triggering action has already happened
    // and stays happened; the message is what failed, and it is logged loudly
    // enough to be found in Sentry without disturbing the person on the phone.
    const error = e instanceof Error ? e.message : String(e);
    reportNotifyFailure(request.event, error, e);
    return { ok: false, enqueued: 0, drafts, error };
  }
}

/**
 * Log an enqueue failure. Deliberately console-only for now: Sentry is wired at
 * the app shell (CLAUDE.md tech stack) and picks console errors up, and reaching
 * for a reporting client here would give this module a way to throw.
 */
function reportNotifyFailure(event: EventCode, message: string, cause: unknown): void {
  try {
    console.error(`[notify] ${event} could not be enqueued: ${message}`, cause);
  } catch {
    // Even logging must not throw into a caller. There is nothing left to do.
  }
}
