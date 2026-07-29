// Data access for Module 8 (Shift swaps: drop → claim → approve).
//
// THE RULE THIS FILE EXISTS TO OBEY: the three state transitions that must be
// atomic are NOT implemented here. `request_drop`, `claim_shift` and
// `approve_claim` are SECURITY DEFINER functions in
// supabase/migrations/0007_swaps.sql, proven by tests/db/swap-concurrency.test.ts
// (16 tests). Approval in particular is THE critical section (CLAUDE.md rule 3):
// it re-reads the shift under `select … for update` and re-checks its status, so
// two concurrent approvals produce exactly one winner and the loser fails
// cleanly with 'shift is no longer available'. Re-implementing any of that in
// TypeScript would replace a proven guarantee with a race. The wrappers below
// call the RPCs and translate their exceptions; that is all.
//
// Errors: every function throws a `SwapError` whose `message` is already the
// sentence to show a person (M8 §5) — the mapping lives in the pure
// src/lib/domain/swaps.ts so it is unit-testable without a database.
//
// SECURITY: RLS (migrations 0006, 0007) is the boundary, not this file.
//   * staff have NO write policy on `shift` or on `shift_claim.outcome` — the
//     only staff-side writes in M8 are the two RPCs;
//   * a manager's table writes are business-scoped by `shift_write_manager`.
// Because a policy filters silently rather than erroring, every manager write
// below asks for the row back and treats "no row" as a failure. A write that
// changed nothing must never be reported as success (M7 §5, M8 acceptance).
//
// NOTIFICATIONS ARE M9. Nothing here sends anything. The RPCs already write the
// `shift_swap_event` audit; see the seam note on `declineDrop` for the manager
// transitions that cannot yet write one.

import { getSupabaseClient } from "./client";
import type { Enums, Tables } from "./database.types";
import { classifySwapError, type SwapErrorKind } from "../domain/swaps";

export type ShiftRow = Tables<"shift">;
export type ShiftClaimRow = Tables<"shift_claim">;
export type SwapEventRow = Tables<"shift_swap_event">;

/** A sane upper bound so no screen can pull an unbounded list onto a phone. */
const MAX_ROWS = 200;

/**
 * A failure with a message a kitchen hand can act on.
 *
 * `kind` lets a screen react as well as report — an `already_filled` failure
 * means the list on screen is stale and must be re-read, not just apologised for.
 */
export class SwapError extends Error {
  readonly kind: SwapErrorKind;
  /** True when the screen's data is now known to be stale. */
  readonly refresh: boolean;
  /** The original Postgres/PostgREST error, for Sentry. */
  readonly cause: unknown;

  constructor(error: unknown) {
    const failure = classifySwapError(error);
    super(failure.message);
    this.name = "SwapError";
    this.kind = failure.kind;
    this.refresh = failure.refresh;
    this.cause = error;
  }
}

// ---------------------------------------------------------------------------
// The three RPCs (M8 §3.1, §3.3, §3.4)
// ---------------------------------------------------------------------------

/**
 * "I can't make this shift" (M8 §3.1). Staff, own ASSIGNED shift only.
 *
 * The dropper stays the assignee — the shift moves to `drop_requested` and only
 * the MANAGER is told. Nothing is broadcast to the team here, ever (M8 §1).
 *
 * @param reason optional short note; trimmed, empty becomes null.
 */
export async function requestDrop(shiftId: string, reason?: string | null): Promise<ShiftRow> {
  const supabase = getSupabaseClient();
  const trimmed = reason?.trim();
  const { data, error } = await supabase.rpc("request_drop", {
    p_shift_id: shiftId,
    p_reason: trimmed ? trimmed : null,
  });
  if (error) throw new SwapError(error);
  return data;
}

/**
 * "I can cover this" (M8 §3.3). Idempotent by construction: the RPC inserts
 * `on conflict do nothing` against the unique (shift_id, claimant_user_id), so a
 * double-tap or a retried request yields ONE claim and returns it, rather than
 * erroring or creating a duplicate (M8 §5).
 *
 * Claiming a shift that was filled a moment ago raises 'sorry, this shift has
 * already been filled', which surfaces as exactly that sentence.
 */
