// Report aggregations for Module 10 (Costs & Reporting). Pure — no React, no
// Supabase, no I/O — so every rule below is unit-testable without a database.
//
// GOVERNING CONSTRAINT (M10 §0): every figure produced here is an INDICATIVE
// LABOUR-COST ESTIMATE FOR ROSTERING ONLY. It is not payroll: no casual loading,
// no penalty rates, no overtime, no allowances, no super, no tax. It is rostered
// hours × the base rate the manager typed in, nothing more. Any surface that
// renders one of these numbers renders `COST_DISCLAIMER` (cost.ts) beside it.
//
// The rules this module exists to enforce, all from M10 §2:
//
//   1. ONE shared calculation. Hours come from `elapsedHours` (real elapsed time
//      between instants, so a shift across a daylight-saving change is honestly
//      7 or 9 hours, never assumed 8); cost comes from `shiftCost`. Nothing here
//      re-implements either.
//
//   2. PAY-RATE SNAPSHOTS (§2.1). Cost uses `payRateSnapshot` — the rate frozen
//      on the shift at assignment — and NEVER the person's current rate. Giving
//      someone a raise must not silently rewrite what every past roster cost.
//      There is deliberately no fallback to a current rate anywhere in this file.
//
//   3. A shift is anchored to its START date (§2). A 22:00–06:00 shift counts
//      entirely on the day it started, matching the roster grid (M5 §10).
//
//   4. FULL PRECISION until display. Every sum accumulates unrounded values and
//      is rounded exactly once, at the end — never the sum of rounded parts.
//
//   5. UNFILLED POSITIONS COST NOTHING BUT ARE NEVER HIDDEN (§8). A roster with
//      three unfilled shifts is not actually cheap. Unfilled entries carry no
//      cost and no rostered hours, and are counted (and their uncovered hours
//      tallied) in every bucket so no view can make a gap look like a saving.
//
// ---------------------------------------------------------------------------
// Why rows are reconciled to the total
// ---------------------------------------------------------------------------
// §2 requires the total to be the rounded sum of unrounded values, and the
// acceptance criteria require "a column total always equals the sum of its rows
// as shown". Those two are not automatically compatible: three shifts of
// $213.875 sum to $641.63 rounded once, but each displayed as $213.88 they add
// to $641.64 — the classic off-by-cents column.
//
// So the total is always the authority (computed the §2 way from unrounded
// values), and each row's displayed cents are allocated against it: rows are
// rounded normally and the residual cent, if any, is applied to the largest
// rows. Every row stays within one cent of its true value, and a manager can
// always add a column up by hand and get the printed total. Same treatment for
// hours. See `allocateRounded`.

import { roundHours, roundMoney, shiftCost } from "./cost";
import { addDaysISO, dateRange, elapsedHours } from "./timezone";

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

/**
 * One row of report input: an assigned shift, or an unfilled position.
 *
 * `userId === null` means NOBODY IS ON IT — either a `roster_position` that no
 * shift ever filled, or a shift whose assignee was removed (dropped/open). Such
 * a row contributes no cost and no rostered hours; it is counted as unfilled.
 *
 * `payRateSnapshot` is the rate frozen at assignment (M10 §2.1). A filled shift
 * with a null snapshot is a data gap, not a free shift: it contributes its hours
 * but no cost, and is counted in `missingRateCount` so the UI can say the
 * estimate is incomplete rather than quietly under-report.
 */
export interface ReportShift {
  id: string;
  /** Trading day the shift belongs to — its START date (M10 §2). "YYYY-MM-DD". */
  date: string;
  /** UTC ISO instant. */
  startAt: string;
  /** UTC ISO instant. */
  endAt: string;
  breakMinutes: number;
  roleId: string;
  locationId: string;
  /** null ⇒ unfilled: no cost, no rostered hours, but counted and surfaced. */
  userId: string | null;
  userName: string | null;
  /** Rate frozen at assignment. NEVER substituted with a current rate. */
  payRateSnapshot: number | null;
}

/** The run of calendar days a report covers. */
export interface ReportPeriod {
  /** "YYYY-MM-DD" — first day, inclusive. */
  startDate: string;
  /** Number of days, inclusive of the start (7 = week, 14 = fortnight). */
  days: number;
}

/** Filters applied consistently across every view (M10 §5). */
export interface ReportFilter {
  /** null/undefined ⇒ all locations. */
  locationId?: string | null;
  /** null/undefined ⇒ all roles. Used on the by-person view (M10 §5). */
  roleId?: string | null;
}

// ---------------------------------------------------------------------------
// Per-shift primitives
// ---------------------------------------------------------------------------

/** True when somebody is actually rostered on this row. */
export function isFilled(shift: ReportShift): boolean {
  return shift.userId !== null;
}

