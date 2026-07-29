// Module 9 §4 — throttling, batching and quiet hours. PURE LOGIC.
//
// No React, no Supabase, no clock of its own: every function takes `now` and its
// inputs and returns a typed decision. That is what makes notification hygiene
// testable (tests/domain/notify-policy.test.ts) rather than something you find
// out about when a customer is woken at 2am.
//
// "Every unnecessary notification trains people to ignore the necessary ones"
// (M9 §1). So the answer is never a boolean — a message is SENT, SCHEDULED for
// later, or SUPPRESSED WITH A REASON that is written to the outbox row. When an
// owner says "I never got told", `suppressed_reason` answers it.
//
// Timezone: quiet hours are evaluated in the BUSINESS timezone (M9 §8, M1) using
// src/lib/domain/timezone.ts. Nothing here does date arithmetic by hand, so the
// hour either side of a daylight-saving change lands on the right instant.

import {
  addDaysISO,
  minutesOfDay,
  wallDateIn,
  wallTimeIn,
  zonedInstant,
} from "../domain/timezone";
import { EVENTS, type EventCode } from "./events";

// ---------------------------------------------------------------------------
// Defaults (M9 §4, §5)
// ---------------------------------------------------------------------------
//
// SETTINGS SEAM: M9 §4/§5 call for these to be per-business columns. `business`
// has no such columns yet (migrations are owned by the database engineer), so
// the defaults live here and EVERY function takes the settings as a parameter.
// When the columns land, only the caller changes.

/** SMS quiet window, business time. 22:00 → 07:00 (M9 §4). */
export const DEFAULT_QUIET_HOURS = { startTime: "22:00", endTime: "07:00" } as const;

/** No more than this many SMS to one person per day; excess degrades to in-app. */
export const DEFAULT_DAILY_SMS_CAP = 5;

/** Identical event + recipient + target inside this window is one message. */
export const DEDUPE_WINDOW_SECONDS = 60;

/** How long claims on one shift collect before the manager is messaged (M9 §4). */
export const CLAIM_BATCH_WINDOW_MINUTES = 10;

/** Fraction of the monthly SMS budget at which the manager is warned (M9 §5). */
export const BUDGET_WARNING_FRACTION = 0.8;

export interface QuietHours {
  /** "HH:MM" business time when SMS goes quiet. */
  startTime: string;
  /** "HH:MM" business time when SMS resumes. */
  endTime: string;
}

export interface NotifySettings {
  quietHours: QuietHours;
  /** Per-person SMS per day (M9 §4). */
  dailySmsCap: number;
  /** Per-business SMS toggle — a business may run in-app only (M9 §5). */
  smsEnabled: boolean;
  dedupeWindowSeconds: number;
  claimBatchWindowMinutes: number;
}

export const DEFAULT_SETTINGS: NotifySettings = {
  quietHours: { ...DEFAULT_QUIET_HOURS },
  dailySmsCap: DEFAULT_DAILY_SMS_CAP,
  smsEnabled: true,
  dedupeWindowSeconds: DEDUPE_WINDOW_SECONDS,
  claimBatchWindowMinutes: CLAIM_BATCH_WINDOW_MINUTES,
};

