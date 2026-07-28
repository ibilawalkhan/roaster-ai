// Data access for Module 5 (Roster creation & auto-scheduler), application side.
// Thin typed queries only — expansion, the request shape and the pre-flight all
// live in src/lib/domain/. RLS (migration 0006) makes every write manager-only
// and business-scoped; no query here builds a business_id filter by hand.
//
// The three-way split matters (M5 §9):
//   roster           — the period
//   roster_position  — the concrete dated REQUIREMENT, copied from the template
//   shift            — the ASSIGNMENT
// A position with no shift is an unfilled position: a first-class, visible
// object, which is why the grid can never silently lose a requirement.
//
// The roster NEVER references the template live. Positions are copied onto real
// dates at creation, so editing the template later cannot alter a roster that
// has already been generated (M4 acceptance criteria).

import { getSupabaseClient } from "./client";
import type { Json, Tables, TablesInsert } from "./database.types";
import type { ExpandPositionsInput, ExpandedPosition } from "../domain/solver-request";
import { expandPositions } from "../domain/solver-request";
import { elapsedHours, instantToZonedISO } from "../domain/timezone";

export type RosterRow = Tables<"roster">;
export type RosterPositionRow = Tables<"roster_position">;
export type ShiftRow = Tables<"shift">;
export type SolveRunRow = Tables<"solve_run">;

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export interface CreateRosterInput {
  businessId: string;
  startDate: string; // "YYYY-MM-DD"
  days: number;
  templateId: string | null;
  /** null = all locations (MVP default). */
  locationScope?: string | null;
  createdBy?: string | null;
}

/** Create the draft roster shell. Positions are seeded separately. */
export async function createRoster(input: CreateRosterInput): Promise<RosterRow> {
  const supabase = getSupabaseClient();
  const insert: TablesInsert<"roster"> = {
    business_id: input.businessId,
    start_date: input.startDate,
    days: input.days,
    template_id: input.templateId,
    location_scope: input.locationScope ?? null,
    created_by: input.createdBy ?? null,
    status: "draft",
  };
  const { data, error } = await supabase.from("roster").insert(insert).select("*").single();
  if (error) throw error;
  return data;
}

export async function fetchRoster(id: string): Promise<RosterRow | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("roster")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** The most recently created roster for the business (the one the manager is working on). */
export async function fetchLatestRoster(): Promise<RosterRow | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("roster")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function deleteRoster(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  // roster_position / shift / solve_run all cascade from roster (migration 0006).
  const { error } = await supabase.from("roster").delete().eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

export interface SeedPositionsInput extends ExpandPositionsInput {
  businessId: string;
}

export interface SeededPositions {
  positions: ExpandedPosition[];
  rows: RosterPositionRow[];
  /** Expansion key → persisted roster_position id, for the solve request. */
  idByKey: Record<string, string>;
}

/**
 * Copy the template's slots onto real dates as concrete `roster_position` rows.
 *
 * Row ids are generated client-side rather than left to the database default, so
 * the mapping from expansion key to row id is exact and never depends on the
 * order Postgres happens to return inserted rows in — the solver's answers are
 * keyed by these ids, so a wrong mapping would assign people to the wrong shift.
 */
export async function seedPositionsFromTemplate(
  rosterId: string,
  input: SeedPositionsInput,
): Promise<SeededPositions> {
  const positions = expandPositions(input);
  if (positions.length === 0) return { positions, rows: [], idByKey: {} };

  const idByKey: Record<string, string> = {};
  const rows: TablesInsert<"roster_position">[] = positions.map((p) => {
    const id = crypto.randomUUID();
    idByKey[p.key] = id;
    return {
      id,
      business_id: input.businessId,
      roster_id: rosterId,
      location_id: p.locationId,
      date: p.date,
      role_id: p.roleId,
      start_at: p.startUtc,
      end_at: p.endUtc,
      required_level: p.requiredLevel,
      label: p.label,
      source: "template",
    };
  });

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("roster_position").insert(rows).select("*");
  if (error) throw error;
  return { positions, rows: data ?? [], idByKey };
}

/**
 * A persisted position, in the shape the domain layer works in. Once a roster is
 * seeded these rows ARE the demand — the pre-flight and the solve request are
 * built from them, never from the template, which may have moved on since.
 * `key` is the row id, so the solver answers with database ids directly.
 */
export function toExpandedPosition(
  row: RosterPositionRow,
  timezone: string,
): ExpandedPosition {
  return {
    key: row.id,
    slotId: row.id,
    date: row.date,
    locationId: row.location_id,
    roleId: row.role_id,
    start: instantToZonedISO(row.start_at, timezone),
    end: instantToZonedISO(row.end_at, timezone),
    startUtc: row.start_at,
    endUtc: row.end_at,
    requiredLevel: row.required_level,
    label: row.label,
    hours: elapsedHours(row.start_at, row.end_at),
  };
}

export async function fetchPositions(rosterId: string): Promise<RosterPositionRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("roster_position")
    .select("*")
    .eq("roster_id", rosterId)
    .order("date")
    .order("start_at");
  if (error) throw error;
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Shifts (assignments)
// ---------------------------------------------------------------------------

export async function fetchShifts(rosterId: string): Promise<ShiftRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("shift")
    .select("*")
    .eq("roster_id", rosterId)
    .order("date")
    .order("start_at");
  if (error) throw error;
  return data ?? [];
}

