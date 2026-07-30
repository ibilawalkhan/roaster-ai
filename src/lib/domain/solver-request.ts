// Builds the /solve request defined by docs/SOLVER_CONTRACT.md (FROZEN v1).
//
// This module is PURE: plain data in, the exact wire object out. It is the only
// place the app knows the contract's shape, so the page never hand-rolls JSON
// and the contract can be diffed against this file field by field.
//
// Two rules from the contract that this file exists to honour:
//   1. Positions are expanded — one object PER PERSON NEEDED. A template slot
//      with count 3 becomes three positions; the solver never sees a "count".
//   2. Availability arrives PRE-RESOLVED, through the one shared resolver
//      (src/lib/domain/availability.ts, M3 §6). The solver never re-derives
//      pattern/exception logic, so the two sides can never disagree.
//
// Wire field names are snake_case because that is the contract; every app-side
// input stays camelCase.

import { resolveAvailability } from "./availability";
import { resolveMaxHours, type SchedulingRuleLike } from "./template-feasibility";
import {
  dateRange,
  dayOfWeekISO,
  elapsedHours,
  minutesOfDay,
  zonedTimestamp,
} from "./timezone";
import type { EmploymentType, Level, TimeOfDay } from "../types";

// ---------------------------------------------------------------------------
// The wire contract (docs/SOLVER_CONTRACT.md § Request)
// ---------------------------------------------------------------------------

export interface SolveRosterSpec {
  start_date: string; // "YYYY-MM-DD"
  days: number;
  timezone: string; // IANA, e.g. "Australia/Sydney"
}

export interface SolvePosition {
  id: string;
  date: string; // trading day the position is anchored to
  location_id: string;
  role_id: string;
  /**
   * Human labels, used ONLY in the solver's diagnostic text (M5 §6). Optional:
   * the solver falls back to the ids. They matter because an unfilled position
   * reading "Nobody can work 0000…-c1" is useless to a manager — the whole
   * value of the gap report is that it names something he can act on.
   */
  role_name?: string;
  location_name?: string;
  start: string; // ISO-8601 with offset
  end: string; // ISO-8601 with offset (next day when overnight)
  required_level: Level | null;
}

/** A pre-resolved availability window, in business-local wall time. */
export interface SolveWindow {
  date: string;
  from: string; // "HH:MM"
  to: string; // "HH:MM" — "24:00" means end of day (M3 convention)
}

export interface SolvePerson {
  id: string;
  roles: string[];
  level: Level;
  location_id: string | null;
  can_work_other_locations: boolean;
  pay_rate: number;
  max_hours_week: number;
  min_hours_week: number;
  max_shifts_week: number | null;
  /** Empty ⇒ unavailable for the whole period (contract). */
  availability: SolveWindow[];
  preferred_days: number[]; // 0=Sun..6=Sat
  preferred_time: TimeOfDay;
}

export interface SolveSeniorCoverage {
  enabled: boolean;
  min_count: number;
  qualifying_levels: Level[];
  open_hours: SolveWindow[];
}

export interface SolveRules {
  senior_coverage: SolveSeniorCoverage;
  max_consecutive_days: number;
  min_rest_hours: number;
  max_shift_hours: number;
  min_shift_hours: number;
  one_shift_per_day: boolean;
}

export interface SolvePair {
  position_id: string;
  user_id: string;
}

export interface SolvePreviousShift {
  user_id: string;
  date: string;
  start: string;
  end: string;
}

export interface SolveRequest {
  roster: SolveRosterSpec;
  positions: SolvePosition[];
  people: SolvePerson[];
  rules: SolveRules;
  locked: SolvePair[];
  excluded: SolvePair[];
  objective_priority: string[];
  previous_roster: SolvePreviousShift[];
  time_limit_seconds: number;
  seed: number;
}

// ---------------------------------------------------------------------------
// App-side inputs (camelCase; adapted from Supabase rows by the caller)
// ---------------------------------------------------------------------------

/** One `template_slot` row, reduced to what expansion needs. */
export interface SlotInput {
  id: string;
  locationId: string;
  dayOfWeek: number; // 0=Sun..6=Sat
  roleId: string;
  start: string; // "HH:MM"
  end: string; // "HH:MM" (≤ start ⇒ crosses midnight)
  count: number;
  requiredLevel: Level | null;
  label: string | null;
}

/** One `trading_hours` row. */
export interface TradingHoursInput {
  locationId: string;
  dayOfWeek: number;
  isOpen: boolean;
  is24h: boolean;
  opensAt: string | null; // "HH:MM"
  closesAt: string | null; // "HH:MM"
}