export async function claimShift(shiftId: string): Promise<ShiftClaimRow> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("claim_shift", { p_shift_id: shiftId });
  if (error) throw new SwapError(error);
  return data;
}

/**
 * THE CRITICAL SECTION (M8 §5, CLAUDE.md rule 3) — manager only.
 *
 * One transaction: lock the shift, re-check it is still open/claimed_pending,
 * reassign it, approve the winning claim, reject every other pending claim,
 * write the audit event. Concurrent approvals: exactly one wins; the loser gets
 * 'shift is no longer available' → "Sorry, this shift has already been filled."
 *
 * Re-validation of the claimant against the M5 §5.1 hard constraints is the
 * caller's job (M8 §5) and is done with the shared `checkEligibility` on the
 * approval screen. The one constraint the DATABASE re-checks regardless is the
 * no-double-booking guard (migration 0010), which surfaces here as an
 * `overlap` failure — a claimant who picked up a clashing shift since claiming
 * is refused rather than warned (M8 §7).
 */
export async function approveClaim(shiftId: string, claimId: string): Promise<ShiftRow> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("approve_claim", {
    p_shift_id: shiftId,
    p_claim_id: claimId,
  });
  if (error) throw new SwapError(error);
  return data;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The swap states a shift can be in while it is still somebody's problem. */
const IN_FLIGHT: Enums<"shift_status">[] = ["drop_requested", "open", "claimed_pending"];

/**
 * Shifts a staff member could offer to cover (M8 §3.3).
 *
 * VISIBILITY SEAM — read this before wondering why the list is empty.
 * Migration 0006's `shift_select` policy lets a NON-MANAGER read a shift only
 * when `assigned_user_id = current_app_user_id()`. An open shift still belongs
 * to the dropper (that is the whole point — a shift is never quietly ownerless,
 * M8 §7), so today this query returns nothing for staff. Making M8 §3.3 fully
 * true needs a SECURITY DEFINER RPC in `supabase/**` — owned by the database
 * engineer — that returns the OPEN shifts of the caller's business and nothing
 * else. When it lands, only the body of this function changes: the return type,
 * the eligibility gate on top of it, and the screen are already the right shape.
 * Until then the open-shifts screen says only that nothing is LISTED — it never
 * claims there is nothing going.
 *
 * The caller's own shifts are excluded: you cannot cover your own drop.
 *
 * @param fromISO UTC instant; shifts already finished are never offered.
 * @param userId  the caller, so their own dropped shift never appears.
 */
export async function fetchOpenShiftsForMe(
  fromISO: string,
  userId?: string | null,
): Promise<ShiftRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("shift")
    .select("*")
    .in("status", ["open", "claimed_pending"])
    .gte("start_at", fromISO)
    .order("start_at")
    .limit(MAX_ROWS);
  if (error) throw new SwapError(error);
  const rows = data ?? [];
  return userId ? rows.filter((s) => s.assigned_user_id !== userId) : rows;
}

/**
 * The manager's drop-request queue (M8 §3.2): every shift with a swap in flight,
 * soonest first. Manager-only by RLS.
 *
 * Filtered on `end_at` rather than `start_at` so a request on a shift already
 * under way is still shown — that is the one the manager most needs to see.
 */
export async function fetchDropRequests(fromISO: string): Promise<ShiftRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("shift")
    .select("*")
    .in("status", IN_FLIGHT)
    .gte("end_at", fromISO)
    .order("start_at")
    .limit(MAX_ROWS);
  if (error) throw new SwapError(error);
  return data ?? [];
}

/** Every claim on one shift, oldest first (first in, first listed). */
export async function fetchClaimsForShift(shiftId: string): Promise<ShiftClaimRow[]> {
  return fetchClaimsForShifts([shiftId]);
}

/**
 * Claims across several shifts in one round trip — the queue renders every
 * request with its claimants, and N+1 queries on a manager's phone is a
 * noticeably slower screen.
 */
export async function fetchClaimsForShifts(shiftIds: string[]): Promise<ShiftClaimRow[]> {
  if (shiftIds.length === 0) return [];
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("shift_claim")
    .select("*")
    .in("shift_id", shiftIds)
    .order("created_at")
    .limit(MAX_ROWS);
  if (error) throw new SwapError(error);
  return data ?? [];
}

