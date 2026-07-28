// Timezone + duration primitives for dated rosters (M5, CLAUDE.md rule 8).
//
// The template (M4) stores WALL-CLOCK times; a roster stores real INSTANTS
// (`timestamptz`). Converting between the two is the only place daylight saving
// can bite, so it lives here once, pure and testable, and nothing else in the
// app does date-with-timezone arithmetic by hand.
//
// Everything is done with the platform `Intl` timezone database — no extra
// dependency, and it tracks DST rules (Australia/Sydney) correctly.

const pad2 = (n: number): string => String(n).padStart(2, "0");
const pad4 = (n: number): string => String(n).padStart(4, "0");

const formatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall-clock reading an observer in `timeZone` sees at instant `at`. */
function wallClockAt(timeZone: string, at: Date): WallClock {
  const parts = zoneFormatter(timeZone).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : 0;
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Minutes `timeZone` is ahead of UTC at instant `at` (+600 for AEST, +660 AEDT). */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const w = wallClockAt(timeZone, at);
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asIfUtc - at.getTime()) / 60_000);
}

/** "+10:00" / "-05:30" for an offset in minutes. */
export function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** "HH:MM" (or "24:00") → minutes past midnight. */
export function minutesOfDay(time: string): number {
  const [h, m] = time.slice(0, 5).split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Minutes past midnight → "HH:MM" (1440 → "24:00"). */
export function timeOfDay(minutes: number): string {
  if (minutes >= 1440) return "24:00";
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

/**
 * The instant at which `minutes` past midnight on `date` occurs in `timeZone`.
 * `minutes` may exceed 1440 — that is how an overnight shift's end is expressed
 * while staying anchored to its start date (M5 §10).
 *
 * Two passes: guess with the offset in force at the naive instant, then re-check
 * with the offset actually in force at the result. That is what makes the hour
 * either side of a DST change land on the right instant.
 */
export function zonedInstant(date: string, minutes: number, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d) + minutes * 60_000;
  const firstOffset = zoneOffsetMinutes(timeZone, new Date(naive));
  const firstGuess = naive - firstOffset * 60_000;
  const secondOffset = zoneOffsetMinutes(timeZone, new Date(firstGuess));
  return secondOffset === firstOffset
    ? new Date(firstGuess)
    : new Date(naive - secondOffset * 60_000);
}

export interface ZonedTimestamp {
  /** ISO-8601 with the zone's real offset, e.g. "2026-08-03T16:00:00+10:00". */
  local: string;
  /** The same instant in UTC, e.g. "2026-08-03T06:00:00.000Z". */
  utc: string;
}

/** Both wire forms of one wall-clock time on one date in `timeZone`. */
export function zonedTimestamp(date: string, minutes: number, timeZone: string): ZonedTimestamp {
  const at = zonedInstant(date, minutes, timeZone);
  const w = wallClockAt(timeZone, at);
  const offset = zoneOffsetMinutes(timeZone, at);
  const local =
    `${pad4(w.year)}-${pad2(w.month)}-${pad2(w.day)}` +
    `T${pad2(w.hour)}:${pad2(w.minute)}:${pad2(w.second)}${offsetLabel(offset)}`;
  return { local, utc: at.toISOString() };
}

/**
 * Re-express a stored instant (`timestamptz`, i.e. UTC) as ISO-8601 carrying the
 * business timezone's offset — the form the solver contract asks for. Same
 * instant, readable local wall time.
 */
export function instantToZonedISO(isoInstant: string, timeZone: string): string {
  const at = new Date(isoInstant);
  const w = wallClockAt(timeZone, at);
  return (
    `${pad4(w.year)}-${pad2(w.month)}-${pad2(w.day)}` +
    `T${pad2(w.hour)}:${pad2(w.minute)}:${pad2(w.second)}${offsetLabel(zoneOffsetMinutes(timeZone, at))}`
  );
}

/** Render an instant as "HH:MM" in the business timezone (CLAUDE.md rule 8). */
export function wallTimeIn(isoInstant: string, timeZone: string): string {
  const w = wallClockAt(timeZone, new Date(isoInstant));
  return `${pad2(w.hour)}:${pad2(w.minute)}`;
}

/** Render an instant as "YYYY-MM-DD" in the business timezone. */
export function wallDateIn(isoInstant: string, timeZone: string): string {
  const w = wallClockAt(timeZone, new Date(isoInstant));
  return `${pad4(w.year)}-${pad2(w.month)}-${pad2(w.day)}`;
}

// ---------- calendar-date arithmetic (no timezone involved) ----------

/** Add whole days to a "YYYY-MM-DD" date. UTC maths, so never DST-skewed. */
export function addDaysISO(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000);
  return `${pad4(at.getUTCFullYear())}-${pad2(at.getUTCMonth() + 1)}-${pad2(at.getUTCDate())}`;
}

/** Day of week for a "YYYY-MM-DD" date: 0=Sun … 6=Sat (matches the schema). */
export function dayOfWeekISO(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The `days` consecutive dates starting at `start`, inclusive. */
export function dateRange(start: string, days: number): string[] {
  return Array.from({ length: Math.max(0, days) }, (_, i) => addDaysISO(start, i));
}

/**
 * Real elapsed paid hours between two instants, break excluded. Computed from
 * the instants (not wall clock) so a shift spanning a DST change is honestly 7
 * or 9 hours, never assumed to be 8 (M5 §10).
 */
export function elapsedHours(startISO: string, endISO: string, breakMinutes = 0): number {
  const ms = new Date(endISO).getTime() - new Date(startISO).getTime();
  const minutes = ms / 60_000 - Math.max(0, breakMinutes);
  return Math.max(0, minutes) / 60;
}
