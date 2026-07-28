// Pure validation for Module 1 (Business Setup & Configuration) — M1 §6.
//
// Everything here is a pure function over plain data so it can be unit-tested
// without a browser or a database, and reused by both the ongoing Settings
// screens and (later) the first-run setup wizard. The Postgres constraints in
// supabase/migrations/0001_init.sql are the backstop; these functions exist so
// the manager gets a plain-language explanation *before* the write is attempted.
//
// Times are wall-clock "HH:MM" strings in the business timezone (no instant
// arithmetic, so nothing drifts across a DST boundary).

// Relative import (not the "@/" alias) so the pure domain layer resolves under
// vitest as well as Next — the other modules in src/lib/domain do the same.
import { LEVEL_LABEL, type Level } from "../types";

export type IssueSeverity = "error" | "warning";

export interface SettingsIssue {
  /** Stable identifier so tests and UI can target an issue without matching prose. */
  code: string;
  severity: IssueSeverity;
  /** Plain-language, user-facing. Australian English. */
  message: string;
  /** Optional hint for which control to highlight. */
  field?: string;
}

const error = (code: string, message: string, field?: string): SettingsIssue => ({
  code,
  severity: "error",
  message,
  field,
});

const warn = (code: string, message: string, field?: string): SettingsIssue => ({
  code,
  severity: "warning",
  message,
  field,
});

export function hasErrors(issues: SettingsIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

// ---------------------------------------------------------------------------
// Days of the week (0 = Sunday, matching Postgres `day_of_week` and JS getDay)
// ---------------------------------------------------------------------------

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function dayName(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek] ?? `Day ${dayOfWeek}`;
}

// ---------------------------------------------------------------------------
// Trading hours (M1 §3.3, §6)
// ---------------------------------------------------------------------------