/**
 * Every shift in a date window — the raw material for the shared eligibility
 * check at approval time (overlap, weekly hours, rest, consecutive days).
 * Manager-only by RLS; the staff app never calls this.
 */
export async function fetchShiftsInWindow(
  fromDate: string,
  toDate: string,
): Promise<ShiftRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("shift")
    .select("*")
    .gte("date", fromDate)
    .lte("date", toDate)
    .order("start_at")
    .limit(MAX_ROWS * 5);
  if (error) throw new SwapError(error);
  return data ?? [];
}

/** The audit trail for one shift, newest first (M8 §6). Read-only, always. */
export async function fetchSwapEvents(shiftId: string): Promise<SwapEventRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("shift_swap_event")
    .select("*")
    .eq("shift_id", shiftId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new SwapError(error);
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Manager transitions (M8 §3.2)
// ---------------------------------------------------------------------------
//
// AUDIT SEAM: `shift_swap_event` has no client INSERT policy by design (M11 §8 —
// the audit cannot be forged), so it is written only by the SECURITY DEFINER
// RPCs. The three manager transitions below are ordinary table updates and
// therefore leave no swap-event row. Closing that gap means three more RPCs
// (`decline_drop`, `open_shift_to_team`, `cancel_open_shift`) in
// supabase/migrations, owned by the database engineer; this file is deliberately
// not allowed to widen the audit table's policy to compensate. Every one of
// these transitions IS still fully visible in the shift row itself
// (status + drop_requested_by + drop_reason), so nothing becomes ambiguous —
// only the "who pressed it, when" line is missing until the RPCs land.

/**
 * Move a shift to a new status and hand back the row the server actually wrote.
 *
 * `guardedStatuses` is re-checked in the WHERE clause, so this update is a
 * compare-and-set: if another manager (or an approval) moved the shift first,
 * zero rows match and the caller is told the truth instead of overwriting a
 * decision it never saw. That is the same "never a silent overwrite" rule the
 * approve_claim critical section enforces, applied to the cheaper transitions.
 */
/**
 * Call one of the atomic swap-transition functions (migration 0011).
 *
 * Each does the status change, any claim clean-up and the audit row in a single
 * transaction, so there is no window in which the app and the audit trail
 * disagree. Postgres exceptions carry the human message (see classifySwapError).
 */
/**
 * Manager assigns someone directly instead of opening the shift (M8 §3.2).
 *
 * Goes through the RPC so the assignment, the rejection of every outstanding
 * claim, the pay-rate snapshot and the audit row happen in ONE transaction.
 * The previous plain UPDATE left volunteers' phones saying "waiting for
 * manager" forever — and one of them might have turned up.
 */
export async function reassignDirectly(shiftId: string, userId: string): Promise<ShiftRow> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("reassign_shift", {
    p_shift_id: shiftId,
    p_user_id: userId,
  });
  if (error) throw new SwapError(error);
  if (!data) throw new SwapError(new Error("shift is no longer available"));
  return data as ShiftRow;
}

async function callTransitionRpc(
  fn: "decline_drop" | "open_shift_to_team" | "cancel_open_shift",
  shiftId: string,
): Promise<ShiftRow> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(fn, { p_shift_id: shiftId });
  if (error) throw new SwapError(error);
  if (!data) throw new SwapError(new Error("shift is no longer available"));
  return data as ShiftRow;
}

async function setShiftStatus(
  shiftId: string,
  to: Enums<"shift_status">,
  guardedStatuses: Enums<"shift_status">[],
): Promise<ShiftRow> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("shift")
    .update({ status: to })
    .eq("id", shiftId)
    .in("status", guardedStatuses)
    .select("*")
    .maybeSingle();
  if (error) throw new SwapError(error);
  if (!data) {
    // Either RLS filtered the row (not a manager, wrong tenant) or the status
    // moved underneath us. Both mean: don't claim anything happened.
    throw new SwapError(new Error("shift is no longer available"));
  }
  return data;
}

