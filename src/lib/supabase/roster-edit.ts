// Data access for Module 6 (Draft review, manual editing & publish).
//
// Split from roster.ts because the concerns differ: roster.ts SEEDS and
// GENERATES (bulk, machine-driven), this file records the MANAGER'S decisions
// (single-row, human-driven, every one of them audited).
//
// Two invariants this file exists to hold:
//
//   1. Every edit writes a `roster_change_log` row. That table is append-only at
//      the database level (migration 0009 grants select+insert and nothing else),
//      so history is never rewritten — a correction is a new row. This is what
//      answers "that's not what it said yesterday".
//
//   2. Removing a person and deleting a requirement are DIFFERENT operations.
//      `removeAssignment` deletes the shift and leaves the `roster_position`
//      standing, so the requirement immediately reappears as unfilled.
//      `deletePosition` is the only thing that removes the requirement itself,
//      and the UI confirm-gates it. Conflating the two is how a shift silently
//      vanishes from a roster.
//
// Notifications are Module 9. Every log row is written with `notified` false and
// nothing is sent from here; M9 picks those rows up. `notified` is deliberately
// not client-writable (no UPDATE policy) — the sender flips it server-side.

import { getSupabaseClient } from "./client";
import type { Json, Tables, TablesInsert, TablesUpdate } from "./database.types";
import type { RosterPositionRow, RosterRow, ShiftRow } from "./roster";
import type { EligibilityIssue, RosterWarningRule } from "../domain/eligibility";
import type { Level } from "../types";

export type ChangeLogRow = Tables<"roster_change_log">;
export type RosterWarningRow = Tables<"roster_warning">;

/** The vocabulary `roster_change_log.action` accepts (migration 0009 CHECK). */
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

/** Who is editing what — carried by every mutation so logging is never optional. */
export interface EditContext {
  businessId: string;
  rosterId: string;
  actorId: string | null;
}

// The change log stores opaque row snapshots; the shapes are the table rows
// themselves, versioned by the migrations rather than by this column. Casting
// through the column's own Json type keeps that honest without reaching for `any`.
const asJson = (value: unknown): Json => value as Json;

// ---------------------------------------------------------------------------
// Change log
// ---------------------------------------------------------------------------

export interface LogChangeInput {
  action: ChangeAction;
  shiftId?: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Append one row to the audit trail. Called by every mutation below — never by
 * the UI directly, so an edit path cannot be added without its log entry.
 */
export async function logChange(ctx: EditContext, input: LogChangeInput): Promise<void> {
  const supabase = getSupabaseClient();
  const insert: TablesInsert<"roster_change_log"> = {
    business_id: ctx.businessId,
    roster_id: ctx.rosterId,
    shift_id: input.shiftId ?? null,
    action: input.action,
    before_json: input.before === undefined ? null : asJson(input.before),
    after_json: input.after === undefined ? null : asJson(input.after),
    changed_by_user_id: ctx.actorId,
    // M9 seam: the notification sender flips this, server-side.
    notified: false,
  };
  const { error } = await supabase.from("roster_change_log").insert(insert);
  if (error) throw error;
}

export async function fetchChangeLog(rosterId: string, limit = 50): Promise<ChangeLogRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("roster_change_log")
    .select("*")
    .eq("roster_id", rosterId)
    .order("changed_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

async function payRateOf(userId: string): Promise<number | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("app_user")
    .select("pay_rate")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ? Number(data.pay_rate) : null;
}

/**
 * Fill an unfilled position. `origin` is 'manual' so the grid can show the
 * manager's work apart from the algorithm's (M6 §2.1), and the rate is snapshot
 * now so a later pay change can't retro-alter this roster's estimate.
 */
export async function assignShift(
  ctx: EditContext,
  input: { position: RosterPositionRow; userId: string; breakMinutes?: number },
): Promise<ShiftRow> {
  const supabase = getSupabaseClient();
  const { position, userId } = input;
  const insert: TablesInsert<"shift"> = {
    business_id: ctx.businessId,
    roster_id: ctx.rosterId,
    roster_position_id: position.id,
    location_id: position.location_id,
    date: position.date,
    start_at: position.start_at,
    end_at: position.end_at,
    break_minutes: input.breakMinutes ?? 0,
    role_id: position.role_id,
    assigned_user_id: userId,
    origin: "manual",
    locked: false,
    status: "assigned",
    pay_rate_snapshot: await payRateOf(userId),
  };
  const { data, error } = await supabase.from("shift").insert(insert).select("*").single();
  if (error) throw error;
  await logChange(ctx, { action: "assign", shiftId: data.id, after: data });
  return data;
}

/** Move a shift to someone else. The rate snapshot follows the new assignee. */
export async function reassignShift(
  ctx: EditContext,
  input: { shift: ShiftRow; userId: string },
): Promise<ShiftRow> {
  const supabase = getSupabaseClient();
  const update: TablesUpdate<"shift"> = {
    assigned_user_id: input.userId,
    pay_rate_snapshot: await payRateOf(input.userId),
    origin: "manual",
    status: "assigned",
  };
  const { data, error } = await supabase
    .from("shift")
    .update(update)
    .eq("id", input.shift.id)
    .select("*")
    .single();
  if (error) throw error;
  await logChange(ctx, {
    action: "reassign",
    shiftId: data.id,
    before: input.shift,
    after: data,
  });
  return data;
}

/**
 * Take the person off. The `roster_position` is untouched, so the requirement
 * comes straight back as an unfilled card — it does not disappear (M6 §3.1).
 */
export async function removeAssignment(ctx: EditContext, shift: ShiftRow): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("shift").delete().eq("id", shift.id);
  if (error) throw error;
  // shift_id is deliberately null: the row it referred to no longer exists, and
  // the log's FK is ON DELETE SET NULL. The snapshot in before_json is the record.
  await logChange(ctx, { action: "remove", shiftId: null, before: shift });
  await resolveWarningsForShift(ctx.rosterId, shift.id);
}

