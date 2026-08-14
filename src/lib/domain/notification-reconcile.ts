// Reconciling missed notifications (M9 §3).
//
// THE GAP THIS CLOSES. `notify()` runs AFTER the server has confirmed the
// action, over a separate HTTP hop. That ordering is deliberate — a Twilio
// outage must never undo an approval the manager has already been shown
// (CLAUDE.md rule 7) — but it means a crash, a dropped connection or a 500
// between the two loses the message. The action stands; nobody is told.
//
// A true single-transaction outbox would have the SQL functions write the
// notification row themselves. They can't, without duplicating the rendering in
// PL/pgSQL, and two copies of the copy would drift (TECH_STACK §7). So instead
// this is honest AT-LEAST-ONCE delivery: `roster_change_log.notified` is the
// durable record of "something happened", a sweep finds rows the live path
// never confirmed, and the existing per-event de-duplication stops anyone being
// told twice.
//
// Pure and clock-injected, so the mapping is testable without a database.

import type { EventCode } from "../notify/events";

/** The actions M6 records. Only some of them are anyone's business. */
export type ChangeAction =
  | "assign"
  | "reassign"
  | "remove"
  | "add_position"
  | "delete_position"
  | "edit_times"
  | "lock"
  | "unlock"
  | "publish"
  | "unpublish";

export interface ChangeLogEntry {
  id: string;
  businessId: string;
  rosterId: string;
  shiftId: string | null;
  action: string;
  /** The shift row before the change, when the action captured one. */
  before: { assigned_user_id?: string | null } | null;
  after: { assigned_user_id?: string | null } | null;
  changedAt: string;
}

/** One notification the sweep should raise. */
export interface PendingNotification {
  logId: string;
  businessId: string;
  rosterId: string;
  shiftId: string | null;
  event: EventCode;
  /** The person to tell. Null means "everyone rostered" (a publish/withdraw). */
  userId: string | null;
}

export interface ReconcileResult {
  /** Messages to send. */
  pending: PendingNotification[];
  /**
   * Log rows to mark notified WITHOUT sending anything — internal bookkeeping
   * like lock/unlock that no staff member needs to hear about. Draining these
   * matters: an ever-growing backlog of unnotified rows hides the real ones.
   */
  silent: string[];
}

/**
 * How long the live path gets before the sweep assumes it failed.
 *
 * `notify()` is synchronous with the request, so anything still unconfirmed
 * after this genuinely did not land. Too short and the sweep races the live
 * path into duplicates; too long and a staff member learns late.
 */
export const GRACE_MINUTES = 10;

/** Actions nobody is notified about — see ReconcileResult.silent. */
const SILENT_ACTIONS = new Set<ChangeAction>([
  "lock",
  "unlock",
  "add_position",
  "delete_position",
]);

/**
 * Decide what still needs sending.
 *
 * `alreadySent` holds `"<event>:<shiftId>:<userId>"` keys already present in the
 * notification table, so a message the live path DID deliver is never repeated.
 */
export function reconcileChangeLog(
  entries: readonly ChangeLogEntry[],
  alreadySent: ReadonlySet<string>,
  now: Date,
  graceMinutes: number = GRACE_MINUTES,
): ReconcileResult {
  const cutoff = now.getTime() - graceMinutes * 60_000;
  const pending: PendingNotification[] = [];
  const silent: string[] = [];

  for (const entry of entries) {
    const changedMs = Date.parse(entry.changedAt);
    // Still inside the grace window: the live path may yet succeed. Leave it.
    if (Number.isNaN(changedMs) || changedMs > cutoff) continue;

    const action = entry.action as ChangeAction;

    if (SILENT_ACTIONS.has(action)) {
      silent.push(entry.id);
      continue;
    }

    const base = {
      logId: entry.id,
      businessId: entry.businessId,
      rosterId: entry.rosterId,
      shiftId: entry.shiftId,
    };

    const before = entry.before?.assigned_user_id ?? null;
    const after = entry.after?.assigned_user_id ?? null;

    switch (action) {
      case "publish":
        pending.push({ ...base, event: "E1", userId: null });
        break;
      case "unpublish":
        pending.push({ ...base, event: "E5", userId: null });
        break;
      case "assign":
        if (after) pending.push({ ...base, event: "E4", userId: after });
        break;
      case "remove":
        if (before) pending.push({ ...base, event: "E3", userId: before });
        break;
      case "reassign":
        // Two people to tell, and the order matters to nobody but the tests:
        // the person losing the shift must hear as surely as the one gaining it.
        if (before && before !== after) {
          pending.push({ ...base, event: "E3", userId: before });
        }
        if (after && after !== before) {
          pending.push({ ...base, event: "E4", userId: after });
        }
        break;
      case "edit_times":
        if (after) pending.push({ ...base, event: "E2", userId: after });
        break;
      default:
        // An action we don't recognise is still drained, so it can't silently
        // accumulate and mask the entries that do matter.
        silent.push(entry.id);
        continue;
    }

    // A change whose notification already exists needs no resend, but the log
    // row must still be closed off.
    const produced = pending.filter((p) => p.logId === entry.id);
    if (produced.length === 0) silent.push(entry.id);
  }

  // Drop anything the live path already delivered.
  const deduped = pending.filter(
    (p) => !alreadySent.has(`${p.event}:${p.shiftId ?? p.rosterId}:${p.userId ?? "all"}`),
  );

  // A row whose every message was already sent is complete — mark it, don't resend.
  const stillSending = new Set(deduped.map((p) => p.logId));
  for (const p of pending) {
    if (!stillSending.has(p.logId) && !silent.includes(p.logId)) silent.push(p.logId);
  }

  return { pending: deduped, silent };
}
