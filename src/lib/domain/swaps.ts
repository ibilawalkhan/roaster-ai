// Pure logic for Module 8 (Shift swaps: drop → claim → approve).
//
// No React, no Supabase, no I/O — so every rule below is unit-testable without a
// browser or a database. The transactional heart of M8 is NOT here and never
// should be: `request_drop`, `claim_shift` and `approve_claim` are SECURITY
// DEFINER functions in supabase/migrations/0007_swaps.sql, proven by
// tests/db/swap-concurrency.test.ts. This module only does the two things the
// database cannot do for us:
//
//   1. decide whether a drop may still be SELF-requested (the 4-hour cutoff,
//      M8 §3.1) — a policy about phones and service, not about data integrity;
//   2. turn a Postgres exception into a sentence a kitchen hand can act on
//      (M8 §5) — the database raises 'shift is no longer available'; a person
//      needs "Sorry, this shift has already been filled."
//
// Australian English throughout (CLAUDE.md code style).

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** The M8 §2 state machine, as stored on `shift.status`. */
export type SwapStatus = "assigned" | "drop_requested" | "open" | "claimed_pending";

/**
 * The single most important sentence in Module 8 (M8 §3.1).
 *
 * A dropper who believes the app has taken the shift off them, and then doesn't
 * turn up, is the most damaging misunderstanding this product can produce. It is
 * a constant so it reads identically everywhere it appears.
 */
export const STILL_ROSTERED_NOTICE =
  "You're still rostered until your manager confirms.";

/**
 * How close to the start a drop may still be self-requested (M8 §3.1).
 *
 * SEAM: M8 §3.1 calls for this to be a per-business setting. There is no column
 * for it on `business` or `scheduling_rule` yet, so the default is applied here
 * and every caller passes it explicitly. When the column lands, only the caller
 * changes — the rule below already takes the cutoff as a parameter.
 */
export const DEFAULT_DROP_CUTOFF_HOURS = 4;

/**
 * How far ahead an unfilled open shift starts shouting at the manager (M8 §7).
 * The alert is M9's job to deliver; the queue uses this to flag the row.
 */
export const DEFAULT_UNCOVERED_LEAD_HOURS = 12;

const MS_PER_HOUR = 3_600_000;

// ---------------------------------------------------------------------------
// The cutoff (M8 §3.1)
// ---------------------------------------------------------------------------

export interface DropWindow {
  /** Hours from now until the shift starts. Negative once it has started. */
  hoursUntilStart: number;
  /** The shift is under way (or over). */
  started: boolean;
  /** Inside the cutoff window, but not yet started. */
  withinCutoff: boolean;
  /** May the staff member still request cover through the app? */
  canRequest: boolean;
  /**
   * What to tell them when they can't, ready to render. Null when they can.
   * "A drop request 20 minutes before service is not an app problem" (M8 §3.1),
   * so the answer is always to phone a human, never a dead-end error.
   */
  reason: string | null;
}

/** "in 3 hours" / "in 45 minutes" — plain, and never rounded up into a lie. */
function untilLabel(hours: number): string {
  const minutes = Math.max(0, Math.floor(hours * 60));
  if (minutes < 60) return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  const whole = Math.floor(minutes / 60);
  return whole === 1 ? "1 hour" : `${whole} hours`;
}

/**
 * May this shift still be dropped through the app, and if not, what do we say?
 *
 * Reasoned over real instants so a shift either side of a daylight-saving change
 * is measured honestly (CLAUDE.md rule 8). An unparseable start is treated as
 * "too late": refusing to act is safe, quietly acting on a NaN is not.
 */
export function dropWindow(
  startAtISO: string,
  now: Date,
  cutoffHours: number = DEFAULT_DROP_CUTOFF_HOURS,
): DropWindow {
  const start = new Date(startAtISO).getTime();
  if (!Number.isFinite(start)) {
    return {
      hoursUntilStart: 0,
      started: false,
      withinCutoff: true,
      canRequest: false,
      reason: "We can't read this shift's start time. Speak to your manager directly.",
    };
  }

  const hoursUntilStart = (start - now.getTime()) / MS_PER_HOUR;
  const started = hoursUntilStart <= 0;
  const cutoff = Math.max(0, cutoffHours);
  const withinCutoff = !started && hoursUntilStart < cutoff;

  if (started) {
    return {
      hoursUntilStart,
      started: true,
      withinCutoff: false,
      canRequest: false,
      reason: "This shift has already started. Phone your manager — don't rely on the app.",
    };
  }

  if (withinCutoff) {
    return {
      hoursUntilStart,
      started: false,
      withinCutoff: true,
      canRequest: false,
      reason: `This shift starts in ${untilLabel(hoursUntilStart)}. Phone your manager now — the app can't organise cover this close to service.`,
    };
  }

  return {
    hoursUntilStart,
    started: false,
    withinCutoff: false,
    canRequest: true,
    reason: null,
  };
}

/**
 * An open shift close enough to its start that the manager needs telling
 * (M8 §7). The shift NEVER reverts to nobody — the dropper stays responsible —
 * so this is a prompt, not a state change.
 */
