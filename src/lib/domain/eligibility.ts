// The SINGLE shared eligibility check (TECH_STACK §7, M6 §3.2).
//
// "Can this person work this shift, and if not, why?" — asked by manual editing
// on the draft-review screen (M6), and later by the swap flow (M8) when deciding
// who may claim a dropped shift. It must exist in exactly one place: the day the
// swap screen and the roster screen disagree about who is eligible is the day
// the product stops being trustworthy.
//
// The solver enforces the same rules as HARD constraints (M5 §5.1). This module
// is NOT a second implementation of the solver — it re-checks a single candidate
// against a single position, which is a different (and much smaller) problem.
//
// THE CENTRAL DISTINCTION (M6 §3.2):
//
//   BLOCK — physically impossible. Two places at once, a role they don't hold,
//           a person who no longer works here. Never allowed, no override.
//
//   WARN  — policy the manager may knowingly break. Unavailable, over hours,
//           short rest, too many days running. ALLOWED, but named — who, when,
//           which rule — and persisted as a visible flag (roster_warning) so a
//           knowing exception can never quietly become a forgotten one.
//
// Hard-blocking availability or hour limits would make the tool argue with the
// manager about his own restaurant. Making the violation visible and persistent
// is the honest middle ground.
//
// Pure: plain data in, typed issues out. Availability comes from the one M3
// resolver, hour ceilings from the one M4 resolver, durations from timezone.ts.

import { resolveMemberAvailability } from "./solver-request";
import type {
  AvailabilityInput,
  MemberInput,
  SolverRuleInput,
  TradingHoursInput,
} from "./solver-request";
import { resolveMaxHours } from "./template-feasibility";
import {
  addDaysISO,
  elapsedHours,
  minutesOfDay,
  wallDateIn,
  wallTimeIn,
  zonedInstant,
} from "./timezone";
import { formatDayLabel, formatHours } from "../utils";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Rules `roster_warning.rule` accepts (migration 0009 CHECK constraint). */
export const ROSTER_WARNING_RULES = [
  "availability",
  "max_hours",
  "min_rest",
  "consecutive_days",
  "senior_coverage",
  "min_hours",
] as const;
export type RosterWarningRule = (typeof ROSTER_WARNING_RULES)[number];

export type EligibilityRule =
  // BLOCK — physically impossible
  | "inactive"
  | "role"
  | "overlap"
  // WARN — policy the manager may override
  | "availability"
  | "max_hours"
  | "min_rest"
  | "consecutive_days"
  | "one_shift_per_day"
  | "min_hours";

export type EligibilitySeverity = "block" | "warn";

export interface EligibilityIssue {
  rule: EligibilityRule;
  severity: EligibilitySeverity;
  /** One sentence naming WHO, WHEN and WHICH RULE (M6 §3.2). Ready to render. */
  message: string;
  /** Two or three words for the greyed reason in a person picker. */
  short: string;
  /**
   * How this is stored in `roster_warning`, or null when the table's CHECK
   * vocabulary has no term for it. `one_shift_per_day` is the only such rule
   * today: it warns live but cannot be persisted until the DB owner widens the
   * constraint in a forward-only migration.
   */
  persistedRule: RosterWarningRule | null;
}

export interface EligibilityResult {
  /** No blocks and no warnings — the clean case. */
  eligible: boolean;
  /** At least one physically-impossible problem. The UI must refuse. */
  blocked: boolean;
  blocks: EligibilityIssue[];
  warnings: EligibilityIssue[];
  /** Everything, blocks first. */
  issues: EligibilityIssue[];
  /** The headline reason for a picker row, or null when clear. */
  reason: string | null;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The position (or shift) the person is being considered for. */
export interface EligibilityTarget {
  /** Trading day the work is anchored to. */
  date: string;
  /** UTC instants — real times, so DST is handled honestly. */
  startUtc: string;
  endUtc: string;
  roleId: string;
  breakMinutes?: number;
  /**
   * The shift currently occupying this position, if any. Excluded from the
   * overlap and hours maths so editing a shift doesn't collide with itself.
   */
  shiftId?: string | null;
}

/** One shift already on the roster, whoever it belongs to. */
export interface EligibilityShift {
  id: string;
  assignedUserId: string | null;
  date: string;
  startUtc: string;
  endUtc: string;
  breakMinutes: number;
}

export interface EligibilityContext {
  timezone: string;
  /** First date of the roster — weeks for the hour limits are cut from here. */
  rosterStart: string;
  rule: SolverRuleInput;
  availability: AvailabilityInput;
  tradingHours: TradingHoursInput[];
  /** Every shift on the roster; filtered to the candidate internally. */
  shifts: EligibilityShift[];
  /** roleId → display name, for messages the manager can read. */
  roleNames: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MS_PER_HOUR = 3_600_000;

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);
}

