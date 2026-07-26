// Pure feasibility checks for the week template (M4 §5.2–5.3). These catch
// impossible staffing shapes at DESIGN time — before the auto-scheduler (M5)
// struggles and the manager assumes the software is broken.
//
// Everything here is a pure function of plain data (no DB, no React), unit-
// tested in tests/domain/template-feasibility.test.ts. The template page adapts
// Supabase rows into these shapes.
//
// Coverage is reasoned about on a CYCLIC 24-hour day: an overnight slot (or
// overnight trading) wraps past midnight and covers the early hours of the same
// representative day, so the midnight boundary of a chained 24-hour operation is
// never a false gap (M4 §7).

import { paidHours } from "./cost";
import type { EmploymentType, Level } from "../types";

const MINUTES_PER_DAY = 1440;

export interface TimeWindow {
  from: string; // "HH:MM"
  to: string; // "HH:MM" ("24:00" = end of day)
}

/** A staffing requirement (one row of template_slot), reduced to what checks need. */
export interface SlotLike {
  dayOfWeek: number; // 0=Sun..6=Sat
  roleId: string;
  start: string; // "HH:MM"
  end: string; // "HH:MM" (≤ start ⇒ crosses midnight)
  count: number;
  requiredLevel: Level | null;
}

/** A location's trading hours for one day (M1). */
export interface TradingDay {
  isOpen: boolean;
  is24h: boolean;
  opensAt: string | null; // "HH:MM"
  closesAt: string | null; // "HH:MM"
}

/** A team member, reduced to what supply checks need. */
export interface MemberLike {
  active: boolean;
  level: Level;
  employmentType: EmploymentType;
  maxHoursWeek: number | null;
  roleIds: string[];
}

/** The business scheduling rule (M1 §3.6), reduced to what checks need. */
export interface SchedulingRuleLike {
  maxHoursCasual: number;
  maxHoursPartTime: number;
  maxHoursFullTime: number;
  seniorCoverageEnabled: boolean;
  seniorMinCount: number;
  seniorQualifyingLevels: Level[];
}

// ---------- minute helpers ----------

