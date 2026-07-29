// Data access for Module 10 (Costs & Reporting) — MANAGER ONLY.
//
// Security (M10 §7, M11 §4.1, CLAUDE.md rules 1–2): the database is the
// boundary, not this file. Cost views are manager-only, and RLS is what makes
// that true — migration 0006's `shift_select` policy lets a non-manager read
// only their OWN shift rows, and `app_user_select` lets them read only their own
// `app_user` row, so a staff member reaching these functions gets their own row
// or nothing. No query here builds a `business_id` filter by hand; tenant
// isolation is enforced by RLS on every table read below.
//
// Every select names an explicit, minimal column list — never `*` — so a column
// added to `shift` later cannot start flowing into a report by accident.
//
// Two shapes feed the report (M10 §5): a whole roster, or an arbitrary date
// range. Both return the same `ReportShift[]`, which deliberately includes
// UNFILLED positions as rows with `userId: null` — a roster_position that no
// shift ever filled, or a shift whose assignee has been removed. They cost
// nothing, and the report counts them so a gap-ridden roster never reads as a
// cheap one (M10 §8).

import { getSupabaseClient } from "./client";
import type { Enums } from "./database.types";
import type { ReportShift } from "../domain/cost-reports";

/** A roster the manager can report on — the period picker's options (M10 §5). */
export interface CostRosterOption {
  id: string;
  startDate: string;
  days: number;
  status: Enums<"roster_status">;
  /** null ⇒ the roster covers every location. */
  locationScope: string | null;
  publishedAt: string | null;
}

/** A sane upper bound: no report pulls an unbounded slice of history. */
const MAX_ROWS = 2000;

const SHIFT_COLUMNS =
  "id, roster_position_id, date, start_at, end_at, break_minutes, role_id, location_id, assigned_user_id, pay_rate_snapshot";

const POSITION_COLUMNS = "id, date, start_at, end_at, role_id, location_id";

interface ShiftSelection {
  id: string;
  roster_position_id: string | null;
  date: string;
  start_at: string;
  end_at: string;
  break_minutes: number;
  role_id: string;
  location_id: string;
  assigned_user_id: string | null;
  pay_rate_snapshot: number | null;
}

interface PositionSelection {
  id: string;
  date: string;
  start_at: string;
  end_at: string;
  role_id: string;
  location_id: string;
}

// ---------------------------------------------------------------------------
// Period picker
// ---------------------------------------------------------------------------

/**
 * The rosters available to report on, most recent first — "current roster,
 * previous rosters" in the period picker (M10 §5). Drafts are included and
 * flagged: a draft's cost is an estimate of an unpublished plan (M10 §8), which
 * the screen labels rather than hides.
 */
export async function fetchCostRosters(limit = 26): Promise<CostRosterOption[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("roster")
    .select("id, start_date, days, status, location_scope, published_at")
    .order("start_date", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    startDate: r.start_date,
    days: r.days,
    status: r.status,
    locationScope: r.location_scope,
    publishedAt: r.published_at,
  }));
}

// ---------------------------------------------------------------------------
// Report rows
// ---------------------------------------------------------------------------

/**
 * Every shift of one roster, plus its unfilled positions, in report shape.
 *
 * `pay_rate_snapshot` comes straight off the shift and is never replaced with
 * the person's current rate (M10 §2.1) — a raise must not rewrite history.
 */
export async function fetchRosterReportShifts(rosterId: string): Promise<ReportShift[]> {
  const supabase = getSupabaseClient();
  const [shiftRes, positionRes] = await Promise.all([
    supabase.from("shift").select(SHIFT_COLUMNS).eq("roster_id", rosterId).limit(MAX_ROWS),
    supabase
      .from("roster_position")
      .select(POSITION_COLUMNS)
      .eq("roster_id", rosterId)
      .limit(MAX_ROWS),
  ]);
  if (shiftRes.error) throw shiftRes.error;
  if (positionRes.error) throw positionRes.error;
  return assemble(shiftRes.data ?? [], positionRes.data ?? []);
}

/**
 * Every shift whose trading day falls inside [fromDate, toDate], plus the
 * unfilled positions in the same window — the custom-date-range option (M10 §5).
 *
 * Filtered on `date` (the trading day), not on the instants, so an overnight
 * shift is counted on the day it STARTED, exactly as the grid shows it (§2).
 */
export async function fetchRangeReportShifts(
  fromDate: string,
  toDate: string,
): Promise<ReportShift[]> {
  const supabase = getSupabaseClient();
  const [shiftRes, positionRes] = await Promise.all([
    supabase
      .from("shift")
      .select(SHIFT_COLUMNS)
      .gte("date", fromDate)
      .lte("date", toDate)
      .limit(MAX_ROWS),
    supabase
      .from("roster_position")
      .select(POSITION_COLUMNS)
      .gte("date", fromDate)
      .lte("date", toDate)
      .limit(MAX_ROWS),
  ]);
  if (shiftRes.error) throw shiftRes.error;
  if (positionRes.error) throw positionRes.error;
  return assemble(shiftRes.data ?? [], positionRes.data ?? []);
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Join shifts with the names of whoever is on them, and add every position that
 * no shift covers as an unfilled row.
 *
 * A shift row already covers its own position — including when its assignee has
 * been removed — so positions are only synthesised when NO shift references
 * them. That is what keeps the unfilled count honest in both directions: never
 * double-counted, never silently dropped (CLAUDE.md rule 4).
 */
async function assemble(
  shiftRows: ShiftSelection[],
  positionRows: PositionSelection[],
): Promise<ReportShift[]> {
  const nameById = await fetchNames(shiftRows);

  const rows: ReportShift[] = shiftRows.map((s) => ({
    id: s.id,
    date: s.date,
    startAt: s.start_at,
    endAt: s.end_at,
    breakMinutes: s.break_minutes,
    roleId: s.role_id,
    locationId: s.location_id,
    userId: s.assigned_user_id,
    userName: s.assigned_user_id ? nameById.get(s.assigned_user_id) ?? null : null,
    payRateSnapshot: s.pay_rate_snapshot === null ? null : Number(s.pay_rate_snapshot),
  }));

  const covered = new Set(
    shiftRows.flatMap((s) => (s.roster_position_id ? [s.roster_position_id] : [])),
  );
  for (const p of positionRows) {
    if (covered.has(p.id)) continue;
    rows.push({
      id: p.id,
      date: p.date,
      startAt: p.start_at,
      endAt: p.end_at,
      breakMinutes: 0,
      roleId: p.role_id,
      locationId: p.location_id,
      userId: null,
      userName: null,
      payRateSnapshot: null,
    });
  }

  return rows;
}

/** Names only — `app_user` also holds pay rates and manager-only notes. */
async function fetchNames(shiftRows: ShiftSelection[]): Promise<Map<string, string>> {
  const ids = [...new Set(shiftRows.flatMap((s) => (s.assigned_user_id ? [s.assigned_user_id] : [])))];
  if (ids.length === 0) return new Map();
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("app_user").select("id, name").in("id", ids);
  if (error) throw error;
  return new Map((data ?? []).map((u) => [u.id, u.name]));
}