/** Mark every still-pending claim on a shift as rejected. Manager-only by RLS. */
async function rejectPendingClaims(shiftId: string, actorId: string | null): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("shift_claim")
    .update({
      outcome: "rejected",
      decided_at: new Date().toISOString(),
      decided_by: actorId,
    })
    .eq("shift_id", shiftId)
    .eq("outcome", "pending");
  if (error) throw new SwapError(error);
}

/**
 * "Decline" (M8 §3.2). The shift stays exactly where it was — with the dropper,
 * who is still the assignee — and simply stops being a request.
 *
 * The drop reason and `drop_requested_by` are deliberately LEFT on the row: they
 * are the record of what happened, and clearing them would erase the only trace
 * a declined request ever existed.
 */
export async function declineDrop(shiftId: string): Promise<ShiftRow> {
  return callTransitionRpc("decline_drop", shiftId);
}

/**
 * "Open to team" (M8 §3.2). This is the ONLY thing that makes a dropped shift
 * visible to anyone but the manager — the manager is the gate (M8 §1).
 *
 * The dropper remains `assigned_user_id` until a claim is approved, so the shift
 * is never ownerless while it is open (M8 §7, CLAUDE.md rule 4).
 */
export async function openShiftToTeam(shiftId: string): Promise<ShiftRow> {
  return callTransitionRpc("open_shift_to_team", shiftId);
}

/**
 * "Cancel" an open shift (M8 §7) — it reverts to the dropper, who still has it.
 * Any outstanding claims are rejected in the same breath so nobody is left
 * believing they might still be given the shift.
 */
export async function cancelOpenShift(shiftId: string): Promise<ShiftRow> {
  // One transaction (migration 0011): status reverts to the dropper, every
  // outstanding claim is rejected, and the transition is audited together — so
  // a failure can never leave claimants believing they might still get it.
  return callTransitionRpc("cancel_open_shift", shiftId);
}

/**
 * The dropper changes their mind (M8 §7) — allowed while `drop_requested` or
 * `open`, never once a claim has been approved.
 *
 * PERMISSION SEAM: staff have no UPDATE policy on `shift`, so today this
 * succeeds only for a MANAGER acting on the dropper's behalf; a staff member
 * calling it gets "You're not allowed to make that change. Nothing was saved."
 * rather than a silent no-op, because `setShiftStatus` insists on the row coming
 * back. Self-service withdrawal needs a fourth SECURITY DEFINER RPC
 * (`withdraw_drop`) in supabase/migrations. The staff UI therefore does not
 * offer this button; it tells them to speak to their manager, which is the
 * truth today.
 */
export async function withdrawDrop(
  shiftId: string,
  actorId: string | null,
): Promise<ShiftRow> {
  const shift = await setShiftStatus(shiftId, "assigned", ["drop_requested", "open"]);
  await rejectPendingClaims(shiftId, actorId);
  return shift;
}

/**
 * A claimant withdraws before approval (M8 §7). The claim becomes `withdrawn`;
 * if it was the last pending claim the shift returns to `open`, so the manager's
 * queue stops showing an approval that can no longer happen.
 *
 * PERMISSION SEAM: as with `withdrawDrop`, `shift_claim` has an insert-own but
 * no update-own policy, so today this is a manager action. `.select()` makes a
 * blocked write fail loudly instead of pretending.
 */
export async function withdrawClaim(
  claimId: string,
  actorId: string | null,
): Promise<ShiftClaimRow> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("shift_claim")
    .update({
      outcome: "withdrawn",
      decided_at: new Date().toISOString(),
      decided_by: actorId,
    })
    .eq("id", claimId)
    .eq("outcome", "pending")
    .select("*")
    .maybeSingle();
  if (error) throw new SwapError(error);
  if (!data) throw new SwapError(new Error("claim is no longer pending"));

  const remaining = await fetchClaimsForShift(data.shift_id);
  if (!remaining.some((c) => c.outcome === "pending")) {
    // Last one out — the shift is open again rather than stuck awaiting an
    // approval nobody can give.
    await setShiftStatus(data.shift_id, "open", ["claimed_pending"]).catch(() => {
      // The shift may have been approved or cancelled in the meantime; the claim
      // withdrawal itself succeeded and that is what we reported.
    });
  }
  return data;
}
