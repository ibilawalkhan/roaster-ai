// The pre-flight check (M5 §2 step 4): what would stop this roster generating,
// reported in plain words BEFORE the solver runs.
//
// Why it exists: a solver that returns a mostly-empty roster looks broken. A
// pre-flight that says "nobody can work Kitchen" is the same information, given
// early, in language the manager can act on.
//
// Blocker vs warning is a deliberate line:
//   blocker — generating cannot produce anything sensible (no demand, no staff,
//             a role literally nobody holds). Generation is refused.
//   warning — the roster will generate but come back short. Demand is SOFT
//             (M5 §5.2), so a short week is a legitimate, explainable result.
//
// Pure: plain data in, typed issues out. Supply/limit maths is reused from
// template-feasibility.ts rather than re-derived here.

import {
  seniorSupplyVsDemand,
  teamCapacityHours,
  type MemberLike,
  type TradingDay,
} from "./template-feasibility";
import { dayOfWeekISO } from "./timezone";
import type {
  AvailabilityInput,
  ExpandedPosition,
  MemberInput,
  SolverRuleInput,
  TradingHoursInput,
} from "./solver-request";

export type PreflightSeverity = "blocker" | "warning";

export type PreflightCode =
  | "empty_template"
  | "no_active_staff"
  | "role_no_eligible_staff"
  | "role_shortfall"
  | "no_availability_recorded"
  | "no_senior_staff"
  | "senior_shortfall"
  | "capacity_shortfall";

export interface PreflightIssue {
  code: PreflightCode;
  severity: PreflightSeverity;
  /** One plain-language sentence, ready to render. Australian English. */
  message: string;
  /** Optional second sentence: what to do about it. */
  detail?: string;
  roleId?: string;
  userIds?: string[];
}

export interface PreflightResult {
  blockers: PreflightIssue[];
  warnings: PreflightIssue[];
  /** True when nothing blocks generation. Warnings never block. */
  canGenerate: boolean;
}

export interface PreflightRole {
  id: string;
  name: string;
}

export interface PreflightInput {
  /** The seeded positions for the period (from expandPositions). */
  positions: ExpandedPosition[];
  members: MemberInput[];
  roles: PreflightRole[];
  availability: AvailabilityInput;
  tradingHours: TradingHoursInput[];
  rule: SolverRuleInput;
  rosterStart: string;
  days: number;
}

const HOURS_TOLERANCE = 0.01; // ignore floating-point dust when comparing hours

function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

function toMemberLike(m: MemberInput): MemberLike {
  return {
    active: m.active,
    level: m.level,
    employmentType: m.employmentType,
    maxHoursWeek: m.maxHoursWeek,
    roleIds: m.roleIds,
  };
}