/** One solver answer, translated to app-side naming at the boundary. */
export interface AssignmentInput {
  positionId: string;
  userId: string;
}

export interface ApplyAssignmentsResult {
  inserted: number;
  /** Assignments dropped because the position already has a locked shift (H11). */
  skippedLocked: number;
}

/**
 * Replace the roster's generated shifts with the solver's assignments.
 *
 * Locked shifts survive untouched — that is the whole point of lock & regenerate
 * (M5 §7): the manager pins what they like and the rest is re-solved. Manual
 * edits that aren't locked are replaced, which is why M6 warns before doing it.
 *
 * `pay_rate_snapshot` freezes the assignee's rate at assignment time so a later
 * pay change can't retro-alter what a roster cost (M5 §9). It is an ESTIMATE
 * input, never payroll (CLAUDE.md rule 5).
 */
export async function applyAssignments(
  rosterId: string,
  assignments: AssignmentInput[],
): Promise<ApplyAssignmentsResult> {
  const supabase = getSupabaseClient();

  const [positions, existing] = await Promise.all([
    fetchPositions(rosterId),
    fetchShifts(rosterId),
  ]);
  const positionById = new Map(positions.map((p) => [p.id, p]));
  const lockedPositionIds = new Set(
    existing.flatMap((s) => (s.locked && s.roster_position_id ? [s.roster_position_id] : [])),
  );

  const usable = assignments.filter(
    (a) => positionById.has(a.positionId) && !lockedPositionIds.has(a.positionId),
  );
  const skippedLocked = assignments.length - usable.length;

  // Current rates for exactly the people being assigned.
  const userIds = Array.from(new Set(usable.map((a) => a.userId)));
  const rateByUser = new Map<string, number>();
  if (userIds.length > 0) {
    const { data: users, error: userErr } = await supabase
      .from("app_user")
      .select("id, pay_rate")
      .in("id", userIds);
    if (userErr) throw userErr;
    for (const u of users ?? []) rateByUser.set(u.id, Number(u.pay_rate));
  }

  // Replace: drop the previous generated (unlocked) shifts, then insert.
  const { error: delErr } = await supabase
    .from("shift")
    .delete()
    .eq("roster_id", rosterId)
    .eq("locked", false);
  if (delErr) throw delErr;

  if (usable.length === 0) return { inserted: 0, skippedLocked };

  const rows: TablesInsert<"shift">[] = usable.map((a) => {
    const p = positionById.get(a.positionId)!;
    return {
      business_id: p.business_id,
      roster_id: rosterId,
      roster_position_id: p.id,
      location_id: p.location_id,
      date: p.date,
      start_at: p.start_at,
      end_at: p.end_at,
      // Break rules (M1 `break_rule`) are applied when the manager edits in M6;
      // a generated shift starts with no break so the estimate matches the
      // position it came from.
      break_minutes: 0,
      role_id: p.role_id,
      assigned_user_id: a.userId,
      origin: "auto",
      locked: false,
      status: "assigned",
      pay_rate_snapshot: rateByUser.get(a.userId) ?? null,
    };
  });

  const { error: insErr } = await supabase.from("shift").insert(rows);
  if (insErr) throw insErr;
  return { inserted: rows.length, skippedLocked };
}

/** Pin (or unpin) a shift so the next generation must keep it exactly (H11). */
export async function setShiftLocked(id: string, locked: boolean): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("shift").update({ locked }).eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// solve_run — every solve persisted for replay, regression and "why is Omar on
// Friday?" (M5 §8). Written even when the solve degrades, so a bad day leaves a
// trail.
// ---------------------------------------------------------------------------

export interface RecordSolveRunInput {
  businessId: string;
  rosterId: string;
  request: unknown;
  response: unknown;
  seed: number | null;
  timeLimit: number | null;
  solveSeconds: number | null;
  status: "ok" | "partial" | "failed";
  createdBy?: string | null;
}

export async function recordSolveRun(input: RecordSolveRunInput): Promise<void> {
  const supabase = getSupabaseClient();
  const insert: TablesInsert<"solve_run"> = {
    business_id: input.businessId,
    roster_id: input.rosterId,
    // The request/response are opaque JSON documents by design (the contract is
    // versioned in docs/SOLVER_CONTRACT.md, not in the database schema). Casting
    // through `unknown` keeps the column's Json type without reaching for `any`.
    request_json: input.request as Json,
    response_json: input.response as Json,
    seed: input.seed,
    time_limit: input.timeLimit,
    solve_seconds: input.solveSeconds,
    status: input.status,
    created_by: input.createdBy ?? null,
  };
  const { error } = await supabase.from("solve_run").insert(insert);
  if (error) throw error;
}

export async function fetchSolveRuns(rosterId: string): Promise<SolveRunRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("solve_run")
    .select("*")
    .eq("roster_id", rosterId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