/**
 * Real elapsed paid hours for one row, break excluded — computed from the
 * INSTANTS, so a shift spanning a DST change is 7 or 9 hours, never assumed 8.
 * Full precision; callers round at display.
 */
export function reportShiftHours(shift: ReportShift): number {
  return elapsedHours(shift.startAt, shift.endAt, shift.breakMinutes);
}

/**
 * Estimated cost of one row, in full precision, from the shift's OWN rate
 * snapshot (M10 §2.1). Unfilled rows and rows with no snapshot cost nothing.
 */
export function reportShiftCost(shift: ReportShift): number {
  if (shift.userId === null || shift.payRateSnapshot === null) return 0;
  return shiftCost(reportShiftHours(shift), shift.payRateSnapshot);
}

/** Apply the location/role filters (M10 §5). Never mutates the input. */
export function filterShifts(
  shifts: readonly ReportShift[],
  filter: ReportFilter = {},
): ReportShift[] {
  const { locationId, roleId } = filter;
  return shifts.filter(
    (s) =>
      (locationId == null || s.locationId === locationId) &&
      (roleId == null || s.roleId === roleId),
  );
}

// ---------------------------------------------------------------------------
// Rounding that keeps a column adding up (see module header)
// ---------------------------------------------------------------------------

/**
 * Round `values` to `decimals` such that they sum EXACTLY to `total` — which is
 * itself the unrounded sum, rounded once (M10 §2).
 *
 * Each value is rounded normally; any residual unit is then applied to the
 * largest values first, so no row moves by more than one cent (or 0.01h) and the
 * printed column always adds to the printed total. Deterministic: ties break on
 * the earlier index, so the same data always renders the same numbers.
 */
export function allocateRounded(
  values: readonly number[],
  total: number,
  decimals = 2,
): number[] {
  if (values.length === 0) return [];
  const scale = 10 ** decimals;
  const units = values.map((v) => Math.round(v * scale));
  const targetUnits = Math.round(total * scale);
  let drift = targetUnits - units.reduce((sum, u) => sum + u, 0);

  if (drift !== 0) {
    // Largest rows absorb the residual — a cent is least visible there.
    const order = values
      .map((v, i) => ({ v, i }))
      .sort((a, b) => b.v - a.v || a.i - b.i)
      .map((x) => x.i);
    const step = drift > 0 ? 1 : -1;
    for (let n = 0; drift !== 0; n += 1) {
      units[order[n % order.length]] += step;
      drift -= step;
    }
  }

  return units.map((u) => u / scale);
}

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

/** Figures shared by every breakdown row. All money is an estimate (M10 §0). */
export interface CostBucket {
  /** Estimated cost, rounded and reconciled to the period total. */
  cost: number;
  /** Rostered hours of FILLED shifts, rounded and reconciled to the total. */
  hours: number;
  /** Filled shifts only. */
  shiftCount: number;
  /** Distinct people rostered. */
  peopleCount: number;
  /** Positions nobody is on. Cost nothing — which is exactly why they're shown. */
  unfilledCount: number;
  /** Hours those unfilled positions would have covered. */
  unfilledHours: number;
  /** Filled shifts carrying no rate snapshot — their cost is missing, not zero. */
  missingRateCount: number;
}

export interface DayCost extends CostBucket {
  date: string;
}

export interface WeekCost extends CostBucket {
  /** 1-based: week 1 vs week 2 of a fortnight (M10 §3.1). */
  index: number;
  startDate: string;
  endDate: string;
}

export interface RoleCost extends CostBucket {
  roleId: string;
  /** Share of the period's estimated cost, 0–1 (M10 §3.4). */
  share: number;
}

export interface LocationCost extends CostBucket {
  locationId: string;
  share: number;
}

/** One row of the ranked by-person table (M10 §3.3). */
export interface PersonCost {
  userId: string;
  name: string;
  hours: number;
  shiftCount: number;
  cost: number;
  /**
   * Effective $/hour across the period — cost ÷ hours from the rate snapshots,
   * so it reflects what the roster actually assumed, not today's rate.
   */
  rate: number;
  /** True when this person's shifts carry more than one snapshot rate. */
  rateVaries: boolean;
}

export interface RosterCostSummary {
  totalCost: number;
  totalHours: number;
  shiftCount: number;
  peopleCount: number;
  /** Period-wide $/hour: total cost ÷ total hours. 0 when nothing is rostered. */
  averageHourlyRate: number;
  unfilledCount: number;
  unfilledHours: number;
  missingRateCount: number;
  /** Week 1 vs week 2 … — empty unless a period spanning >1 week is supplied. */
  weeks: WeekCost[];
}

// ---------------------------------------------------------------------------
// Accumulation
// ---------------------------------------------------------------------------

