// Pure view logic for the STAFF app (M7). No React, no Supabase, no I/O — so
// every rule below is unit-testable without a browser or a database.
//
// The staff app answers one question ("when am I working next?") and must never
// lie about it, which is why:
//   * hours come from real INSTANTS via `elapsedHours` (M5 §10) — a shift that
//     spans a daylight-saving change is honestly 7 or 9 hours, never assumed 8;
//   * every label is rendered in the BUSINESS timezone, never the phone's
//     (M7 §7, CLAUDE.md rule 8);
//   * an overnight shift states both days ("Fri 22:00 – Sat 06:00", M7 §7).
//
// Money here is an ESTIMATE for the staff member's own information only
// (CLAUDE.md rule 5) — see STAFF_PAY_DISCLAIMER.

import { roundHours, roundMoney, shiftCost } from "./cost";
import { addDaysISO, dayOfWeekISO, elapsedHours, wallDateIn, wallTimeIn } from "./timezone";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MyShiftStatus = "assigned" | "drop_requested" | "open" | "claimed_pending";

/**
 * One of the signed-in staff member's shifts, in app-side naming.
 *
 * Deliberately carries NO other person's data and no manager-only fields — the
 * shape itself is part of the M7 §4 can-see/cannot-see contract. `startAt` and
 * `endAt` are UTC instants (`timestamptz`); `date` is the trading day the shift
 * belongs to (an overnight shift belongs to its START date, M5 §10).
 */
export interface MyShift {
  id: string;
  rosterId: string;
  date: string; // "YYYY-MM-DD" — trading day
  startAt: string; // UTC ISO instant
  endAt: string; // UTC ISO instant
  breakMinutes: number;
  roleId: string;
  locationId: string;
  status: MyShiftStatus;
  /** Rate frozen at assignment time (M5 §9); null ⇒ fall back to the current rate. */
  payRateSnapshot: number | null;
  /**
   * A note the manager attached to this shift, shown on the detail screen
   * (M7 §3.2). SEAM: `shift` has no staff-readable note column yet — the only
   * free text on the roster today is `roster_position.label`, which is
   * manager-only under migration 0006. The mapper therefore sets this to null
   * until the schema grows one; the screen already renders it when it arrives.
   * This is never a manager-only note ABOUT the person (M2 `notes`, M7 §4).
   */
  note: string | null;
}

/**
 * The staff-facing wording of the estimate-not-payroll disclaimer (M10 §0).
 * The manager-facing wording lives in `cost.ts` as COST_DISCLAIMER; staff get a
 * plainer sentence because it is THEIR money on screen.
 */
export const STAFF_PAY_DISCLAIMER =
  "Estimate for your information only — your actual pay comes from your employer's payroll.";

const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MON_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

// ---------------------------------------------------------------------------
// Ordering and selection
// ---------------------------------------------------------------------------

/** Chronological copy (earliest first). Never mutates the input. */
export function sortShifts(shifts: readonly MyShift[]): MyShift[] {
  return [...shifts].sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/**
 * The shift to put in the hero. A shift already IN PROGRESS still counts — a
 * kitchen hand checking mid-shift wants to see the shift they are standing in,
 * not the next one. Returns null when there is nothing upcoming.
 */
export function nextShift(shifts: readonly MyShift[], now: Date): MyShift | null {
  const t = now.getTime();
  return sortShifts(shifts).find((s) => new Date(s.endAt).getTime() > t) ?? null;
}

/** Everything not yet finished, earliest first. */
export function upcomingShifts(shifts: readonly MyShift[], now: Date): MyShift[] {
  const t = now.getTime();
  return sortShifts(shifts).filter((s) => new Date(s.endAt).getTime() > t);
}

/** Everything already finished, most recent first (the "previous shifts" list). */
export function pastShifts(shifts: readonly MyShift[], now: Date): MyShift[] {
  const t = now.getTime();
  return sortShifts(shifts)
    .filter((s) => new Date(s.endAt).getTime() <= t)
    .reverse();
}

// ---------------------------------------------------------------------------
// Grouping by week
// ---------------------------------------------------------------------------

export interface WeekGroup {
  /** "YYYY-MM-DD" of the week's first day, in the business's week-start convention. */
  weekStart: string;
  /** "YYYY-MM-DD" of the week's last day (weekStart + 6). */
  weekEnd: string;
  shifts: MyShift[];
}

/** First day of the week containing `date`, given the business's week start (0=Sun..6=Sat). */
export function startOfWeekISO(date: string, weekStartDay = 1): string {
  const shift = (dayOfWeekISO(date) - weekStartDay + 7) % 7;
  return addDaysISO(date, -shift);
}

/**
 * Group shifts into consecutive weeks for the "rest of your shifts" list (M7 §3.1).
 * Weeks with no shifts are simply absent — a staff member does not need to be
 * shown an empty week.
 */
export function groupUpcomingByWeek(shifts: readonly MyShift[], weekStartDay = 1): WeekGroup[] {
  const groups = new Map<string, MyShift[]>();
  for (const s of sortShifts(shifts)) {
    const key = startOfWeekISO(s.date, weekStartDay);
    const bucket = groups.get(key);
    if (bucket) bucket.push(s);
    else groups.set(key, [s]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, weekShifts]) => ({
      weekStart,
      weekEnd: addDaysISO(weekStart, 6),
      shifts: weekShifts,
    }));
}