/** One `app_user` row, reduced to what the solver needs to know about a person. */
export interface MemberInput {
  id: string;
  name: string;
  active: boolean;
  level: Level;
  employmentType: EmploymentType;
  roleIds: string[];
  homeLocationId: string | null;
  canWorkOtherLocations: boolean;
  payRate: number;
  maxHoursWeek: number | null;
  minHoursWeek: number | null;
  maxShiftsWeek: number | null;
  preferredDays: number[];
  preferredTimeOfDay: TimeOfDay | null;
}

export interface PatternInputRow {
  userId: string;
  dayOfWeek: number;
  isAvailable: boolean;
  from: string | null;
  to: string | null;
}

export interface ExceptionInputRow {
  userId: string;
  date: string;
  isAvailable: boolean;
  from: string | null;
  to: string | null;
}

export interface AvailabilityInput {
  patterns: PatternInputRow[];
  exceptions: ExceptionInputRow[];
}

/** `scheduling_rule`, reduced. Extends the M4 shape so max-hours resolution is shared. */
export interface SolverRuleInput extends SchedulingRuleLike {
  maxConsecutiveDays: number;
  minRestHours: number;
  maxShiftHours: number;
  minShiftHours: number;
  oneShiftPerDay: boolean;
  softPriorityOrder?: string[];
}

// ---------------------------------------------------------------------------
// Position expansion
// ---------------------------------------------------------------------------

export interface ExpandPositionsInput {
  rosterStart: string; // "YYYY-MM-DD"
  days: number;
  timezone: string;
  slots: SlotInput[];
  tradingHours: TradingHoursInput[];
}

/** A concrete dated requirement — one person needed, one slot copy. */
export interface ExpandedPosition {
  /**
   * Deterministic identity for this copy (`slotId:date:index`). The roster is
   * seeded with these keys mapped to real `roster_position` ids; the builder
   * substitutes those ids so the solver's `position_id` is a database row.
   */
  key: string;
  slotId: string;
  date: string;
  locationId: string;
  roleId: string;
  /** ISO with the business-timezone offset — the contract's `start`/`end`. */
  start: string;
  end: string;
  /** The same instants in UTC — what `roster_position.start_at/end_at` store. */
  startUtc: string;
  endUtc: string;
  requiredLevel: Level | null;
  label: string | null;
  /** Real elapsed hours (DST-correct), for the seeded summary and estimates. */
  hours: number;
}

const tradingKey = (locationId: string, dayOfWeek: number): string =>
  `${locationId}:${dayOfWeek}`;

function tradingIndex(rows: TradingHoursInput[]): Map<string, TradingHoursInput> {
  const m = new Map<string, TradingHoursInput>();
  for (const r of rows) m.set(tradingKey(r.locationId, r.dayOfWeek), r);
  return m;
}

/**
 * Expand the week template onto real dates: one position per person needed.
 *
 * A day the location is closed produces NO positions — a closed day has no
 * demand, and inventing one would hand the manager an unfillable gap (M5 §10).
 * An overnight slot stays anchored to its START date; only its end instant
 * rolls into the next day (M5 §10).
 */
export function expandPositions(input: ExpandPositionsInput): ExpandedPosition[] {
  const { rosterStart, days, timezone, slots, tradingHours } = input;
  const trading = tradingIndex(tradingHours);
  const out: ExpandedPosition[] = [];

  for (const date of dateRange(rosterStart, days)) {
    const dow = dayOfWeekISO(date);
    for (const slot of slots) {
      if (slot.dayOfWeek !== dow) continue;
      const open = trading.get(tradingKey(slot.locationId, dow));
      if (!open || !open.isOpen) continue; // closed day ⇒ no positions

      const startMin = minutesOfDay(slot.start);
      const rawEnd = minutesOfDay(slot.end);
      const endMin = rawEnd <= startMin ? rawEnd + 1440 : rawEnd; // crosses midnight
      const start = zonedTimestamp(date, startMin, timezone);
      const end = zonedTimestamp(date, endMin, timezone);

      for (let i = 0; i < Math.max(1, slot.count); i++) {
        out.push({
          key: `${slot.id}:${date}:${i}`,
          slotId: slot.id,
          date,
          locationId: slot.locationId,
          roleId: slot.roleId,
          start: start.local,
          end: end.local,
          startUtc: start.utc,
          endUtc: end.utc,
          requiredLevel: slot.requiredLevel,
          label: slot.label,
          hours: elapsedHours(start.utc, end.utc),
        });
      }
    }
  }
  return out;
}

/** Total hours the seeded positions demand — the "412 hours" in the M5 §2 summary. */
export function totalPositionHours(positions: ExpandedPosition[]): number {
  return positions.reduce((sum, p) => sum + p.hours, 0);
}