/** Edit an individual shift's times, break or role. */
export interface ShiftTimesPatch {
  startAt?: string;
  endAt?: string;
  breakMinutes?: number;
  roleId?: string;
}

export async function editShiftTimes(
  ctx: EditContext,
  shift: ShiftRow,
  patch: ShiftTimesPatch,
): Promise<ShiftRow> {
  const supabase = getSupabaseClient();
  const update: TablesUpdate<"shift"> = { origin: "manual" };
  if (patch.startAt !== undefined) update.start_at = patch.startAt;
  if (patch.endAt !== undefined) update.end_at = patch.endAt;
  if (patch.breakMinutes !== undefined) update.break_minutes = patch.breakMinutes;
  if (patch.roleId !== undefined) update.role_id = patch.roleId;

  const { data, error } = await supabase
    .from("shift")
    .update(update)
    .eq("id", shift.id)
    .select("*")
    .single();
  if (error) throw error;
  await logChange(ctx, { action: "edit_times", shiftId: data.id, before: shift, after: data });
  return data;
}

/** Pin or unpin a shift for the next generation (M5 §7, H11). */
export async function toggleLock(
  ctx: EditContext,
  shift: ShiftRow,
  locked: boolean,
): Promise<ShiftRow> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("shift")
    .update({ locked })
    .eq("id", shift.id)
    .select("*")
    .single();
  if (error) throw error;
  await logChange(ctx, {
    action: locked ? "lock" : "unlock",
    shiftId: data.id,
    before: shift,
    after: data,
  });
  return data;
}

// ---------------------------------------------------------------------------
// Positions (the requirements themselves)
// ---------------------------------------------------------------------------

export interface AddPositionInput {
  locationId: string;
  date: string;
  roleId: string;
  /** UTC instants, built by the caller from wall time via timezone.ts. */
  startAt: string;
  endAt: string;
  requiredLevel: Level | null;
  label: string | null;
}

/** A one-off requirement that isn't in the week template (M6 §3.1). */
export async function addPosition(
  ctx: EditContext,
  input: AddPositionInput,
): Promise<RosterPositionRow> {
  const supabase = getSupabaseClient();
  const insert: TablesInsert<"roster_position"> = {
    business_id: ctx.businessId,
    roster_id: ctx.rosterId,
    location_id: input.locationId,
    date: input.date,
    role_id: input.roleId,
    start_at: input.startAt,
    end_at: input.endAt,
    required_level: input.requiredLevel,
    label: input.label,
    source: "manual",
  };
  const { data, error } = await supabase
    .from("roster_position")
    .insert(insert)
    .select("*")
    .single();
  if (error) throw error;
  await logChange(ctx, { action: "add_position", after: data });
  return data;
}

/**
 * Remove the requirement itself, and any shift filling it. Distinct from
 * `removeAssignment` and confirm-gated in the UI — this is the only path that
 * makes a requirement legitimately disappear.
 */
export async function deletePosition(
  ctx: EditContext,
  position: RosterPositionRow,
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error: shiftErr } = await supabase
    .from("shift")
    .delete()
    .eq("roster_position_id", position.id);
  if (shiftErr) throw shiftErr;
  const { error } = await supabase.from("roster_position").delete().eq("id", position.id);
  if (error) throw error;
  await logChange(ctx, { action: "delete_position", before: position });
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

/**
 * Commit the roster. Publishing with gaps is allowed on purpose (M6 §4.1) — a
 * real restaurant publishes while still chasing cover, and refusing would push
 * the manager back to WhatsApp. The UI states the gaps at the moment of commit.
 */
