// Data access for the STAFF app (M7) — the signed-in person's own shifts.
//
// Security (M7 §4, CLAUDE.md rules 1–2): the database is the boundary, not this
// file. Migration 0006's `shift_select` policy lets a non-manager read a shift
// only when `assigned_user_id = current_app_user_id()` AND its roster is
// PUBLISHED, so a draft roster is invisible and unreachable here even if this
// module asked for it. Migration 0002's `app_user_select` lets a non-manager
// read only their OWN app_user row, so no colleague's pay rate can ever come
// back down this wire.
//
// Belt and braces on top of RLS:
//   * every select names an explicit, minimal column list — never `*` — so a
//     column added to `shift` later (a manager note, a wage field) cannot start
//     leaking into the staff app by accident;
//   * callers may pass their own user id, which adds an `assigned_user_id`
//     filter. That is defence in depth, NOT the security boundary.
//
// Caching (M7 §5) lives here too: "when am I working?" must be answerable in a
// back room with no signal, and a cached answer must always be visibly dated.

import { getSupabaseClient } from "./client";
import type { Enums } from "./database.types";
import type { MyShift, MyShiftStatus } from "../domain/my-roster";

/**
 * The only columns the staff app ever reads from `shift`. Explicit by design —
 * see the module header.
 */
const SHIFT_COLUMNS =
  "id, roster_id, date, start_at, end_at, break_minutes, role_id, location_id, status, pay_rate_snapshot";

interface ShiftSelection {
  id: string;
  roster_id: string;
  date: string;
  start_at: string;
  end_at: string;
  break_minutes: number;
  role_id: string;
  location_id: string;
  status: Enums<"shift_status">;
  pay_rate_snapshot: number | null;
}

function mapShift(row: ShiftSelection): MyShift {
  return {
    id: row.id,
    rosterId: row.roster_id,
    date: row.date,
    startAt: row.start_at,
    endAt: row.end_at,
    breakMinutes: row.break_minutes,
    roleId: row.role_id,
    locationId: row.location_id,
    status: row.status as MyShiftStatus,
    payRateSnapshot: row.pay_rate_snapshot === null ? null : Number(row.pay_rate_snapshot),
    // See MyShift.note — no staff-readable note column exists on `shift` yet.
    note: null,
  };
}

/** A sane upper bound so a long-tenured user can never pull an unbounded list onto a phone. */
const MAX_ROWS = 200;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Every shift of mine that has not finished yet, earliest first.
 *
 * Filters on `end_at` rather than `start_at` so a shift already IN PROGRESS is
 * still returned — someone checking mid-shift should see the shift they are
 * standing in, not the one after it.
 *
 * @param fromISO UTC instant (normally `new Date().toISOString()`).
 * @param userId  optional defence-in-depth filter; RLS is the real boundary.
 */
export async function fetchMyUpcomingShifts(fromISO: string, userId?: string): Promise<MyShift[]> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("shift")
    .select(SHIFT_COLUMNS)
    .gte("end_at", fromISO)
    .order("start_at")
    .limit(MAX_ROWS);
  if (userId) query = query.eq("assigned_user_id", userId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapShift);
}

/**
 * My shifts whose trading day falls inside [fromDate, toDate] — the fortnight
 * summary (M7 §3.1). Dates, not instants, because the roster period is a run of
 * calendar days and an overnight shift belongs to its start day (M5 §10).
 *
 * @param fromDate "YYYY-MM-DD" inclusive
 * @param toDate   "YYYY-MM-DD" inclusive
 */
export async function fetchMyShiftsInPeriod(
  fromDate: string,
  toDate: string,
  userId?: string,
): Promise<MyShift[]> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("shift")
    .select(SHIFT_COLUMNS)
    .gte("date", fromDate)
    .lte("date", toDate)
    .order("start_at")
    .limit(MAX_ROWS);
  if (userId) query = query.eq("assigned_user_id", userId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapShift);
}

/** My most recently finished shifts, newest first — the "previous shifts" list. */
export async function fetchMyPastShifts(
  beforeISO: string,
  userId?: string,
  limit = 20,
): Promise<MyShift[]> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("shift")
    .select(SHIFT_COLUMNS)
    .lt("end_at", beforeISO)
    .order("start_at", { ascending: false })
    .limit(Math.min(limit, MAX_ROWS));
  if (userId) query = query.eq("assigned_user_id", userId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapShift);
}

/**
 * One shift by id — the deep-link target for an SMS (M9 links straight to
 * /me/shifts/[id]). Returns null when the row is gone OR invisible: a roster
 * withdrawn after publication (M6 §4.4) and a shift reassigned to someone else
 * both look like "not found" from here, which is exactly right — the screen
 * says so plainly instead of showing stale detail.
 */
export async function fetchShiftById(id: string): Promise<MyShift | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("shift")
    .select(SHIFT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapShift(data) : null;
}

// ---------------------------------------------------------------------------
// Who else is on (M7 §3.2)
// ---------------------------------------------------------------------------