// ---------------------------------------------------------------------------
// Availability pre-resolution
// ---------------------------------------------------------------------------

function patternIndex(rows: PatternInputRow[]): Map<string, PatternInputRow> {
  const m = new Map<string, PatternInputRow>();
  for (const r of rows) m.set(`${r.userId}:${r.dayOfWeek}`, r);
  return m;
}

function exceptionIndex(rows: ExceptionInputRow[]): Map<string, ExceptionInputRow> {
  const m = new Map<string, ExceptionInputRow>();
  for (const r of rows) m.set(`${r.userId}:${r.date}`, r);
  return m;
}

/**
 * The location whose trading hours bound a person's availability: their home
 * location, else the only location there is. Multi-location members who can work
 * elsewhere are still resolved against their home hours in MVP — widening that
 * union is a V1.1 concern and would change the contract's meaning of a window.
 */
function locationForMember(
  member: MemberInput,
  tradingHours: TradingHoursInput[],
): string | null {
  if (member.homeLocationId) return member.homeLocationId;
  const distinct = Array.from(new Set(tradingHours.map((t) => t.locationId))).sort();
  return distinct.length === 1 ? distinct[0] : (distinct[0] ?? null);
}

export interface ResolveMemberAvailabilityInput {
  member: MemberInput;
  dates: string[];
  availability: AvailabilityInput;
  tradingHours: TradingHoursInput[];
}

/**
 * One person's availability across the roster, already intersected with trading
 * hours by the shared M3 resolver. Empty ⇒ the person cannot work at all.
 */
export function resolveMemberAvailability(
  input: ResolveMemberAvailabilityInput,
): SolveWindow[] {
  const { member, dates, availability, tradingHours } = input;
  const patterns = patternIndex(availability.patterns);
  const exceptions = exceptionIndex(availability.exceptions);
  const trading = tradingIndex(tradingHours);
  const locationId = locationForMember(member, tradingHours);

  const windows: SolveWindow[] = [];
  for (const date of dates) {
    const dow = dayOfWeekISO(date);
    const open = locationId ? trading.get(tradingKey(locationId, dow)) : undefined;
    const resolved = resolveAvailability({
      pattern: patterns.get(`${member.id}:${dow}`) ?? null,
      exception: exceptions.get(`${member.id}:${date}`) ?? null,
      trading: open
        ? {
            isOpen: open.isOpen,
            is24h: open.is24h,
            opensAt: open.opensAt,
            closesAt: open.closesAt,
          }
        : null,
    });
    for (const w of resolved.windows) windows.push({ date, from: w.from, to: w.to });
  }
  return windows;
}

// ---------------------------------------------------------------------------
// Senior-coverage open hours
// ---------------------------------------------------------------------------

/**
 * Open-hours windows for the senior-coverage timeline constraint (M5 §5.3).
 * Only locations that actually have demand contribute. A cross-midnight day is
 * passed through as `to <= from`; the solver's timeline already spans midnight,
 * so splitting it here would break the continuous run of blocks.
 */