interface RawBucket {
  cost: number; // unrounded
  hours: number; // unrounded
  shiftCount: number;
  people: Set<string>;
  unfilledCount: number;
  unfilledHours: number; // unrounded
  missingRateCount: number;
}

function newRaw(): RawBucket {
  return {
    cost: 0,
    hours: 0,
    shiftCount: 0,
    people: new Set<string>(),
    unfilledCount: 0,
    unfilledHours: 0,
    missingRateCount: 0,
  };
}

function accumulate(bucket: RawBucket, shift: ReportShift): void {
  const hours = reportShiftHours(shift);
  if (shift.userId === null) {
    // An unfilled position: no cost, no rostered hours — but never invisible.
    bucket.unfilledCount += 1;
    bucket.unfilledHours += hours;
    return;
  }
  bucket.shiftCount += 1;
  bucket.hours += hours;
  bucket.cost += reportShiftCost(shift);
  bucket.people.add(shift.userId);
  if (shift.payRateSnapshot === null) bucket.missingRateCount += 1;
}

function totalRaw(shifts: readonly ReportShift[]): RawBucket {
  const raw = newRaw();
  for (const s of shifts) accumulate(raw, s);
  return raw;
}

/**
 * Finish a set of buckets: round each figure once and reconcile the cost and
 * hours columns to the period totals so the printed column adds up.
 */
function finishBuckets(raws: readonly RawBucket[], total: RawBucket): CostBucket[] {
  const costs = allocateRounded(
    raws.map((r) => r.cost),
    roundMoney(total.cost),
  );
  const hours = allocateRounded(
    raws.map((r) => r.hours),
    roundHours(total.hours),
  );
  const unfilledHours = allocateRounded(
    raws.map((r) => r.unfilledHours),
    roundHours(total.unfilledHours),
  );
  return raws.map((r, i) => ({
    cost: costs[i],
    hours: hours[i],
    shiftCount: r.shiftCount,
    peopleCount: r.people.size,
    unfilledCount: r.unfilledCount,
    unfilledHours: unfilledHours[i],
    missingRateCount: r.missingRateCount,
  }));
}

/** Share of the period's cost, 0–1, from UNROUNDED values. 0 when nothing costs. */
function shareOf(cost: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((cost / total) * 10_000) / 10_000;
}

