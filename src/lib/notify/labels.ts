// Module 9 — the human "when" that goes into notification copy.
//
// Every catalogued event's payload carries a `when` string that is ALREADY in
// business time (M9 §8: quiet hours and "starting soon" use the business
// timezone, never the phone's). It is rendered here, once, from the same
// primitives the screens use — `wallDateIn`/`wallTimeIn` in
// src/lib/domain/timezone.ts and `calendarLabel` in my-roster — so a text can
// never quote a different time from the shift card the person is looking at.
//
// Pure; no I/O.

import { calendarLabel } from "../domain/my-roster";
import { wallDateIn, wallTimeIn } from "../domain/timezone";

/** "Fri 20 Mar, 16:00" — one shift, in business time. */
export function shiftWhen(startAtISO: string, timezone: string): string {
  return `${calendarLabel(wallDateIn(startAtISO, timezone))}, ${wallTimeIn(startAtISO, timezone)}`;
}

/**
 * "Fri 20 Mar – Thu 2 Apr" for a roster period, or the single day when the
 * period is one day long. Dates are trading days ("YYYY-MM-DD"), which are
 * already business-local (M5 §10), so no conversion is involved.
 */
export function periodWhen(firstDate: string, lastDate: string): string {
  return firstDate === lastDate
    ? calendarLabel(firstDate)
    : `${calendarLabel(firstDate)} – ${calendarLabel(lastDate)}`;
}