/** Fill the gaps in a partial settings object with the documented defaults. */
export function resolveSettings(partial?: Partial<NotifySettings>): NotifySettings {
  return {
    ...DEFAULT_SETTINGS,
    ...partial,
    quietHours: { ...DEFAULT_SETTINGS.quietHours, ...partial?.quietHours },
  };
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export type NotifyChannel = "inapp" | "sms";

/**
 * Why a message was not sent, exactly as written to
 * `notification.suppressed_reason`. M9 §7 names four; the extra three record
 * situations §8 requires be logged rather than silently swallowed. The column is
 * free text precisely so this vocabulary can grow without a migration.
 */
export type SuppressedReason =
  /** Per-person daily SMS cap hit — the in-app copy still went (M9 §4). */
  | "rate_cap"
  /** Per-business monthly SMS budget exhausted (M9 §5). */
  | "budget"
  /** Recipient (or the business) has SMS off for this event (M9 §5, §6). */
  | "user_pref"
  /** Same event + recipient + target within the dedupe window (M9 §4). */
  | "duplicate"
  /** The event fired for a deactivated staff member (M9 §8). */
  | "inactive"
  /** Queued behind quiet hours, but the shift has since started (M9 §8). */
  | "stale"
  /** No mobile number on file — a texted deep link cannot reach them (M9 §8). */
  | "no_phone";

export type Decision =
  | { action: "send"; channel: NotifyChannel }
  /** Held for quiet hours (M9 §4); `scheduledFor` is a UTC instant. */
  | { action: "schedule"; channel: NotifyChannel; scheduledFor: string; reason: "quiet_hours" }
  | { action: "suppress"; channel: NotifyChannel; reason: SuppressedReason };

export interface RecipientState {
  userId: string;
  /** A deactivated staff member's notifications are suppressed and logged (§8). */
  active: boolean;
  /** No number → no SMS. In-app still accumulates for whenever they log in (§8). */
  hasPhone: boolean;
  /** The recipient has muted SMS for this event, where the event allows it (§6). */
  smsMuted?: boolean;
  /** SMS already sent to this person today, business time (§4 rate cap). */
  smsSentToday?: number;
  /**
   * Instants at which an identical (event, recipient, target) was already
   * enqueued — the de-duplication input (§4). Anything older than the window is
   * harmless to pass in.
   */
  recentIdenticalAt?: readonly string[];
}

export interface BusinessSmsBudget {
  /** Messages sent this month. */
  used: number;
  /** The cap, or null for "no budget configured". */
  limit: number | null;
}

export interface DeliveryInput {
  event: EventCode;
  now: Date;
  /** Business timezone (M1) — quiet hours are business time, never the phone's. */
  timezone: string;
  recipient: RecipientState;
  settings?: Partial<NotifySettings>;
  budget?: BusinessSmsBudget;
}

// ---------------------------------------------------------------------------
// Quiet hours (M9 §4)
// ---------------------------------------------------------------------------

/** Is `at` inside the business's quiet window? Handles the wrap over midnight. */
export function inQuietHours(at: Date, timezone: string, quiet: QuietHours): boolean {
  const minutes = minutesOfDay(wallTimeIn(at.toISOString(), timezone));
  const start = minutesOfDay(quiet.startTime);
  const end = minutesOfDay(quiet.endTime);
  if (start === end) return false; // a zero-length window silences nothing
  // 22:00 → 07:00 wraps midnight; 01:00 → 05:00 does not. Both are supported so
  // a business that changes the setting cannot accidentally invert it.
  return start > end ? minutes >= start || minutes < end : minutes >= start && minutes < end;
}

/**
 * The next instant quiet hours end, in the business timezone — when a held SMS
 * is released. Computed through `zonedInstant`, so 07:00 is 07:00 on both sides
 * of a DST change rather than an hour out.
 */
export function quietHoursRelease(at: Date, timezone: string, quiet: QuietHours): string {
  const iso = at.toISOString();
  const today = wallDateIn(iso, timezone);
  const endMinutes = minutesOfDay(quiet.endTime);
  const todayRelease = zonedInstant(today, endMinutes, timezone);
  if (todayRelease.getTime() > at.getTime()) return todayRelease.toISOString();
  return zonedInstant(addDaysISO(today, 1), endMinutes, timezone).toISOString();
}

// ---------------------------------------------------------------------------
// De-duplication (M9 §4)
// ---------------------------------------------------------------------------

/**
 * Has an identical message already been enqueued inside the window? Protects
 * against double-taps and retried requests, which is the difference between a
 * flaky network and a person's phone buzzing four times.
 */
export function isDuplicate(
  now: Date,
  recentIdenticalAt: readonly string[] | undefined,
  windowSeconds: number = DEDUPE_WINDOW_SECONDS,
): boolean {
  if (!recentIdenticalAt || recentIdenticalAt.length === 0) return false;
  const cutoff = now.getTime() - Math.max(0, windowSeconds) * 1000;
  return recentIdenticalAt.some((iso) => {
    const t = new Date(iso).getTime();
    // An unparseable timestamp must not suppress a real message.
    return Number.isFinite(t) && t >= cutoff && t <= now.getTime();
  });
}

// ---------------------------------------------------------------------------
// SMS budget (M9 §5)
// ---------------------------------------------------------------------------

export type BudgetLevel = "ok" | "warning" | "exhausted";

/**
 * Where this business sits against its monthly SMS budget. At 80% the manager is
 * warned; at 100% SMS degrades to in-app only. The product keeps working — it
 * just gets quieter (M9 §5).
 */
export function budgetLevel(budget?: BusinessSmsBudget): BudgetLevel {
  if (!budget || budget.limit === null || budget.limit <= 0) return "ok";
  if (budget.used >= budget.limit) return "exhausted";
  return budget.used >= budget.limit * BUDGET_WARNING_FRACTION ? "warning" : "ok";
}

// ---------------------------------------------------------------------------
// The decision (M9 §4 in order)
// ---------------------------------------------------------------------------

/**
 * What happens to this event, per channel.
 *
 * Returns one decision for each channel the CATALOGUE allows — so an event that
 * is in-app only can never acquire an SMS by accident, and an event that is not
 * in the catalogue at all cannot reach this function (the type forbids it).
 *
 * Order matters and is the order of M9 §4/§8:
 *   1. deactivated recipient  → suppress both, logged
 *   2. duplicate inside 60s   → suppress both
 *   3. in-app                 → always sent; free, silent, and the record
 *   4. SMS                    → business toggle → budget → user preference →
 *                               phone number → daily cap → quiet hours
 *
 * In-app is NEVER suppressed for a delivery reason. A person who has hit their
 * SMS cap still has every message waiting in the app — "excess degrades to
 * in-app only, never dropped silently" (M9 §4).
 */
export function decideDelivery(input: DeliveryInput): Decision[] {
  const spec = EVENTS[input.event];
  const settings = resolveSettings(input.settings);
  const channels: NotifyChannel[] = [
    ...(spec.inApp ? (["inapp"] as const) : []),
    ...(spec.sms ? (["sms"] as const) : []),
  ];

  // (1) The event fired for somebody who no longer works here (M9 §8).
  if (!input.recipient.active) {
    return channels.map((channel) => ({ action: "suppress", channel, reason: "inactive" }));
  }

  // (2) Double-tap, or a retried request after a flaky network (M9 §4).
  if (isDuplicate(input.now, input.recipient.recentIdenticalAt, settings.dedupeWindowSeconds)) {
    return channels.map((channel) => ({ action: "suppress", channel, reason: "duplicate" }));
  }

  return channels.map((channel) =>
    channel === "inapp"
      ? ({ action: "send", channel: "inapp" } as const)
      : smsDecision(input, settings, spec.timeCritical, spec.mutable),
  );
}

function smsDecision(
  input: DeliveryInput,
  settings: NotifySettings,
  timeCritical: boolean,
  mutable: boolean,
): Decision {
  const sms: NotifyChannel = "sms";

  // Per-business toggle: a business may run in-app only (M9 §5).
  if (!settings.smsEnabled) return { action: "suppress", channel: sms, reason: "user_pref" };

  // Monthly budget exhausted — degrade, never break (M9 §5).
  if (budgetLevel(input.budget) === "exhausted") {
    return { action: "suppress", channel: sms, reason: "budget" };
  }

  // Staff may mute SMS for NON-CRITICAL events only (M9 §6). Publication, shift
  // changes and "you're on" are operational and `mutable: false` in the
  // catalogue, so this branch cannot silence them however the flag is set.
  if (mutable && input.recipient.smsMuted) {
    return { action: "suppress", channel: sms, reason: "user_pref" };
  }

  // No number on file — logged, not swallowed. The manager sees the flag (§8).
  if (!input.recipient.hasPhone) {
    return { action: "suppress", channel: sms, reason: "no_phone" };
  }

  // Per-person daily cap; the in-app copy above still went (M9 §4).
  if ((input.recipient.smsSentToday ?? 0) >= settings.dailySmsCap) {
    return { action: "suppress", channel: sms, reason: "rate_cap" };
  }

  // Quiet hours — SMS only, and only for events that can wait. E10 ("you're on")
  // and E13 ("uncovered, starting soon") are time-critical by definition and go
  // straight out (M9 §4).
  if (!timeCritical && inQuietHours(input.now, input.timezone, settings.quietHours)) {
    return {
      action: "schedule",
      channel: sms,
      scheduledFor: quietHoursRelease(input.now, input.timezone, settings.quietHours),
      reason: "quiet_hours",
    };
  }

  return { action: "send", channel: sms };
}

// ---------------------------------------------------------------------------
// Release from the quiet-hours queue (M9 §8)
// ---------------------------------------------------------------------------

/**
 * Morning comes and a held SMS is due. If the thing it was about has already
 * happened, DISCARD it rather than send a pointless 7am text — the row is marked
 * suppressed so it is still visible, never silently lost.
 *
 * @param relevantUntil the instant the message stops being worth sending
 *                      (a shift's start), or null when it never goes stale.
 */
export function releaseDecision(
  now: Date,
  relevantUntil: string | null,
): { action: "send" } | { action: "suppress"; reason: SuppressedReason } {
  if (!relevantUntil) return { action: "send" };
  const until = new Date(relevantUntil).getTime();
  if (!Number.isFinite(until)) return { action: "send" };
  return until <= now.getTime() ? { action: "suppress", reason: "stale" } : { action: "send" };
}

// ---------------------------------------------------------------------------
// Batching (M9 §4)
// ---------------------------------------------------------------------------

export interface BatchTarget {
  shiftId?: string | null;
  rosterId?: string | null;
  userId?: string | null;
}

/**
 * The `notification_batch.key` this event collapses under, or null when it does
 * not batch. Two events sharing a key inside the window become ONE message.
 *
 *   E9  claims on one shift  → 'claims:shift_<id>'   ("3 people have offered…")
 *   E1  a published roster   → 'publish:roster_<id>:user_<id>'  (one per person)
 *   E2/E3/E4 bulk edits      → 'changes:roster_<id>:user_<id>'  (M9 §8: a manager
 *                              editing 10 shifts for one person sends ONE
 *                              "your shifts have changed", not ten)
 */
export function batchKey(event: EventCode, target: BatchTarget): string | null {
  switch (event) {
    case "E9":
      return target.shiftId ? `claims:shift_${target.shiftId}` : null;
    case "E1":
      return target.rosterId && target.userId
        ? `publish:roster_${target.rosterId}:user_${target.userId}`
        : null;
    case "E2":
    case "E3":
    case "E4":
      return target.rosterId && target.userId
        ? `changes:roster_${target.rosterId}:user_${target.userId}`
        : null;
    default:
      return null;
  }
}

/** When an open batch window closes — the instant the collapsed message goes. */
export function batchWindowEnd(
  now: Date,
  minutes: number = CLAIM_BATCH_WINDOW_MINUTES,
): string {
  return new Date(now.getTime() + Math.max(0, minutes) * 60_000).toISOString();
}

// ---------------------------------------------------------------------------
// Roster publish: ONE message per person, never one per shift (M9 §4)
// ---------------------------------------------------------------------------

export interface PublishShift {
  assignedUserId: string | null;
  /** "YYYY-MM-DD" trading day. */
  date: string;
}

export interface PublishRecipientPlan {
  userId: string;
  /** How many shifts they have in the published period. */
  shiftCount: number;
  /** Earliest and latest trading day they are on, for the summary line. */
  firstDate: string;
  lastDate: string;
}

/**
 * Turn a published roster's shifts into ONE plan per staff member.
 *
 * This function is the mechanism behind the acceptance criterion "Roster publish
 * sends exactly one SMS per staff member, not one per shift" (M9 §9). Because
 * the enqueue path takes plans rather than shifts, a fortnight with 14 shifts
 * for one person cannot produce 14 texts even by mistake.
 *
 * Unfilled positions (no assignee) produce no plan — there is nobody to tell.
 */
export function planRosterPublish(shifts: readonly PublishShift[]): PublishRecipientPlan[] {
  const byUser = new Map<string, PublishRecipientPlan>();
  for (const s of shifts) {
    if (!s.assignedUserId) continue;
    const found = byUser.get(s.assignedUserId);
    if (!found) {
      byUser.set(s.assignedUserId, {
        userId: s.assignedUserId,
        shiftCount: 1,
        firstDate: s.date,
        lastDate: s.date,
      });
      continue;
    }
    found.shiftCount += 1;
    if (s.date < found.firstDate) found.firstDate = s.date;
    if (s.date > found.lastDate) found.lastDate = s.date;
  }
  return [...byUser.values()].sort((a, b) => a.userId.localeCompare(b.userId));
}

/**
 * A republished roster must NOT re-blast everyone (M9 §8) — only the people
 * whose shifts actually changed are told, via E2/E3/E4. This decides which of
 * the two paths a publish takes.
 *
 * @param alreadyPublished whether this roster has been published before.
 */
export function publishEventFor(alreadyPublished: boolean): "E1" | null {
  return alreadyPublished ? null : "E1";
}