function nameList(names: string[], max = 3): string {
  if (names.length <= max) {
    return names.length <= 1
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, max).join(", ")} and ${names.length - max} others`;
}

/** Trading rows for each date of the roster, at the locations that have demand. */
function tradingDaysForPeriod(
  positions: ExpandedPosition[],
  tradingHours: TradingHoursInput[],
  dates: string[],
): TradingDay[] {
  const locations = new Set(positions.map((p) => p.locationId));
  const out: TradingDay[] = [];
  for (const date of dates) {
    const dow = dayOfWeekISO(date);
    for (const row of tradingHours) {
      if (!locations.has(row.locationId) || row.dayOfWeek !== dow) continue;
      out.push({
        isOpen: row.isOpen,
        is24h: row.is24h,
        opensAt: row.opensAt,
        closesAt: row.closesAt,
      });
    }
  }
  return out;
}

/**
 * Run every pre-flight check. Order of the returned issues is stable, so the
 * panel never reshuffles between renders.
 */
export function runPreflight(input: PreflightInput): PreflightResult {
  const { positions, members, roles, availability, tradingHours, rule, days } = input;
  const blockers: PreflightIssue[] = [];
  const warnings: PreflightIssue[] = [];

  const roleName = (id: string): string =>
    roles.find((r) => r.id === id)?.name ?? "that role";

  // ---- 1. Empty template (M5 §10 — never produce a silently empty roster) ----
  if (positions.length === 0) {
    blockers.push({
      code: "empty_template",
      severity: "blocker",
      message: "There is nothing to roster for this period.",
      detail:
        "Your week template has no shift requirements on these days — add them on the Template screen, then create the roster again.",
    });
  }

  // ---- 2. No active staff ----
  const active = members.filter((m) => m.active);
  if (active.length === 0) {
    blockers.push({
      code: "no_active_staff",
      severity: "blocker",
      message: "You have no active team members to roster.",
      detail: "Add or reactivate staff on the Team screen.",
    });
  }

  // ---- 3. Roles with no eligible staff (blocker) / not enough on a day (warning) ----
  const neededRoles = Array.from(new Set(positions.map((p) => p.roleId))).sort();
  const perRoleDate = new Map<string, number>();
  for (const p of positions) {
    const key = `${p.roleId}|${p.date}`;
    perRoleDate.set(key, (perRoleDate.get(key) ?? 0) + 1);
  }

  for (const roleId of neededRoles) {
    const eligible = active.filter((m) => m.roleIds.includes(roleId));
    if (eligible.length === 0) {
      blockers.push({
        code: "role_no_eligible_staff",
        severity: "blocker",
        roleId,
        message: `Nobody on your team can work ${roleName(roleId)}.`,
        detail: `This period needs ${roleName(roleId)} shifts. Give someone that role on the Team screen, or remove the requirement from the template.`,
      });
      continue;
    }
    // Concurrency check is per DATE (not per weekday) because a fortnight has
    // two of each weekday — template-feasibility's weekday version would merge
    // them and overstate the shortfall.
    let worstDate = "";
    let worstNeeded = 0;
    for (const [key, needed] of perRoleDate) {
      const [rid, date] = key.split("|");
      if (rid !== roleId) continue;
      if (needed > worstNeeded || (needed === worstNeeded && date < worstDate)) {
        worstNeeded = needed;
        worstDate = date;
      }
    }
    if (worstNeeded > eligible.length) {
      warnings.push({
        code: "role_shortfall",
        severity: "warning",
        roleId,
        message: `${roleName(roleId)} needs ${worstNeeded} people on ${worstDate}, but only ${eligible.length} ${eligible.length === 1 ? "person can" : "people can"} work it.`,
        detail: "Those shifts will come back unfilled unless someone else takes the role on.",
      });
    }
  }

  // ---- 4. People with no availability recorded ----
  // They default to "available whenever we're open" (M3), so this is a warning,
  // not a blocker — but it is the single most common cause of a surprising roster.
  const withPattern = new Set(availability.patterns.map((p) => p.userId));
  const withException = new Set(availability.exceptions.map((e) => e.userId));
  const noAvailability = active.filter(
    (m) => !withPattern.has(m.id) && !withException.has(m.id),
  );
  if (noAvailability.length > 0) {
    warnings.push({
      code: "no_availability_recorded",
      severity: "warning",
      userIds: noAvailability.map((m) => m.id),
      message: `${nameList(noAvailability.map((m) => m.name))} ${noAvailability.length === 1 ? "has" : "have"} no availability recorded.`,
      detail:
        "They will be treated as available any time you're open, which may put them on shifts they can't work. Set their availability on the Availability screen.",
    });
  }

  // ---- 5. Senior coverage ----
  if (rule.seniorCoverageEnabled) {
    const qualifying = active.filter((m) => rule.seniorQualifyingLevels.includes(m.level));
    if (qualifying.length === 0) {
      blockers.push({
        code: "no_senior_staff",
        severity: "blocker",
        message: "Senior coverage is required, but nobody on your team qualifies as senior.",
        detail:
          "Raise someone's level on the Team screen, or turn senior coverage off in Settings.",
      });
    } else {
      const dates = Array.from(new Set(positions.map((p) => p.date))).sort();
      const sd = seniorSupplyVsDemand(
        tradingDaysForPeriod(positions, tradingHours, dates),
        active.map(toMemberLike),
        rule,
      );
      if (sd) {
        // seniorSupplyVsDemand returns a WEEKLY supply; scale it to the period.
        const supply = sd.supplyHours * (days / 7);
        const shortfall = sd.demandHours - supply;
        if (shortfall > HOURS_TOLERANCE) {
          warnings.push({
            code: "senior_shortfall",
            severity: "warning",
            message: `Senior coverage needs ${roundHalf(sd.demandHours)} hours of senior presence this period; your seniors can work ${roundHalf(supply)}.`,
            detail: `That leaves about ${roundHalf(shortfall)} hours with no senior on. The roster will still generate and will name each uncovered window.`,
          });
        }
      }
    }
  }

  // ---- 6. Demand vs total capacity ----
  if (positions.length > 0 && active.length > 0) {
    const demand = positions.reduce((sum, p) => sum + p.hours, 0);
    const capacity = teamCapacityHours(active.map(toMemberLike), rule) * (days / 7);
    if (demand - capacity > HOURS_TOLERANCE) {
      warnings.push({
        code: "capacity_shortfall",
        severity: "warning",
        message: `This period needs ${roundHalf(demand)} hours, but your team's weekly limits only allow ${roundHalf(capacity)}.`,
        detail: `About ${roundHalf(demand - capacity)} hours can't be covered. Expect unfilled shifts, each with the reason stated.`,
      });
    }
  }

  return { blockers, warnings, canGenerate: blockers.length === 0 };
}