export function isUncoveredSoon(
  startAtISO: string,
  now: Date,
  leadHours: number = DEFAULT_UNCOVERED_LEAD_HOURS,
): boolean {
  const start = new Date(startAtISO).getTime();
  if (!Number.isFinite(start)) return false;
  const hours = (start - now.getTime()) / MS_PER_HOUR;
  return hours < leadHours;
}

// ---------------------------------------------------------------------------
// Postgres exceptions → sentences a person can act on (M8 §5)
// ---------------------------------------------------------------------------

export type SwapErrorKind =
  /** The shift was filled (or withdrawn) under us — refresh and re-read. */
  | "already_filled"
  /** This particular claim has already been decided. */
  | "claim_decided"
  /** Gone, or never visible to this tenant (RLS reports both identically). */
  | "not_found"
  /** Manager-only action attempted by staff. */
  | "not_manager"
  /** Staff tried to drop somebody else's shift. */
  | "not_owner"
  /** A cover request for this shift is already under way. */
  | "drop_in_progress"
  /** The database's no-double-booking guard (migration 0010) refused. */
  | "overlap"
  | "not_authenticated"
  /** The write was silently filtered by RLS — nothing changed. */
  | "not_permitted"
  | "unknown";

export interface SwapFailure {
  kind: SwapErrorKind;
  /** One sentence, ready to render. Australian English, no jargon, no codes. */
  message: string;
  /** True when the screen's data is now known to be stale and must be re-read. */
  refresh: boolean;
}

/**
 * The raw text of whatever the data layer threw. supabase-js rejects with a
 * PostgrestError — a plain object with a `message`, NOT an Error — so this
 * deliberately accepts both rather than assuming `instanceof Error`.
 */
function rawMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const candidate = error as { message?: unknown };
    if (typeof candidate.message === "string") return candidate.message;
  }
  return "";
}

/**
 * Classify a failure from one of the swap RPCs (or a swap table write).
 *
 * Matching is on the exception text raised by 0007_swaps.sql / 0010's overlap
 * trigger. Those strings are a contract between the migration and this function
 * — if one changes, tests/domain/swaps.test.ts fails, which is the point.
 */
export function classifySwapError(error: unknown): SwapFailure {
  const text = rawMessage(error).toLowerCase();

  // The loser of the approval race (M8 §5). Named first because it is the one
  // message this whole module exists to get right.
  if (text.includes("no longer available") || text.includes("already been filled")) {
    return {
      kind: "already_filled",
      message: "Sorry, this shift has already been filled.",
      refresh: true,
    };
  }

  if (text.includes("claim is no longer pending")) {
    return {
      kind: "claim_decided",
      message: "That cover request has already been decided by someone else.",
      refresh: true,
    };
  }

  if (text.includes("only a manager")) {
    return {
      kind: "not_manager",
      message: "Only a manager can approve cover. Ask your manager to approve this one.",
      refresh: false,
    };
  }

  if (text.includes("only drop your own shift")) {
    return {
      kind: "not_owner",
      message: "You can only request cover for your own shift.",
      refresh: true,
    };
  }

  if (text.includes("already has a cover request")) {
    return {
      kind: "drop_in_progress",
      message: "A cover request for this shift is already with your manager.",
      refresh: true,
    };
  }

  // Migration 0010's guard: the claimant picked up an overlapping shift between
  // claiming and approval (M8 §7 — a physical overlap is blocked, not warned).
  if (text.includes("shift_no_overlap") || text.includes("overlapping shift")) {
    return {
      kind: "overlap",
      message:
        "They're already rostered on a shift that overlaps this one, so they can't cover it. Pick someone else.",
      refresh: true,
    };
  }

  if (text.includes("shift not found")) {
    return {
      kind: "not_found",
      message: "That shift is no longer on the roster. It may have been changed or removed.",
      refresh: true,
    };
  }

  if (text.includes("not authenticated")) {
    return {
      kind: "not_authenticated",
      message: "You've been signed out. Sign in again, then try once more.",
      refresh: false,
    };
  }

  if (text.includes("row-level security") || text.includes("permission denied")) {
    return {
      kind: "not_permitted",
      message: "You're not allowed to make that change. Nothing was saved.",
      refresh: true,
    };
  }

  return {
    kind: "unknown",
    message: "That didn't go through. Nothing has been confirmed — check your signal and try again.",
    refresh: true,
  };
}

/** The sentence only — for callers that just need something to show. */
export function swapErrorMessage(error: unknown): string {
  return classifySwapError(error).message;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** What the MANAGER's queue calls each state. */
export function managerStatusLabel(status: SwapStatus): string {
  switch (status) {
    case "drop_requested":
      return "Cover requested";
    case "open":
      return "Open to team";
    case "claimed_pending":
      return "Claimed — needs approval";
    case "assigned":
      return "Covered";
  }
}

/**
 * What the STAFF member sees on their own shift, or null when there is nothing
 * to say. Every non-assigned state repeats that they remain responsible, because
 * that is exactly the moment the misunderstanding happens (M8 §3.1).
 */
export function staffStatusHeadline(status: SwapStatus): string | null {
  switch (status) {
    case "drop_requested":
      return "Cover requested — waiting for manager";
    case "open":
      return "Your manager has opened this shift to the team";
    case "claimed_pending":
      return "Someone has offered to cover — waiting for manager";
    case "assigned":
      return null;
  }
}