export async function publishRoster(ctx: EditContext, before: RosterRow): Promise<RosterRow> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("roster")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      published_by: ctx.actorId,
    })
    .eq("id", ctx.rosterId)
    .select("*")
    .single();
  if (error) throw error;
  await logChange(ctx, { action: "publish", before, after: data });
  return data;
}

/** Withdraw a published roster. Disruptive — confirm-gated in the UI (M6 §4.4). */
export async function unpublishRoster(ctx: EditContext, before: RosterRow): Promise<RosterRow> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("roster")
    .update({ status: "draft", published_at: null, published_by: null })
    .eq("id", ctx.rosterId)
    .select("*")
    .single();
  if (error) throw error;
  await logChange(ctx, { action: "unpublish", before, after: data });
  return data;
}

// ---------------------------------------------------------------------------
// Warnings — overridden rules, kept visible until resolved (M6 §3.2)
// ---------------------------------------------------------------------------

/** Outstanding warnings for a roster; resolved ones are history, not state. */
export async function fetchWarnings(rosterId: string): Promise<RosterWarningRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("roster_warning")
    .select("*")
    .eq("roster_id", rosterId)
    .eq("resolved", false)
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

export interface UpsertWarningInput {
  shiftId: string | null;
  rule: RosterWarningRule;
  detail: string;
  /** Set when the manager has been shown the warning and proceeded anyway. */
  acknowledged?: boolean;
}

/**
 * Record (or refresh) one outstanding warning. There is no unique constraint to
 * upsert against — a shift can legitimately breach several rules at once — so
 * this matches on (shift, rule) among the UNRESOLVED rows.
 */
export async function upsertWarning(
  ctx: EditContext,
  input: UpsertWarningInput,
): Promise<void> {
  const supabase = getSupabaseClient();
  const base = supabase
    .from("roster_warning")
    .select("id")
    .eq("roster_id", ctx.rosterId)
    .eq("rule", input.rule)
    .eq("resolved", false);
  // A roster-level warning (senior coverage) has no shift; `is null` and `= id`
  // are different SQL, so the filter is chosen rather than parameterised.
  const { data: found, error: findErr } = await (input.shiftId === null
    ? base.is("shift_id", null)
    : base.eq("shift_id", input.shiftId)
  ).limit(1);
  if (findErr) throw findErr;
  const existingId: string | null = found?.[0]?.id ?? null;

  const acknowledgement = input.acknowledged
    ? { acknowledged_by: ctx.actorId, acknowledged_at: new Date().toISOString() }
    : {};

  if (existingId) {
    const { error } = await supabase
      .from("roster_warning")
      .update({ detail: input.detail, ...acknowledgement })
      .eq("id", existingId);
    if (error) throw error;
    return;
  }

  const insert: TablesInsert<"roster_warning"> = {
    business_id: ctx.businessId,
    roster_id: ctx.rosterId,
    shift_id: input.shiftId,
    rule: input.rule,
    detail: input.detail,
    resolved: false,
    ...acknowledgement,
  };
  const { error } = await supabase.from("roster_warning").insert(insert);
  if (error) throw error;
}

/** The manager has seen this and is proceeding knowingly. */
export async function acknowledgeWarning(id: string, actorId: string | null): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("roster_warning")
    .update({ acknowledged_by: actorId, acknowledged_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** The underlying problem is gone. Resolved warnings drop out of the panel. */
export async function resolveWarning(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("roster_warning").update({ resolved: true }).eq("id", id);
  if (error) throw error;
}

async function resolveWarningsForShift(rosterId: string, shiftId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("roster_warning")
    .update({ resolved: true })
    .eq("roster_id", rosterId)
    .eq("shift_id", shiftId)
    .eq("resolved", false);
  if (error) throw error;
}

/**
 * Make the stored warnings for one shift match what the rules now say: record
 * the current breaches (acknowledged, because the manager saved through them)
 * and resolve any that no longer apply. Called after every edit, so a fixed
 * problem clears itself and an accepted one stays on the roster until it doesn't.
 */
export async function syncShiftWarnings(
  ctx: EditContext,
  shiftId: string,
  issues: EligibilityIssue[],
): Promise<void> {
  const supabase = getSupabaseClient();
  const current = issues
    .map((i) => i.persistedRule)
    .filter((r): r is RosterWarningRule => r !== null);

  const { data: open, error } = await supabase
    .from("roster_warning")
    .select("id, rule")
    .eq("roster_id", ctx.rosterId)
    .eq("shift_id", shiftId)
    .eq("resolved", false);
  if (error) throw error;

  const stale = (open ?? []).filter((w) => !current.includes(w.rule as RosterWarningRule));
  for (const w of stale) await resolveWarning(w.id);

  for (const issue of issues) {
    if (!issue.persistedRule) continue; // no vocabulary for it — live warning only
    await upsertWarning(ctx, {
      shiftId,
      rule: issue.persistedRule,
      detail: issue.message,
      acknowledged: true,
    });
  }
}