function openHoursWindows(
  dates: string[],
  positions: ExpandedPosition[],
  tradingHours: TradingHoursInput[],
): SolveWindow[] {
  const trading = tradingIndex(tradingHours);
  const locations = Array.from(new Set(positions.map((p) => p.locationId))).sort();
  const seen = new Set<string>();
  const out: SolveWindow[] = [];

  for (const date of dates) {
    const dow = dayOfWeekISO(date);
    for (const locationId of locations) {
      const row = trading.get(tradingKey(locationId, dow));
      if (!row || !row.isOpen) continue;
      const from = row.is24h ? "00:00" : (row.opensAt?.slice(0, 5) ?? null);
      const to = row.is24h ? "24:00" : (row.closesAt?.slice(0, 5) ?? null);
      if (!from || !to) continue;
      const key = `${date}|${from}|${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ date, from, to });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The request builder
// ---------------------------------------------------------------------------

/** Contract default (M5 §8): 15s normal, 30s hard ceiling. */
export const DEFAULT_TIME_LIMIT_SECONDS = 15;
export const MAX_TIME_LIMIT_SECONDS = 30;
/** Fixed by default so the same inputs always explain the same output (M5 §8). */
export const DEFAULT_SEED = 42;
export const DEFAULT_OBJECTIVE_PRIORITY = ["fairness", "cost", "preferences", "consistency"];

export interface BuildSolveRequestInput {
  rosterStart: string;
  days: number;
  timezone: string;
  tradingHours: TradingHoursInput[];
  /** The week template's slots — expanded here. Ignored when `positions` is given. */
  slots?: SlotInput[];
  /**
   * Already-expanded positions, which is what a seeded roster has: the
   * persisted `roster_position` rows ARE the demand, and the roster must never
   * re-read the template (it may have been edited since). Use `key` = the row id.
   */
  positions?: ExpandedPosition[];
  members: MemberInput[];
  availability: AvailabilityInput;
  rule: SolverRuleInput;
  /** H11 — manager-pinned pairs that must hold exactly. */
  locked?: SolvePair[];
  /** H12 — manager-blocked pairs that must not occur. */
  excluded?: SolvePair[];
  objectivePriority?: string[];
  previousRoster?: SolvePreviousShift[];
  seed?: number;
  timeLimitSeconds?: number;
  /**
   * Expansion key → persisted `roster_position.id`. Supplied once the roster is
   * seeded so the solver answers with database ids. Without it the deterministic
   * keys are used, which is what the unit tests assert against.
   */
  positionIdByKey?: Record<string, string>;
  /**
   * id → display name, so the solver's unfilled/gap explanations name a role
   * and a place instead of a UUID (M5 §6). Optional; ids are used if absent.
   */
  roleNames?: Record<string, string>;
  locationNames?: Record<string, string>;
}

/** Build the exact `/solve` request body. Pure — no I/O, no clock, no randomness. */
export function buildSolveRequest(input: BuildSolveRequestInput): SolveRequest {
  const {
    rosterStart,
    days,
    timezone,
    members,
    availability,
    tradingHours,
    rule,
    locked = [],
    excluded = [],
    objectivePriority,
    previousRoster = [],
    seed = DEFAULT_SEED,
    timeLimitSeconds = DEFAULT_TIME_LIMIT_SECONDS,
    positionIdByKey,
  } = input;

  const dates = dateRange(rosterStart, days);
  const expanded =
    input.positions ??
    expandPositions({
      rosterStart,
      days,
      timezone,
      slots: input.slots ?? [],
      tradingHours,
    });

  const positions: SolvePosition[] = expanded.map((p) => ({
    id: positionIdByKey?.[p.key] ?? p.key,
    date: p.date,
    location_id: p.locationId,
    role_id: p.roleId,
    // Omitted entirely when unknown, so the payload stays clean and the solver
    // falls back to the id rather than printing "undefined".
    ...(input.roleNames?.[p.roleId] ? { role_name: input.roleNames[p.roleId] } : {}),
    ...(input.locationNames?.[p.locationId]
      ? { location_name: input.locationNames[p.locationId] }
      : {}),
    start: p.start,
    end: p.end,
    required_level: p.requiredLevel,
  }));

  // H13 — deactivated people are never offered to the solver.
  const people: SolvePerson[] = members
    .filter((m) => m.active)
    .map((m) => ({
      id: m.id,
      roles: m.roleIds,
      level: m.level,
      location_id: m.homeLocationId,
      can_work_other_locations: m.canWorkOtherLocations,
      pay_rate: m.payRate,
      max_hours_week: resolveMaxHours(
        {
          active: m.active,
          level: m.level,
          employmentType: m.employmentType,
          maxHoursWeek: m.maxHoursWeek,
          roleIds: m.roleIds,
        },
        rule,
      ),
      min_hours_week: m.minHoursWeek ?? 0,
      max_shifts_week: m.maxShiftsWeek,
      availability: resolveMemberAvailability({
        member: m,
        dates,
        availability,
        tradingHours,
      }),
      preferred_days: m.preferredDays,
      preferred_time: m.preferredTimeOfDay ?? "no_preference",
    }));

  const rules: SolveRules = {
    senior_coverage: {
      enabled: rule.seniorCoverageEnabled,
      min_count: rule.seniorMinCount,
      qualifying_levels: rule.seniorQualifyingLevels,
      open_hours: rule.seniorCoverageEnabled
        ? openHoursWindows(dates, expanded, tradingHours)
        : [],
    },
    max_consecutive_days: rule.maxConsecutiveDays,
    min_rest_hours: rule.minRestHours,
    max_shift_hours: rule.maxShiftHours,
    min_shift_hours: rule.minShiftHours,
    one_shift_per_day: rule.oneShiftPerDay,
  };

  return {
    roster: { start_date: rosterStart, days, timezone },
    positions,
    people,
    rules,
    locked,
    excluded,
    objective_priority:
      objectivePriority ?? rule.softPriorityOrder ?? DEFAULT_OBJECTIVE_PRIORITY,
    previous_roster: previousRoster,
    time_limit_seconds: Math.min(
      MAX_TIME_LIMIT_SECONDS,
      Math.max(1, Math.round(timeLimitSeconds)),
    ),
    seed,
  };
}