// ---------------------------------------------------------------------------
// Hours and estimated pay
// ---------------------------------------------------------------------------

/**
 * Paid hours for one shift, in full precision. Computed from the instants (not
 * wall clock) so a DST-spanning shift is honest (M5 §10); the break rule is the
 * shared one from cost.ts: paid = elapsed − break.
 */
export function shiftPaidHours(shift: MyShift): number {
  return elapsedHours(shift.startAt, shift.endAt, shift.breakMinutes);
}

/** Estimated pay for ONE shift, using its frozen rate when it has one. */
export function shiftEstimatedPay(shift: MyShift, fallbackRate: number): number {
  return shiftCost(shiftPaidHours(shift), shift.payRateSnapshot ?? fallbackRate);
}

export interface PeriodTotals {
  shiftCount: number;
  /** Rounded once, at the end — never the sum of rounded parts (M10 §2). */
  hours: number;
  estimatedPay: number;
}

/**
 * Hours and estimated pay across a set of shifts — the fortnight summary
 * (M7 §3.1). Sums in full precision and rounds once, so the total can never
 * drift off the individual shifts by a few cents.
 */
export function periodTotals(shifts: readonly MyShift[], payRate: number): PeriodTotals {
  let hours = 0;
  let pay = 0;
  for (const s of shifts) {
    hours += shiftPaidHours(s);
    pay += shiftEstimatedPay(s, payRate);
  }
  return { shiftCount: shifts.length, hours: roundHours(hours), estimatedPay: roundMoney(pay) };
}

// ---------------------------------------------------------------------------
// Honest labels
// ---------------------------------------------------------------------------

export interface ShiftDays {
  /** Trading/start day in the business timezone, "YYYY-MM-DD". */
  startDate: string;
  /** Finish day in the business timezone — DIFFERENT from startDate overnight. */
  endDate: string;
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  crossesMidnight: boolean;
  /**
   * "16:00 – 23:00" for a same-day shift; "Fri 22:00 – Sat 06:00" when it runs
   * past midnight, so nobody misreads the finish day (M7 §7).
   */
  label: string;
}

/**
 * Start/finish of a shift as an observer in the BUSINESS timezone reads them.
 * Never uses the device timezone — a phone set to the wrong country must not be
 * able to send someone to work at the wrong hour (M7 §7).
 */
export function describeShiftDays(shift: MyShift, timezone: string): ShiftDays {
  const startDate = wallDateIn(shift.startAt, timezone);
  const endDate = wallDateIn(shift.endAt, timezone);
  const startTime = wallTimeIn(shift.startAt, timezone);
  const endTime = wallTimeIn(shift.endAt, timezone);
  const crossesMidnight = endDate !== startDate;
  const label = crossesMidnight
    ? `${DOW_SHORT[dayOfWeekISO(startDate)]} ${startTime} – ${DOW_SHORT[dayOfWeekISO(endDate)]} ${endTime}`
    : `${startTime} – ${endTime}`;
  return { startDate, endDate, startTime, endTime, crossesMidnight, label };
}

/** "Fri 8 Aug" for a "YYYY-MM-DD" date. Pure calendar maths — no timezone involved. */
export function calendarLabel(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${DOW_SHORT[dayOfWeekISO(date)]} ${d} ${MON_SHORT[m - 1]}`;
}

/**
 * "Today" / "Tomorrow" where it applies, otherwise null so the caller falls back
 * to the calendar label. Both dates must already be business-timezone dates.
 */
export function relativeDayLabel(date: string, today: string): "Today" | "Tomorrow" | null {
  if (date === today) return "Today";
  if (date === addDaysISO(today, 1)) return "Tomorrow";
  return null;
}

/** "6h 30m", "7h", "45m", "0h" — short enough to read at a glance on a phone. */
export function formatDuration(hours: number): string {
  const total = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * "just now" / "2 hours ago" / "3 days ago" for the cached-data timestamp
 * (M7 §5). Stale data must never be mistaken for current, so this is deliberately
 * coarse and never optimistic — a future timestamp (clock skew) reads "just now".
 * Returns null when the timestamp is unusable, so the caller can omit the line
 * rather than print a lie.
 */
export function describeUpdatedAgo(atISO: string, now: Date): string | null {
  const at = new Date(atISO).getTime();
  if (!Number.isFinite(at)) return null;
  const seconds = Math.floor((now.getTime() - at) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