/**
 * A colleague working an overlapping shift at the same location.
 *
 * NAME AND JOB ROLE ONLY (M7 §4). There is deliberately no phone, no email, no
 * hours, no pay rate and no availability on this type — if a future caller wants
 * one of those it has to change this contract in the open, not slip it in.
 */
export interface ColleagueOnShift {
  userId: string;
  name: string;
  /** Job role id — resolve the display name from the store's `roles`. */
  roleId: string;
}

/**
 * Who else is working at the same location while I am there.
 *
 * Overlap is the strict interval test (`other.start < mine.end` and
 * `other.end > mine.start`), so a shift that merely starts as mine ends is not
 * counted as "on with me".
 *
 * VISIBILITY SEAM: under migration 0006 a non-manager can only select their OWN
 * shift rows, so today this returns an empty list for staff. Making M7 §4 fully
 * true needs a SECURITY DEFINER RPC in `supabase/**` that returns name + role
 * for overlapping assignees and nothing else — owned by the database engineer.
 * When it lands, only the body below changes; the return type is already the
 * safe one. Until then the UI must not claim "nobody else is on" — it says only
 * that nobody else is *listed*.
 */
export async function fetchColleaguesOnShift(shiftId: string): Promise<ColleagueOnShift[]> {
  const supabase = getSupabaseClient();

  const mine = await fetchShiftById(shiftId);
  if (!mine) return [];

  const { data: overlapping, error: shiftErr } = await supabase
    .from("shift")
    .select("id, assigned_user_id, role_id")
    .eq("location_id", mine.locationId)
    .lt("start_at", mine.endAt)
    .gt("end_at", mine.startAt)
    .neq("id", mine.id)
    .limit(MAX_ROWS);
  if (shiftErr) throw shiftErr;

  // De-duplicate: a split shift can put the same person on twice in one window.
  const roleByUser = new Map<string, string>();
  for (const row of overlapping ?? []) {
    if (row.assigned_user_id && !roleByUser.has(row.assigned_user_id)) {
      roleByUser.set(row.assigned_user_id, row.role_id);
    }
  }
  if (roleByUser.size === 0) return [];

  // Name only. Never `*` — `app_user` holds pay_rate and manager-only notes.
  const { data: people, error: userErr } = await supabase
    .from("app_user")
    .select("id, name")
    .in("id", [...roleByUser.keys()])
    .order("name");
  if (userErr) throw userErr;

  return (people ?? []).flatMap((p) => {
    const roleId = roleByUser.get(p.id);
    return roleId ? [{ userId: p.id, name: p.name, roleId }] : [];
  });
}

// ---------------------------------------------------------------------------
// Offline cache (M7 §5)
// ---------------------------------------------------------------------------
//
// The last-loaded shift list is kept in localStorage so the home screen renders
// instantly and still works with no signal. It is keyed by user id (a shared
// phone must never show the previous person's roster) and carries a schema
// version so a shape change invalidates rather than mis-renders.
//
// This cache is READ-ONLY data. Nothing here ever confirms a write: an action
// only reports success when the server said so (M7 §5, acceptance criteria).

const CACHE_VERSION = 1;
const cacheKey = (userId: string): string => `rosterly.my-shifts.v${CACHE_VERSION}.${userId}`;

export interface CachedShifts {
  /** When the cached list came back from the server, ISO instant. */
  cachedAt: string;
  shifts: MyShift[];
}

function isCachedShifts(value: unknown): value is CachedShifts {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { cachedAt?: unknown; shifts?: unknown };
  if (typeof candidate.cachedAt !== "string" || !Array.isArray(candidate.shifts)) return false;
  return candidate.shifts.every((s: unknown) => {
    if (typeof s !== "object" || s === null) return false;
    const shift = s as { id?: unknown; startAt?: unknown; endAt?: unknown };
    return (
      typeof shift.id === "string" &&
      typeof shift.startAt === "string" &&
      typeof shift.endAt === "string"
    );
  });
}

/** The last list this user saw, or null. Never throws — a broken cache is a miss. */
export function readCachedShifts(userId: string): CachedShifts | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isCachedShifts(parsed) ? parsed : null;
  } catch {
    // Private-mode / quota / corrupt JSON — treat as a cache miss.
    return null;
  }
}

/** Store the freshly-loaded list. Never throws — failing to cache is not an error. */
export function writeCachedShifts(userId: string, shifts: MyShift[]): string {
  const cachedAt = new Date().toISOString();
  if (typeof window === "undefined") return cachedAt;
  try {
    const payload: CachedShifts = { cachedAt, shifts };
    window.localStorage.setItem(cacheKey(userId), JSON.stringify(payload));
  } catch {
    // Storage unavailable or full — the app still works, just without offline data.
  }
  return cachedAt;
}

/** Drop a user's cached roster (sign-out, or a roster withdrawn under them). */
export function clearCachedShifts(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(cacheKey(userId));
  } catch {
    // Nothing to do — the cache is best-effort by design.
  }
}