export interface TradingHoursDay {
  dayOfWeek: number;
  isOpen: boolean;
  is24h: boolean;
  opensAt: string | null; // "HH:MM"
  closesAt: string | null; // "HH:MM"
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" (or "HH:MM:SS" as Postgres returns it) → minutes since midnight. */
export function toMinutes(time: string): number {
  const [h, m] = time.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

function isValidTime(time: string | null): time is string {
  return typeof time === "string" && TIME_RE.test(time.slice(0, 5));
}

/**
 * A trading window crosses midnight when it closes at or before it opens
 * (18:00 → 02:00). A 24-hour day is the degenerate case of that and is handled
 * by `is24h`, not by equal times. See M1 §3.3 "Overnight handling".
 */
export function isOvernightWindow(day: TradingHoursDay): boolean {
  if (!day.isOpen || day.is24h) return false;
  if (!isValidTime(day.opensAt) || !isValidTime(day.closesAt)) return false;
  return toMinutes(day.closesAt) < toMinutes(day.opensAt);
}

/** Length of the trading window in minutes, following it across midnight. */
export function tradingMinutes(day: TradingHoursDay): number {
  if (!day.isOpen) return 0;
  if (day.is24h) return 1440;
  if (!isValidTime(day.opensAt) || !isValidTime(day.closesAt)) return 0;
  const open = toMinutes(day.opensAt);
  const close = toMinutes(day.closesAt);
  return close > open ? close - open : 1440 - open + close;
}

export function validateTradingHoursDay(day: TradingHoursDay): SettingsIssue[] {
  const issues: SettingsIssue[] = [];
  const label = dayName(day.dayOfWeek);
  const field = `trading:${day.dayOfWeek}`;

  // A closed day carries no hours and no requirements.
  if (!day.isOpen) return issues;
  // A 24-hour day trades continuously; its times are ignored.
  if (day.is24h) return issues;

  if (!isValidTime(day.opensAt) || !isValidTime(day.closesAt)) {
    issues.push(
      error(
        "trading_times_missing",
        `${label} is marked open but has no opening and closing time. Set both, mark it closed, or switch on 24 hours.`,
        field,
      ),
    );
    return issues;
  }

  // M1 §6: closes_at == opens_at is only valid when is_24h is true.
  if (toMinutes(day.opensAt) === toMinutes(day.closesAt)) {
    issues.push(
      error(
        "trading_zero_length",
        `${label} opens and closes at ${day.opensAt}. If you trade around the clock, switch on 24 hours instead.`,
        field,
      ),
    );
  }

  return issues;
}

export function validateTradingHours(days: TradingHoursDay[]): SettingsIssue[] {
  const issues = days.flatMap(validateTradingHoursDay);

  if (days.length > 0 && days.every((d) => !d.isOpen)) {
    issues.push(
      warn(
        "trading_all_closed",
        "Every day is marked closed, so no rosters can be generated for this location.",
        "trading",
      ),
    );
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Locations (M1 §3.2, §6)
// ---------------------------------------------------------------------------

export interface LocationSummary {
  id: string;
  name: string;
  active: boolean;
}

export interface DeactivationCheck {
  /** false = block the write outright. */
  allowed: boolean;
  /** true = allowed, but ask the manager to confirm first. */
  requiresConfirmation: boolean;
  issues: SettingsIssue[];
}

/**
 * A business must always keep one active location, and deactivating a location
 * with future shifts needs a confirmation (history is never deleted — M1 §6).
 */
export function checkLocationDeactivation(
  locationId: string,
  locations: LocationSummary[],
  futureShiftCount = 0,
): DeactivationCheck {
  const issues: SettingsIssue[] = [];
  const target = locations.find((l) => l.id === locationId);

  if (!target) {
    return {
      allowed: false,
      requiresConfirmation: false,
      issues: [error("location_not_found", "That location no longer exists. Reload and try again.")],
    };
  }

  const otherActive = locations.filter((l) => l.id !== locationId && l.active);
  if (otherActive.length === 0) {
    issues.push(
      error(
        "location_last_active",
        `${target.name} is your only active location. Add another location before turning this one off.`,
        "location",
      ),
    );
    return { allowed: false, requiresConfirmation: false, issues };
  }

  if (futureShiftCount > 0) {
    issues.push(
      warn(
        "location_future_shifts",
        `${target.name} has ${futureShiftCount} upcoming ${
          futureShiftCount === 1 ? "shift" : "shifts"
        }. Turning it off keeps those rosters exactly as they are, but you won't be able to roster it again until you turn it back on.`,
        "location",
      ),
    );
    return { allowed: true, requiresConfirmation: true, issues };
  }

  return { allowed: true, requiresConfirmation: false, issues };
}

// ---------------------------------------------------------------------------
// Roles (M1 §3.4, §6)
// ---------------------------------------------------------------------------

export interface RoleUsage {
  /** Staff whose primary role is this role, or who are qualified for it. */
  staffCount: number;
  /** Week-template slots asking for this role. */
  templateSlotCount: number;
  /** Positions/shifts on real rosters using this role. */
  rosterCount: number;
}

export function totalRoleReferences(usage: RoleUsage): number {
  return usage.staffCount + usage.templateSlotCount + usage.rosterCount;
}

/**
 * A role referenced by staff, a template or any roster can never be hard
 * deleted — deleting it would rewrite history. Deactivate instead (M1 §6).
 */
export function checkRoleDeletion(roleName: string, usage: RoleUsage): DeactivationCheck {
  const parts: string[] = [];
  if (usage.staffCount > 0) {
    parts.push(`${usage.staffCount} ${usage.staffCount === 1 ? "person" : "people"}`);
  }
  if (usage.templateSlotCount > 0) {
    parts.push(
      `${usage.templateSlotCount} template ${usage.templateSlotCount === 1 ? "slot" : "slots"}`,
    );
  }
  if (usage.rosterCount > 0) {
    parts.push(`${usage.rosterCount} rostered ${usage.rosterCount === 1 ? "shift" : "shifts"}`);
  }

  if (parts.length === 0) {
    return { allowed: true, requiresConfirmation: true, issues: [] };
  }

  return {
    allowed: false,
    requiresConfirmation: false,
    issues: [
      error(
        "role_in_use",
        `${roleName} is used by ${listPhrase(parts)}, so it can't be deleted. Turn it off instead — past rosters stay exactly as they are and nobody new can be given the role.`,
        "role",
      ),
    ],
  };
}

function listPhrase(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Scheduling rules (M1 §3.6, §6)
// ---------------------------------------------------------------------------

export const SOFT_PRIORITIES = ["fairness", "cost", "preferences", "consistency"] as const;
export type SoftPriority = (typeof SOFT_PRIORITIES)[number];

export const SOFT_PRIORITY_LABEL: Record<SoftPriority, string> = {
  fairness: "Share the hours evenly",
  cost: "Keep the wage bill down",
  preferences: "Respect people's shift preferences",
  consistency: "Keep everyone's shifts similar week to week",
};

export function isSoftPriority(value: string): value is SoftPriority {
  return (SOFT_PRIORITIES as readonly string[]).includes(value);
}

export interface SchedulingRuleDraft {
  seniorCoverageEnabled: boolean;
  seniorMinCount: number;
  seniorQualifyingLevels: Level[];
  maxHoursCasual: number;
  maxHoursPartTime: number;
  maxHoursFullTime: number;
  maxConsecutiveDays: number;
  minRestHours: number;
  maxShiftHours: number;
  minShiftHours: number;
  oneShiftPerDay: boolean;
  allowOvernight: boolean;
  softPriorityOrder: SoftPriority[];
}

export interface SchedulingRuleContext {
  /** Active staff whose level satisfies `seniorQualifyingLevels`. */
  seniorQualifyingStaffCount: number;
}

export function countSeniorQualifyingStaff(
  staff: { level: Level; active: boolean }[],
  qualifyingLevels: Level[],
): number {
  return staff.filter((s) => s.active && qualifyingLevels.includes(s.level)).length;
}

function seniorNoun(levels: Level[], count: number): string {
  const plural = count !== 1;
  if (levels.length === 1) {
    const label = LEVEL_LABEL[levels[0]];
    return plural ? `${label}s` : label;
  }
  return plural ? "senior-qualifying staff members" : "senior-qualifying staff member";
}

export function validateSchedulingRules(
  draft: SchedulingRuleDraft,
  context: SchedulingRuleContext,
): SettingsIssue[] {
  const issues: SettingsIssue[] = [];

  // --- shift length ---
  if (!Number.isFinite(draft.minShiftHours) || draft.minShiftHours < 0) {
    issues.push(
      error("min_shift_invalid", "Shortest shift must be zero hours or more.", "minShiftHours"),
    );
  }
  if (!Number.isFinite(draft.maxShiftHours) || draft.maxShiftHours <= 0) {
    issues.push(
      error("max_shift_invalid", "Longest shift must be more than zero hours.", "maxShiftHours"),
    );
  }
  if (draft.minShiftHours > draft.maxShiftHours) {
    issues.push(
      error(
        "shift_length_order",
        `Shortest shift (${draft.minShiftHours}h) can't be longer than longest shift (${draft.maxShiftHours}h).`,
        "minShiftHours",
      ),
    );
  }
  if (draft.maxShiftHours > 24) {
    issues.push(
      error("max_shift_over_day", "Longest shift can't be more than 24 hours.", "maxShiftHours"),
    );
  }

  // --- consecutive days ---
  if (
    !Number.isInteger(draft.maxConsecutiveDays) ||
    draft.maxConsecutiveDays < 1 ||
    draft.maxConsecutiveDays > 7
  ) {
    issues.push(
      error(
        "consecutive_days_range",
        "Most days in a row must be between 1 and 7.",
        "maxConsecutiveDays",
      ),
    );
  } else if (draft.maxConsecutiveDays === 7) {
    issues.push(
      warn(
        "consecutive_days_seven",
        "Allowing 7 days in a row means someone can be rostered without a day off all week.",
        "maxConsecutiveDays",
      ),
    );
  }

  // --- rest between shifts ---
  if (!Number.isFinite(draft.minRestHours) || draft.minRestHours < 0) {
    issues.push(
      error("min_rest_invalid", "Rest between shifts can't be negative.", "minRestHours"),
    );
  } else if (draft.minRestHours + draft.maxShiftHours > 24) {
    issues.push(
      warn(
        "min_rest_tight",
        `${draft.minRestHours} hours' rest after a ${draft.maxShiftHours}-hour shift leaves less than a day, so back-to-back days may be hard to fill.`,
        "minRestHours",
      ),
    );
  }

  // --- weekly hour caps ---
  const caps: [string, number, string][] = [
    ["Casual", draft.maxHoursCasual, "maxHoursCasual"],
    ["Part-time", draft.maxHoursPartTime, "maxHoursPartTime"],
    ["Full-time", draft.maxHoursFullTime, "maxHoursFullTime"],
  ];
  for (const [label, value, field] of caps) {
    if (!Number.isFinite(value) || value <= 0) {
      issues.push(
        error("max_hours_invalid", `${label} weekly hours must be more than zero.`, field),
      );
    } else if (value > 168) {
      issues.push(
        error("max_hours_over_week", `${label} weekly hours can't exceed 168.`, field),
      );
    }
  }

  // --- senior coverage (the headline rule) ---
  if (draft.seniorCoverageEnabled) {
    if (draft.seniorQualifyingLevels.length === 0) {
      issues.push(
        error(
          "senior_levels_empty",
          "Senior coverage is on, but no level counts as senior. Choose at least one level.",
          "seniorQualifyingLevels",
        ),
      );
    }
    if (!Number.isInteger(draft.seniorMinCount) || draft.seniorMinCount < 1) {
      issues.push(
        error(
          "senior_count_invalid",
          "How many seniors must be present has to be at least 1.",
          "seniorMinCount",
        ),
      );
    } else if (context.seniorQualifyingStaffCount < draft.seniorMinCount) {
      const n = context.seniorQualifyingStaffCount;
      issues.push(
        warn(
          "senior_short_staffed",
          `You have ${n} ${seniorNoun(draft.seniorQualifyingLevels, n)} but require ${draft.seniorMinCount} present; rosters will fail to generate.`,
          "seniorMinCount",
        ),
      );
    }
  }

  // --- soft preference ranking ---
  const seen = new Set(draft.softPriorityOrder);
  if (
    seen.size !== draft.softPriorityOrder.length ||
    SOFT_PRIORITIES.some((p) => !seen.has(p))
  ) {
    issues.push(
      error(
        "soft_priority_incomplete",
        "Every preference must appear in the ranking exactly once.",
        "softPriorityOrder",
      ),
    );
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Break rules (M1 §3.7) — cost ESTIMATES only, never payroll (CLAUDE.md rule 5)
// ---------------------------------------------------------------------------

export interface BreakRuleTier {
  /** Present for saved tiers, absent for a new unsaved row. */
  id?: string;
  minHours: number;
  /** null = open-ended ("and above"). Only the last tier may be open-ended. */
  maxHours: number | null;
  breakMinutes: number;
}

function tierLabel(tier: BreakRuleTier): string {
  return tier.maxHours === null
    ? `${tier.minHours}h and over`
    : `${tier.minHours}–${tier.maxHours}h`;
}

/**
 * Tiers describe shift-length bands as [minHours, maxHours) so that a band
 * ending at 5h and the next starting at 5h do NOT overlap. They must be listed
 * shortest-first and must not overlap.
 */
export function validateBreakRules(tiers: BreakRuleTier[]): SettingsIssue[] {
  const issues: SettingsIssue[] = [];
  if (tiers.length === 0) {
    return [
      warn(
        "break_rules_empty",
        "No break rules set, so no unpaid break is suggested on any shift. Cost estimates will assume every rostered hour is paid.",
        "breaks",
      ),
    ];
  }

  tiers.forEach((tier, i) => {
    const field = `break:${i}`;
    if (!Number.isFinite(tier.minHours) || tier.minHours < 0) {
      issues.push(error("break_min_invalid", `Row ${i + 1}: "from" hours can't be negative.`, field));
    }
    if (tier.maxHours !== null && (!Number.isFinite(tier.maxHours) || tier.maxHours <= tier.minHours)) {
      issues.push(
        error(
          "break_range_invalid",
          `Row ${i + 1}: "to" hours must be more than "from" hours.`,
          field,
        ),
      );
    }
    if (!Number.isInteger(tier.breakMinutes) || tier.breakMinutes < 0) {
      issues.push(
        error("break_minutes_invalid", `Row ${i + 1}: break minutes must be zero or more.`, field),
      );
    }
    if (tier.maxHours !== null && tier.breakMinutes > tier.maxHours * 60) {
      issues.push(
        error(
          "break_longer_than_shift",
          `Row ${i + 1}: a ${tier.breakMinutes}-minute break is longer than the shift it applies to.`,
          field,
        ),
      );
    }
    if (tier.maxHours === null && i !== tiers.length - 1) {
      issues.push(
        error(
          "break_open_tier_not_last",
          `${tierLabel(tier)} is open-ended, so it must be the last row.`,
          field,
        ),
      );
    }
  });

  for (let i = 1; i < tiers.length; i += 1) {
    const prev = tiers[i - 1];
    const curr = tiers[i];
    if (curr.minHours < prev.minHours) {
      issues.push(
        error(
          "break_tiers_unordered",
          `Break rules must run shortest shift to longest — ${tierLabel(curr)} is listed after ${tierLabel(prev)}.`,
          `break:${i}`,
        ),
      );
      continue;
    }
    if (prev.maxHours === null || curr.minHours < prev.maxHours) {
      issues.push(
        error(
          "break_tiers_overlap",
          `${tierLabel(prev)} and ${tierLabel(curr)} overlap. Each shift length must match exactly one rule.`,
          `break:${i}`,
        ),
      );
      continue;
    }
    if (curr.minHours > prev.maxHours) {
      issues.push(
        warn(
          "break_tiers_gap",
          `Shifts between ${prev.maxHours}h and ${curr.minHours}h aren't covered by any rule, so they'll get no break.`,
          `break:${i}`,
        ),
      );
    }
  }

  if (tiers[0].minHours > 0) {
    issues.push(
      warn(
        "break_tiers_no_short",
        `Shifts under ${tiers[0].minHours}h aren't covered by any rule, so they'll get no break.`,
        "break:0",
      ),
    );
  }

  return issues;
}

/** The default tiers seeded for a new business (M1 §3.7). */
export const DEFAULT_BREAK_TIERS: BreakRuleTier[] = [
  { minHours: 0, maxHours: 5, breakMinutes: 0 },
  { minHours: 5, maxHours: 8, breakMinutes: 30 },
  { minHours: 8, maxHours: null, breakMinutes: 45 },
];

/** The defaults every rule starts at (M1 §3.6) — shared with the setup wizard. */
export const DEFAULT_SCHEDULING_RULES: SchedulingRuleDraft = {
  seniorCoverageEnabled: true,
  seniorMinCount: 1,
  seniorQualifyingLevels: ["senior"],
  maxHoursCasual: 38,
  maxHoursPartTime: 30,
  maxHoursFullTime: 38,
  maxConsecutiveDays: 6,
  minRestHours: 10,
  maxShiftHours: 12,
  minShiftHours: 3,
  oneShiftPerDay: true,
  allowOvernight: true,
  softPriorityOrder: ["fairness", "cost", "preferences", "consistency"],
};
