// M4 §4.4 — "Create template from a past week".
//
// The single highest-value onboarding shortcut in the product. A restaurant
// with existing rosters should never face a blank template screen: their real
// week already IS the answer, so we read it back into slots and hand them an
// edit task instead of a design task.
//
// The grouping rule is the whole idea: three people rostered Kitchen
// 16:00–23:00 on Friday is not three slots, it is ONE slot with count 3. That
// is what a staffing requirement means, and getting it wrong would produce a
// template nobody can maintain.
//
// Pure — no database, no clock — so the grouping is testable directly.

import type { Level } from "../types";

/** One real shift from a past roster, reduced to what the conversion needs. */
export interface SourceShift {
  locationId: string;
  roleId: string;
  /** Business-local calendar date, "YYYY-MM-DD". */
  date: string;
  /** Business-local wall time, "HH:MM". */
  start: string;
  end: string;
  requiredLevel?: Level | null;
}

/** A staffing requirement ready to become a `template_slot`. */
export interface DerivedSlot {
  locationId: string;
  dayOfWeek: number; // 0=Sun..6=Sat
  roleId: string;
  start: string;
  end: string;
  count: number;
  requiredLevel: Level | null;
  label: string | null;
}

export interface ConversionSummary {
  slots: DerivedSlot[];
  /** How many real shifts were read. */
  shiftsRead: number;
  /** Distinct days that produced at least one slot. */
  daysCovered: number;
  /** Total people-per-week the derived template demands. */
  totalPositions: number;
}

const hhmm = (t: string): string => t.slice(0, 5);

/**
 * Day of week for a "YYYY-MM-DD" date, 0=Sun..6=Sat.
 *
 * Parsed as UTC deliberately: the string is already a business-local calendar
 * date, so re-interpreting it in the server's zone could shift it a day.
 */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Convert a week of real shifts into template slots.
 *
 * Identical (location, weekday, role, start, end, level) shifts collapse into a
 * single slot whose `count` is how many people were on. Ordering is stable —
 * by weekday then start time then role — so the same week always produces the
 * same template, and a manager reviewing it reads it in the order they think.
 */
export function deriveSlotsFromWeek(shifts: readonly SourceShift[]): ConversionSummary {
  const groups = new Map<string, DerivedSlot>();

  for (const shift of shifts) {
    const start = hhmm(shift.start);
    const end = hhmm(shift.end);
    const dayOfWeek = weekdayOf(shift.date);
    const level = shift.requiredLevel ?? null;

    // The grouping key IS the definition of "the same requirement".
    const key = [shift.locationId, dayOfWeek, shift.roleId, start, end, level ?? ""].join("|");

    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, {
        locationId: shift.locationId,
        dayOfWeek,
        roleId: shift.roleId,
        start,
        end,
        count: 1,
        requiredLevel: level,
        // No label: inventing one ("morning") would be a guess, and a wrong
        // guess is worse than the blank the manager can fill in themselves.
        label: null,
      });
    }
  }

  const slots = [...groups.values()].sort(
    (a, b) =>
      // Monday-first reading order: Sunday (0) sorts last, as the grid shows it.
      ((a.dayOfWeek + 6) % 7) - ((b.dayOfWeek + 6) % 7) ||
      a.start.localeCompare(b.start) ||
      a.roleId.localeCompare(b.roleId),
  );

  return {
    slots,
    shiftsRead: shifts.length,
    daysCovered: new Set(slots.map((s) => s.dayOfWeek)).size,
    totalPositions: slots.reduce((n, s) => n + s.count, 0),
  };
}