/** Group into ordered buckets, keeping first-seen order for stable output. */
function groupBy(
  shifts: readonly ReportShift[],
  key: (s: ReportShift) => string,
): Map<string, RawBucket> {
  const groups = new Map<string, RawBucket>();
  for (const s of shifts) {
    const k = key(s);
    let bucket = groups.get(k);
    if (!bucket) {
      bucket = newRaw();
      groups.set(k, bucket);
    }
    accumulate(bucket, s);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/**
 * The headline figures (M10 §3.1) — total estimated cost, rostered hours, shift
 * and people counts, average $/hour, plus the unfilled count that stops a
 * gap-ridden roster reading as a cheap one (§8).
 *
 * Pass `period` to get the week-by-week comparison (week 1 vs week 2 of a
 * fortnight); without it `weeks` is empty.
 */
export function rosterCostSummary(
  shifts: readonly ReportShift[],
  period?: ReportPeriod,
): RosterCostSummary {
  const raw = totalRaw(shifts);
  return {
    totalCost: roundMoney(raw.cost),
    totalHours: roundHours(raw.hours),
    shiftCount: raw.shiftCount,
    peopleCount: raw.people.size,
    // Divide the unrounded total by the unrounded hours, then round once.
    averageHourlyRate: raw.hours > 0 ? roundMoney(raw.cost / raw.hours) : 0,
    unfilledCount: raw.unfilledCount,
    unfilledHours: roundHours(raw.unfilledHours),
    missingRateCount: raw.missingRateCount,
    weeks: period && period.days > 7 ? costByWeek(shifts, period) : [],
  };
}

/**
 * Cost and hours per day — the bar chart that exposes an over-staffed Tuesday
 * (M10 §3.2). Every shift lands on its START date (§2).
 *
 * Pass `period` to get one row per day of the roster INCLUDING quiet days, so
 * the chart shows the shape of the week rather than only the days with shifts.
 */
export function costByDay(shifts: readonly ReportShift[], period?: ReportPeriod): DayCost[] {
  const groups = groupBy(shifts, (s) => s.date);
  const dates = period
    ? dateRange(period.startDate, period.days)
    : [...groups.keys()].sort((a, b) => a.localeCompare(b));
  // A shift outside the stated period would otherwise vanish from the chart
  // while still counting in the total, so the column would not add up.
  for (const date of groups.keys()) {
    if (!dates.includes(date)) dates.push(date);
  }
  dates.sort((a, b) => a.localeCompare(b));

  const raws = dates.map((d) => groups.get(d) ?? newRaw());
  const finished = finishBuckets(raws, totalRaw(shifts));
  return dates.map((date, i) => ({ date, ...finished[i] }));
}

/**
 * Cost per week of the period — week 1 vs week 2 of a fortnight (M10 §3.1).
 * Weeks are consecutive 7-day blocks from the period start; the final block is
 * clipped to the period end.
 */
export function costByWeek(shifts: readonly ReportShift[], period: ReportPeriod): WeekCost[] {
  const weekCount = Math.max(1, Math.ceil(period.days / 7));
  const bounds = Array.from({ length: weekCount }, (_, i) => {
    const startDate = addDaysISO(period.startDate, i * 7);
    const lastOffset = Math.min((i + 1) * 7, period.days) - 1;
    return { index: i + 1, startDate, endDate: addDaysISO(period.startDate, lastOffset) };
  });

  const raws = bounds.map(() => newRaw());
  for (const s of shifts) {
    // A shift outside the stated period still has to land somewhere, or the
    // week columns would not add up to the period total: clamp to the nearest end.
    let i = bounds.findIndex((b) => s.date >= b.startDate && s.date <= b.endDate);
    if (i === -1) i = s.date < bounds[0].startDate ? 0 : bounds.length - 1;
    accumulate(raws[i], s);
  }

  const finished = finishBuckets(raws, totalRaw(shifts));
  return bounds.map((b, i) => ({ ...b, ...finished[i] }));
}

/**
 * Who is costing what, ranked highest to lowest (M10 §3.3) — the view that
 * answers "who is my biggest cost?" and surfaces anyone unexpectedly at 45
 * hours. Unfilled positions have no person and so appear in no row; they are
 * reported by `rosterCostSummary` instead.
 */
export function costByPerson(shifts: readonly ReportShift[]): PersonCost[] {
  interface PersonRaw extends RawBucket {
    userId: string;
    name: string;
    rates: Set<number>;
  }
  const groups = new Map<string, PersonRaw>();
  for (const s of shifts) {
    if (s.userId === null) continue;
    let p = groups.get(s.userId);
    if (!p) {
      p = { ...newRaw(), userId: s.userId, name: s.userName ?? "Unknown", rates: new Set<number>() };
      groups.set(s.userId, p);
    }
    if (s.userName && p.name === "Unknown") p.name = s.userName;
    if (s.payRateSnapshot !== null) p.rates.add(s.payRateSnapshot);
    accumulate(p, s);
  }

  const rows = [...groups.values()].sort(
    (a, b) => b.cost - a.cost || a.name.localeCompare(b.name),
  );
  const total = totalRaw(shifts);
  const costs = allocateRounded(rows.map((r) => r.cost), roundMoney(total.cost));
  const hours = allocateRounded(rows.map((r) => r.hours), roundHours(total.hours));

  return rows.map((r, i) => ({
    userId: r.userId,
    name: r.name,
    hours: hours[i],
    shiftCount: r.shiftCount,
    cost: costs[i],
    // Effective rate from the snapshots, unrounded through the division.
    rate: r.hours > 0 ? roundMoney(r.cost / r.hours) : roundMoney([...r.rates][0] ?? 0),
    rateVaries: r.rates.size > 1,
  }));
}

/** Kitchen vs FOH vs Driver — cost and share of the total (M10 §3.4). */
export function costByRole(shifts: readonly ReportShift[]): RoleCost[] {
  return rankedBreakdown(shifts, (s) => s.roleId).map(({ key, bucket, rawCost, total }) => ({
    roleId: key,
    ...bucket,
    share: shareOf(rawCost, total),
  }));
}

/** Cost per location, for multi-location businesses (M10 §3.5). */
export function costByLocation(shifts: readonly ReportShift[]): LocationCost[] {
  return rankedBreakdown(shifts, (s) => s.locationId).map(({ key, bucket, rawCost, total }) => ({
    locationId: key,
    ...bucket,
    share: shareOf(rawCost, total),
  }));
}

interface RankedRow {
  key: string;
  bucket: CostBucket;
  rawCost: number;
  total: number;
}

/** Shared body of the by-role / by-location breakdowns: rank by cost, reconcile. */
function rankedBreakdown(
  shifts: readonly ReportShift[],
  key: (s: ReportShift) => string,
): RankedRow[] {
  const groups = groupBy(shifts, key);
  const entries = [...groups.entries()].sort(
    (a, b) => b[1].cost - a[1].cost || a[0].localeCompare(b[0]),
  );
  const total = totalRaw(shifts);
  const finished = finishBuckets(
    entries.map(([, raw]) => raw),
    total,
  );
  return entries.map(([k, raw], i) => ({
    key: k,
    bucket: finished[i],
    rawCost: raw.cost,
    total: total.cost,
  }));
}
