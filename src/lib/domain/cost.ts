// The SINGLE shared hours + labour-cost function (TECH_STACK §7, M10 §2).
//
// Every surface that shows hours or a dollar figure — the week template
// (M4 §5.4), the roster grid and reports (M10), the staff app (M7) — computes
// through this module so no two views can ever disagree.
//
// Rules (M10 §2):
//   paid_hours = (end − start) − break_minutes
//   cost       = paid_hours × pay_rate
// Everything is computed in FULL PRECISION; callers round only at display via
// `roundHours` / `roundMoney`. Totals are the sum of unrounded values, rounded
// once — never the sum of rounded parts (which drifts off by cents).
//
// Times here are wall-clock "HH:MM" strings. A shift whose end is ≤ its start
// crosses midnight and belongs to its start day (M10 §2). For real dated shifts
// spanning a daylight-saving boundary, the caller computes elapsed break-less
// minutes from timestamps and passes them in; the arithmetic below is identical.

export interface ShiftTimes {
  start: string; // "HH:MM"
  end: string; // "HH:MM" — may be ≤ start ⇒ crosses midnight
  breakMinutes?: number;
}

const MINUTES_PER_DAY = 1440;

function toMinutes(t: string): number {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

/** True when the shift's end is at or before its start ⇒ it runs past midnight. */
export function crossesMidnight(start: string, end: string): boolean {
  return toMinutes(end) <= toMinutes(start);
}

/** Wall-clock minutes worked, break excluded. Handles the overnight (+24h) case. */
export function spanMinutes(start: string, end: string): number {
  const s = toMinutes(start);
  let e = toMinutes(end);
  if (e <= s) e += MINUTES_PER_DAY; // crosses midnight
  return e - s;
}

/** Paid hours in full precision. Never negative (a break longer than the shift → 0). */
export function paidHours({ start, end, breakMinutes = 0 }: ShiftTimes): number {
  const worked = spanMinutes(start, end) - Math.max(0, breakMinutes);
  return Math.max(0, worked) / 60;
}

/** Estimated labour cost for a run of hours at a base rate. Full precision. */
export function shiftCost(hours: number, rate: number): number {
  return hours * rate;
}

/** Round hours to 2 decimals — only for display (M10 §2). */
export function roundHours(hours: number): number {
  return Math.round(hours * 100) / 100;
}

/** Round money to 2 decimals — only for display (M10 §2). */
export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** The estimate-not-payroll disclaimer text (REQUIREMENTS.md §0, M10 §0). */
export const COST_DISCLAIMER = "Estimate for rostering only — not payroll.";