function toMin(t: string): number {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

function fromMin(mins: number): string {
  if (mins >= MINUTES_PER_DAY) return "24:00";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Mark [from,to) on a cyclic minute mask, wrapping past midnight when to ≤ from. */
function paint(mask: number[], from: number, to: number, weight = 1): void {
  if (to === from) {
    // A zero-length or full-day span: a slot with equal start/end means 24h.
    for (let i = 0; i < MINUTES_PER_DAY; i++) mask[i] += weight;
    return;
  }
  if (to > from) {
    for (let i = from; i < to; i++) mask[i] += weight;
  } else {
    for (let i = from; i < MINUTES_PER_DAY; i++) mask[i] += weight;
    for (let i = 0; i < to; i++) mask[i] += weight;
  }
}

/** Minutes the location is open, as a boolean cyclic mask. */
function tradingMask(trading: TradingDay | null | undefined): number[] {
  const mask = new Array<number>(MINUTES_PER_DAY).fill(0);
  if (!trading || !trading.isOpen) return mask;
  if (trading.is24h) {
    mask.fill(1);
    return mask;
  }
  if (!trading.opensAt || !trading.closesAt) return mask;
  paint(mask, toMin(trading.opensAt), toMin(trading.closesAt));
  return mask;
}

/** Positions rostered per minute, as a cyclic count mask (respecting slot count). */
function coverageMask(slots: SlotLike[]): number[] {
  const mask = new Array<number>(MINUTES_PER_DAY).fill(0);
  for (const s of slots) paint(mask, toMin(s.start), toMin(s.end), Math.max(1, s.count));
  return mask;
}

/**
 * Windows within the open mask where cover is below `need`, as display windows.
 * Merges a run ending at midnight with one starting at midnight into a single
 * cross-midnight window.
 */
function uncoveredWindows(open: number[], cover: number[], need: number): TimeWindow[] {
  const runs: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < MINUTES_PER_DAY; i++) {
    const bad = open[i] > 0 && cover[i] < need;
    if (bad && start === -1) start = i;
    if (!bad && start !== -1) {
      runs.push([start, i]);
      start = -1;
    }
  }
  if (start !== -1) runs.push([start, MINUTES_PER_DAY]);

  // Merge a wrap-around gap (…→24:00 and 00:00→…) into one window.
  if (
    runs.length >= 2 &&
    runs[0][0] === 0 &&
    runs[runs.length - 1][1] === MINUTES_PER_DAY
  ) {
    const first = runs.shift()!;
    const last = runs.pop()!;
    runs.push([last[0], first[1]]); // e.g. 22:00 → 06:00
  }

  return runs.map(([a, b]) => ({ from: fromMin(a), to: fromMin(b) }));
}

/** Open trading hours for a day, in hours (0 when closed). */
export function openHours(trading: TradingDay | null | undefined): number {
  return tradingMask(trading).reduce((n, v) => n + (v > 0 ? 1 : 0), 0) / 60;
}

/**
 * True when a slot [start,end) lies entirely within the day's open hours (M4
 * §5.1). Reasoned on the cyclic mask, so a post-midnight slot on an overnight
 * trading day (e.g. 00:30–01:30 on an 18:00→02:00 day) is correctly accepted.
 * A 24-hour day accepts any slot; a closed day accepts none. This is the single
 * source of truth for slot-in-hours validation — the template modal calls it,
 * so the pre-save check can never disagree with the coverage feasibility masks.
 */
export function slotWithinTradingHours(
  start: string,
  end: string,
  trading: TradingDay | null | undefined,
): boolean {
  const open = tradingMask(trading);
  if (open.every((v) => v === 0)) return false;
  const slot = new Array<number>(MINUTES_PER_DAY).fill(0);
  paint(slot, toMin(start), toMin(end));
  for (let i = 0; i < MINUTES_PER_DAY; i++) {
    if (slot[i] > 0 && open[i] === 0) return false;
  }
  return true;
}

// ---------- max-hours resolution (M4: per-person else the rule default) ----------

/** A member's weekly hour ceiling: their own limit, else the employment-type default. */
export function resolveMaxHours(member: MemberLike, rule: SchedulingRuleLike): number {
  if (member.maxHoursWeek != null) return member.maxHoursWeek;
  switch (member.employmentType) {
    case "casual":
      return rule.maxHoursCasual;
    case "part_time":
      return rule.maxHoursPartTime;
    case "full_time":
      return rule.maxHoursFullTime;
  }
}

// ---------- §5.2 open-hours coverage gaps ----------

/** Open-hours windows that NO slot covers (M4 §5.2). Cyclic, so midnight is not a gap. */
export function coverageGaps(slots: SlotLike[], trading: TradingDay | null | undefined): TimeWindow[] {
  const open = tradingMask(trading);
  if (open.every((v) => v === 0)) return [];
  return uncoveredWindows(open, coverageMask(slots), 1);
}

// ---------- §5.2 senior-coverage feasibility ----------

/**
 * Open-hours windows where the slots cannot produce the required number of
 * concurrent seniors (M4 §3, §5.2). Any slot can hold a senior, so a window is
 * infeasible when the positions overlapping it are below `seniorMinCount`.
 * Returns [] when the senior rule is off.
 */
export function seniorCoverageGaps(
  slots: SlotLike[],
  trading: TradingDay | null | undefined,
  rule: SchedulingRuleLike,
): TimeWindow[] {
  if (!rule.seniorCoverageEnabled) return [];
  const open = tradingMask(trading);
  if (open.every((v) => v === 0)) return [];
  return uncoveredWindows(open, coverageMask(slots), Math.max(1, rule.seniorMinCount));
}

// ---------- §5.3 supply vs demand ----------

/** Weekly hours demanded by the template (span × count, all slots). */
export function demandHours(slots: SlotLike[]): number {
  return slots.reduce(
    (sum, s) => sum + paidHours({ start: s.start, end: s.end }) * Math.max(1, s.count),
    0,
  );
}

/** Total weekly hours the team can supply (sum of resolved max-hours, active only). */
export function teamCapacityHours(members: MemberLike[], rule: SchedulingRuleLike): number {
  return members
    .filter((m) => m.active)
    .reduce((sum, m) => sum + resolveMaxHours(m, rule), 0);
}

export interface SupplyDemand {
  demandHours: number;
  capacityHours: number;
  /** Positive ⇒ the template needs more hours than the team can work. */
  shortfallHours: number;
}

/** Total-hours supply-vs-demand across the whole week (M4 §5.3). */
export function supplyVsDemand(
  slots: SlotLike[],
  members: MemberLike[],
  rule: SchedulingRuleLike,
): SupplyDemand {
  const demand = demandHours(slots);
  const capacity = teamCapacityHours(members, rule);
  return { demandHours: demand, capacityHours: capacity, shortfallHours: demand - capacity };
}

const DOW_LABEL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface RoleShortfall {
  roleId: string;
  dayOfWeek: number;
  dayLabel: string;
  needed: number; // positions required that day
  available: number; // people who can work the role
}

/**
 * Per-role shortfalls (M4 §5.3): the busiest day for a role needs more positions
 * than there are people who can work it. Reports the worst day per role.
 */
export function perRoleShortfalls(slots: SlotLike[], members: MemberLike[]): RoleShortfall[] {
  const active = members.filter((m) => m.active);
  const byRoleDay = new Map<string, number>();
  const roleIds = new Set<string>();
  for (const s of slots) {
    roleIds.add(s.roleId);
    const key = `${s.roleId}:${s.dayOfWeek}`;
    byRoleDay.set(key, (byRoleDay.get(key) ?? 0) + Math.max(1, s.count));
  }

  const out: RoleShortfall[] = [];
  for (const roleId of roleIds) {
    const available = active.filter((m) => m.roleIds.includes(roleId)).length;
    let worst: RoleShortfall | null = null;
    for (let dow = 0; dow < 7; dow++) {
      const needed = byRoleDay.get(`${roleId}:${dow}`) ?? 0;
      if (needed > available && (!worst || needed - available > worst.needed - worst.available)) {
        worst = { roleId, dayOfWeek: dow, dayLabel: DOW_LABEL[dow], needed, available };
      }
    }
    if (worst) out.push(worst);
  }
  return out;
}

export interface SeniorSupplyDemand {
  demandHours: number; // senior-hours the coverage rule requires this week
  supplyHours: number; // hours senior-qualifying staff can work
  shortfallHours: number;
}

/**
 * Senior availability vs demand (M4 §5.3). Senior coverage is required across
 * ALL open hours, so demand = Σ(open hours per day) × seniorMinCount. Supply =
 * Σ max-hours of senior-qualifying staff. Returns null when the rule is off.
 */
export function seniorSupplyVsDemand(
  tradingByDay: (TradingDay | null | undefined)[],
  members: MemberLike[],
  rule: SchedulingRuleLike,
): SeniorSupplyDemand | null {
  if (!rule.seniorCoverageEnabled) return null;
  const need = Math.max(1, rule.seniorMinCount);
  const demand = tradingByDay.reduce((sum, t) => sum + openHours(t), 0) * need;
  const supply = members
    .filter((m) => m.active && rule.seniorQualifyingLevels.includes(m.level))
    .reduce((sum, m) => sum + resolveMaxHours(m, rule), 0);
  return { demandHours: demand, supplyHours: supply, shortfallHours: demand - supply };
}