function daysBetween(from: string, to: string): number {
  const [ay, am, ad] = from.split("-").map(Number);
  const [by, bm, bd] = to.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Which week of the roster a date falls in (0-based), for the weekly limits. */
function weekIndex(rosterStart: string, date: string): number {
  return Math.floor(daysBetween(rosterStart, date) / 7);
}

function weekStartDate(rosterStart: string, date: string): string {
  return addDaysISO(rosterStart, weekIndex(rosterStart, date) * 7);
}

function shiftHours(s: { startUtc: string; endUtc: string; breakMinutes: number }): number {
  return elapsedHours(s.startUtc, s.endUtc, s.breakMinutes);
}

/** Does [from,to) in wall minutes sit inside any of the day's available windows? */
function coveredBy(
  windows: { from: string; to: string }[],
  fromMin: number,
  toMin: number,
): boolean {
  return windows.some((w) => minutesOfDay(w.from) <= fromMin && minutesOfDay(w.to) >= toMin);
}

function windowLabel(windows: { from: string; to: string }[]): string {
  return windows.map((w) => `${w.from}–${w.to}`).join(", ");
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/**
 * Classify every rule this assignment would breach.
 *
 * Blocks are returned first and are never overridable; warnings are returned in
 * a stable order so the UI never reshuffles between renders.
 */
export function checkEligibility(
  member: MemberInput,
  target: EligibilityTarget,
  context: EligibilityContext,
): EligibilityResult {
  const { timezone, rosterStart, rule, availability, tradingHours, shifts, roleNames } = context;
  const blocks: EligibilityIssue[] = [];
  const warnings: EligibilityIssue[] = [];

  const name = member.name;
  const roleName = roleNames[target.roleId] ?? "that role";
  const when = formatDayLabel(target.date);
  const startWall = wallTimeIn(target.startUtc, timezone);
  const endWall = wallTimeIn(target.endUtc, timezone);

  // The candidate's OTHER shifts — never the one being edited.
  const mine = shifts.filter(
    (s) => s.assignedUserId === member.id && s.id !== target.shiftId,
  );

  // ---- BLOCK 1: deactivated (H13) ----
  if (!member.active) {
    blocks.push({
      rule: "inactive",
      severity: "block",
      message: `${name} is deactivated and can't be rostered.`,
      short: "Deactivated",
      persistedRule: null,
    });
  }

  // ---- BLOCK 2: role not held (H1) ----
  // The UI turns this into an offer — "Add Kitchen to their roles?" — which
  // fixes the DATA and then allows the assignment (M6 §3.2). It is a block
  // rather than a warning because rostering someone to a job they aren't
  // marked for silently corrupts every later eligibility answer.
  if (!member.roleIds.includes(target.roleId)) {
    blocks.push({
      rule: "role",
      severity: "block",
      message: `${name} isn't marked for ${roleName}.`,
      short: `Not marked for ${roleName}`,
      persistedRule: null,
    });
  }

  // ---- BLOCK 3: overlap (H3) — nobody is in two places at once ----
  const clash = mine.find((s) => overlaps(target.startUtc, target.endUtc, s.startUtc, s.endUtc));
  if (clash) {
    blocks.push({
      rule: "overlap",
      severity: "block",
      message: `${name} is already rostered ${wallTimeIn(clash.startUtc, timezone)}–${wallTimeIn(
        clash.endUtc,
        timezone,
      )} on ${formatDayLabel(clash.date)} — nobody can be in two places at once.`,
      short: "Already rostered then",
      persistedRule: null,
    });
  }

  // ---- WARN 1: availability (H2, resolved through the one M3 function) ----
  const startMin = minutesOfDay(startWall);
  const crossesMidnight = wallDateIn(target.endUtc, timezone) !== wallDateIn(target.startUtc, timezone);
  const endMin = crossesMidnight ? minutesOfDay(endWall) + 1440 : minutesOfDay(endWall);

  const dayWindows = resolveMemberAvailability({
    member,
    dates: [target.date],
    availability,
    tradingHours,
  });

  let availabilityOk: boolean;
  if (crossesMidnight) {
    // Availability windows are clamped at midnight (M3), so an overnight shift
    // is checked against BOTH trading days rather than being warned about by
    // construction. A shift ending exactly at midnight needs no second day.
    const after = endMin - 1440;
    const nextWindows =
      after > 0
        ? resolveMemberAvailability({
            member,
            dates: [addDaysISO(target.date, 1)],
            availability,
            tradingHours,
          })
        : [];
    availabilityOk =
      coveredBy(dayWindows, startMin, 1440) && (after === 0 || coveredBy(nextWindows, 0, after));
  } else {
    availabilityOk = coveredBy(dayWindows, startMin, endMin);
  }

  if (!availabilityOk) {
    warnings.push({
      rule: "availability",
      severity: "warn",
      message: dayWindows.length
        ? `${name} is only available ${windowLabel(dayWindows)} on ${when}; this shift runs ${startWall}–${endWall}.`
        : `${name} is marked unavailable on ${when}.`,
      short: "Unavailable",
      persistedRule: "availability",
    });
  }

  // ---- WARN 2/6: weekly hours, over the limit and under the minimum (H4) ----
  const targetWeek = weekIndex(rosterStart, target.date);
  const weekLabel = formatDayLabel(weekStartDate(rosterStart, target.date));
  const hoursThisShift = elapsedHours(target.startUtc, target.endUtc, target.breakMinutes ?? 0);
  const weekHours =
    mine
      .filter((s) => weekIndex(rosterStart, s.date) === targetWeek)
      .reduce((sum, s) => sum + shiftHours(s), 0) + hoursThisShift;

  const maxHours = resolveMaxHours(
    {
      active: member.active,
      level: member.level,
      employmentType: member.employmentType,
      maxHoursWeek: member.maxHoursWeek,
      roleIds: member.roleIds,
    },
    rule,
  );
  if (weekHours > maxHours + 0.01) {
    warnings.push({
      rule: "max_hours",
      severity: "warn",
      message: `This puts ${name} at ${formatHours(weekHours)} in the week of ${weekLabel} (limit ${formatHours(maxHours)}).`,
      short: "Over hour limit",
      persistedRule: "max_hours",
    });
  }

  const minHours = member.minHoursWeek ?? 0;
  if (minHours > 0 && weekHours < minHours - 0.01) {
    warnings.push({
      rule: "min_hours",
      severity: "warn",
      message: `${name} would still be on ${formatHours(weekHours)} in the week of ${weekLabel}, below their ${formatHours(minHours)} minimum.`,
      short: "Below minimum hours",
      persistedRule: "min_hours",
    });
  }

  // ---- WARN 3: minimum rest between shifts (H7 — this is what stops a close-then-open) ----
  const targetStart = new Date(target.startUtc).getTime();
  const targetEnd = new Date(target.endUtc).getTime();
  let worstRest: { hours: number; other: EligibilityShift } | null = null;
  for (const s of mine) {
    const sStart = new Date(s.startUtc).getTime();
    const sEnd = new Date(s.endUtc).getTime();
    const gap =
      sEnd <= targetStart
        ? (targetStart - sEnd) / MS_PER_HOUR
        : targetEnd <= sStart
          ? (sStart - targetEnd) / MS_PER_HOUR
          : null;
    if (gap === null) continue; // overlap — already blocked above
    if (gap < rule.minRestHours && (!worstRest || gap < worstRest.hours)) {
      worstRest = { hours: gap, other: s };
    }
  }
  if (worstRest) {
    warnings.push({
      rule: "min_rest",
      severity: "warn",
      message: `Only ${formatHours(worstRest.hours)} rest between ${name}'s shift on ${formatDayLabel(
        worstRest.other.date,
      )} and this one (${formatHours(rule.minRestHours)} required).`,
      short: "Not enough rest",
      persistedRule: "min_rest",
    });
  }

  // ---- WARN 4: consecutive days (H6) ----
  const workedDates = new Set(mine.map((s) => s.date));
  workedDates.add(target.date);
  let run = 1;
  for (let d = 1; workedDates.has(addDaysISO(target.date, -d)); d++) run++;
  for (let d = 1; workedDates.has(addDaysISO(target.date, d)); d++) run++;
  if (run > rule.maxConsecutiveDays) {
    warnings.push({
      rule: "consecutive_days",
      severity: "warn",
      message: `This would be day ${run} in a row for ${name} (limit ${rule.maxConsecutiveDays}).`,
      short: "Too many days running",
      persistedRule: "consecutive_days",
    });
  }

  // ---- WARN 5: one shift per day (H8) ----
  if (rule.oneShiftPerDay && mine.some((s) => s.date === target.date)) {
    warnings.push({
      rule: "one_shift_per_day",
      severity: "warn",
      message: `${name} already has a shift on ${when}, and this business rosters one shift per person per day.`,
      short: "Already on that day",
      // No term for this in the roster_warning CHECK vocabulary yet — it warns
      // live but is not persisted. See EligibilityIssue.persistedRule.
      persistedRule: null,
    });
  }

  const issues = [...blocks, ...warnings];
  return {
    eligible: issues.length === 0,
    blocked: blocks.length > 0,
    blocks,
    warnings,
    issues,
    reason: issues[0]?.short ?? null,
  };
}

// ---------------------------------------------------------------------------
// Senior coverage — a ROSTER-level rule, not a per-person one (M5 §5.3)
// ---------------------------------------------------------------------------

export interface SeniorCoverageGap {
  date: string;
  from: string; // "HH:MM" in the business timezone
  to: string;
  detail: string;
}

export interface SeniorCoverageInput {
  dates: string[];
  /** Locations whose open hours must be covered (those with demand). */
  locationIds: string[];
  shifts: EligibilityShift[];
  members: MemberInput[];
  rule: SolverRuleInput;
  tradingHours: TradingHoursInput[];
  timezone: string;
}

/** Coverage is checked in 15-minute blocks, exactly as the solver models it. */
const BLOCK_MINUTES = 15;

/**
 * Open-hours windows with fewer than the required number of senior-qualifying
 * people present. Recomputed live after every manual edit, so the health panel
 * can never show a gap the manager has already fixed.
 *
 * Reasoned over real instants, so an overnight trading day is one continuous run
 * of blocks rather than two broken halves, and a DST change shifts nothing.
 */
export function seniorCoverageGaps(input: SeniorCoverageInput): SeniorCoverageGap[] {
  const { dates, locationIds, shifts, members, rule, tradingHours, timezone } = input;
  if (!rule.seniorCoverageEnabled) return [];

  const seniorIds = new Set(
    members
      .filter((m) => m.active && rule.seniorQualifyingLevels.includes(m.level))
      .map((m) => m.id),
  );
  const seniorShifts = shifts.filter(
    (s) => s.assignedUserId !== null && seniorIds.has(s.assignedUserId),
  );
  const need = Math.max(1, rule.seniorMinCount);
  const gaps: SeniorCoverageGap[] = [];

  for (const date of dates) {
    const [y, m, d] = date.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

    for (const locationId of locationIds) {
      const row = tradingHours.find((t) => t.locationId === locationId && t.dayOfWeek === dow);
      if (!row || !row.isOpen) continue;

      const openMin = row.is24h ? 0 : minutesOfDay(row.opensAt ?? "00:00");
      const rawClose = row.is24h ? 1440 : minutesOfDay(row.closesAt ?? "24:00");
      const closeMin = rawClose <= openMin ? rawClose + 1440 : rawClose; // overnight

      let runStart: number | null = null;
      for (let t = openMin; t < closeMin; t += BLOCK_MINUTES) {
        const at = zonedInstant(date, t, timezone).getTime();
        const covered = seniorShifts.filter(
          (s) => new Date(s.startUtc).getTime() <= at && at < new Date(s.endUtc).getTime(),
        ).length;
        const short = covered < need;
        if (short && runStart === null) runStart = t;
        if (!short && runStart !== null) {
          gaps.push(makeGap(date, runStart, t, need, timezone));
          runStart = null;
        }
      }
      if (runStart !== null) gaps.push(makeGap(date, runStart, closeMin, need, timezone));
    }
  }
  return gaps;
}

function makeGap(
  date: string,
  fromMin: number,
  toMin: number,
  need: number,
  timezone: string,
): SeniorCoverageGap {
  const from = wallTimeIn(zonedInstant(date, fromMin, timezone).toISOString(), timezone);
  const to = wallTimeIn(zonedInstant(date, toMin, timezone).toISOString(), timezone);
  return {
    date,
    from,
    to,
    detail:
      need === 1
        ? `No senior is rostered ${from}–${to} on ${formatDayLabel(date)}.`
        : `Fewer than ${need} seniors are rostered ${from}–${to} on ${formatDayLabel(date)}.`,
  };
}
