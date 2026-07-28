import { describe, expect, it } from "vitest";
import {
  buildSolveRequest,
  expandPositions,
  resolveMemberAvailability,
  totalPositionHours,
  type AvailabilityInput,
  type BuildSolveRequestInput,
  type MemberInput,
  type SlotInput,
  type SolverRuleInput,
  type TradingHoursInput,
} from "../../src/lib/domain/solver-request";

// 2026-08-03 is a Monday (the date used in docs/SOLVER_CONTRACT.md).
const START = "2026-08-03";
const TZ = "Australia/Sydney";
const LOC = "loc-1";

const RULE: SolverRuleInput = {
  maxHoursCasual: 38,
  maxHoursPartTime: 30,
  maxHoursFullTime: 38,
  seniorCoverageEnabled: true,
  seniorMinCount: 1,
  seniorQualifyingLevels: ["senior"],
  maxConsecutiveDays: 6,
  minRestHours: 10,
  maxShiftHours: 12,
  minShiftHours: 3,
  oneShiftPerDay: true,
};

function slot(over: Partial<SlotInput> = {}): SlotInput {
  return {
    id: "slot-a",
    locationId: LOC,
    dayOfWeek: 1, // Monday
    roleId: "kitchen",
    start: "16:00",
    end: "23:00",
    count: 1,
    requiredLevel: null,
    label: null,
    ...over,
  };
}

/** Open 10:00–22:30 every day at LOC unless overridden. */
function tradingAllWeek(over: Partial<TradingHoursInput> = {}): TradingHoursInput[] {
  return Array.from({ length: 7 }, (_, dow) => ({
    locationId: LOC,
    dayOfWeek: dow,
    isOpen: true,
    is24h: false,
    opensAt: "10:00",
    closesAt: "22:30",
    ...over,
  }));
}

function member(over: Partial<MemberInput> = {}): MemberInput {
  return {
    id: "u1",
    name: "Aisha",
    active: true,
    level: "senior",
    employmentType: "casual",
    roleIds: ["kitchen"],
    homeLocationId: LOC,
    canWorkOtherLocations: false,
    payRate: 32,
    maxHoursWeek: null,
    minHoursWeek: null,
    maxShiftsWeek: null,
    preferredDays: [],
    preferredTimeOfDay: null,
    ...over,
  };
}

const NO_AVAILABILITY: AvailabilityInput = { patterns: [], exceptions: [] };

function buildInput(over: Partial<BuildSolveRequestInput> = {}): BuildSolveRequestInput {
  return {
    rosterStart: START,
    days: 7,
    timezone: TZ,
    slots: [slot()],
    tradingHours: tradingAllWeek(),
    members: [member()],
    availability: NO_AVAILABILITY,
    rule: RULE,
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe("expandPositions — one position per person needed (contract §Request)", () => {
  it("expands a slot with count > 1 into that many distinct positions", () => {
    const positions = expandPositions({
      rosterStart: START,
      days: 7,
      timezone: TZ,
      slots: [slot({ count: 3 })],
      tradingHours: tradingAllWeek(),
    });

    expect(positions).toHaveLength(3); // one Monday in the week × 3 people
    expect(new Set(positions.map((p) => p.key)).size).toBe(3);
    expect(positions.map((p) => p.date)).toEqual([START, START, START]);
    expect(positions.every((p) => p.roleId === "kitchen")).toBe(true);
  });

  it("dates every occurrence of the weekday across a fortnight", () => {
    const positions = expandPositions({
      rosterStart: START,
      days: 14,
      timezone: TZ,
      slots: [slot()],
      tradingHours: tradingAllWeek(),
    });
    expect(positions.map((p) => p.date)).toEqual(["2026-08-03", "2026-08-10"]);
  });

  it("emits real dated instants with the business timezone offset", () => {
    const [p] = expandPositions({
      rosterStart: START,
      days: 1,
      timezone: TZ,
      slots: [slot()],
      tradingHours: tradingAllWeek(),
    });
    expect(p.start).toBe("2026-08-03T16:00:00+10:00");
    expect(p.end).toBe("2026-08-03T23:00:00+10:00");
    expect(p.startUtc).toBe("2026-08-03T06:00:00.000Z");
    expect(p.hours).toBe(7);
  });

  it("anchors an overnight slot to its START date and rolls only the end over", () => {
    const [p] = expandPositions({
      rosterStart: START,
      days: 1,
      timezone: TZ,
      slots: [slot({ start: "22:00", end: "02:00" })],
      tradingHours: tradingAllWeek({ is24h: true }),
    });
    expect(p.date).toBe(START); // the trading day, not the end date
    expect(p.start).toBe("2026-08-03T22:00:00+10:00");
    expect(p.end).toBe("2026-08-04T02:00:00+10:00");
    expect(p.hours).toBe(4);
  });

  it("measures an overnight position across a DST change in real elapsed time", () => {
    // Sydney leaves daylight saving at 03:00 on Sunday 2026-04-05 → the night of
    // Saturday 4 April is 9 real hours from 22:00 to 06:00, not 8.
    const [longer] = expandPositions({
      rosterStart: "2026-04-04",
      days: 1,
      timezone: TZ,
      slots: [slot({ dayOfWeek: 6, start: "22:00", end: "06:00" })],
      tradingHours: tradingAllWeek({ is24h: true }),
    });
    expect(longer.hours).toBe(9);
    expect(longer.start).toBe("2026-04-04T22:00:00+11:00");
    expect(longer.end).toBe("2026-04-05T06:00:00+10:00");

    // Daylight saving resumes at 02:00 on Sunday 2026-10-04 → that night is 7.
    const [shorter] = expandPositions({
      rosterStart: "2026-10-03",
      days: 1,
      timezone: TZ,
      slots: [slot({ dayOfWeek: 6, start: "22:00", end: "06:00" })],
      tradingHours: tradingAllWeek({ is24h: true }),
    });
    expect(shorter.hours).toBe(7);
  });

  it("produces NO positions on a day the location is closed", () => {
    const trading = tradingAllWeek();
    trading[1] = { ...trading[1], isOpen: false, opensAt: null, closesAt: null }; // Monday closed

    const positions = expandPositions({
      rosterStart: START,
      days: 7,
      timezone: TZ,
      slots: [slot({ count: 4 })],
      tradingHours: trading,
    });
    expect(positions).toEqual([]);
  });

  it("totals real hours across the period", () => {
    const positions = expandPositions({
      rosterStart: START,
      days: 14,
      timezone: TZ,
      slots: [slot({ count: 2 })],
      tradingHours: tradingAllWeek(),
    });
    expect(positions).toHaveLength(4);
    expect(totalPositionHours(positions)).toBe(28); // 4 × 7h
  });
});

describe("resolveMemberAvailability — pre-resolved via the shared M3 resolver", () => {
  const dates = ["2026-08-03", "2026-08-04"];

  it("defaults an unrecorded person to the whole open window", () => {
    const windows = resolveMemberAvailability({
      member: member(),
      dates,
      availability: NO_AVAILABILITY,
      tradingHours: tradingAllWeek(),
    });
    expect(windows).toEqual([
      { date: "2026-08-03", from: "10:00", to: "22:30" },
      { date: "2026-08-04", from: "10:00", to: "22:30" },
    ]);
  });

  it("intersects a weekly pattern with trading hours", () => {
    const windows = resolveMemberAvailability({
      member: member(),
      dates,
      availability: {
        patterns: [
          { userId: "u1", dayOfWeek: 1, isAvailable: true, from: "08:00", to: "14:00" },
          { userId: "u1", dayOfWeek: 2, isAvailable: false, from: null, to: null },
        ],
        exceptions: [],
      },
      tradingHours: tradingAllWeek(),
    });
    // Monday clamped to the intersection; Tuesday unavailable ⇒ no window at all.
    expect(windows).toEqual([{ date: "2026-08-03", from: "10:00", to: "14:00" }]);
    expect(windows.find((w) => w.date === "2026-08-04")).toBeUndefined();
  });

  it("lets a dated exception override the pattern", () => {
    const windows = resolveMemberAvailability({
      member: member(),
      dates,
      availability: {
        patterns: [
          { userId: "u1", dayOfWeek: 1, isAvailable: true, from: "10:00", to: "22:30" },
        ],
        exceptions: [
          { userId: "u1", date: "2026-08-03", isAvailable: false, from: null, to: null },
        ],
      },
      tradingHours: tradingAllWeek(),
    });
    expect(windows.some((w) => w.date === "2026-08-03")).toBe(false);
  });

  it("returns nothing on a closed day", () => {
    const trading = tradingAllWeek();
    trading[1] = { ...trading[1], isOpen: false, opensAt: null, closesAt: null };
    const windows = resolveMemberAvailability({
      member: member(),
      dates: ["2026-08-03"],
      availability: NO_AVAILABILITY,
      tradingHours: trading,
    });
    expect(windows).toEqual([]);
  });
});

describe("buildSolveRequest — the exact wire contract", () => {
  it("builds every top-level field the contract defines, and no others", () => {
    const request = buildSolveRequest(buildInput());
    expect(Object.keys(request).sort()).toEqual(
      [
        "excluded",
        "locked",
        "objective_priority",
        "people",
        "positions",
        "previous_roster",
        "roster",
        "rules",
        "seed",
        "time_limit_seconds",
      ].sort(),
    );
    expect(request.roster).toEqual({ start_date: START, days: 7, timezone: TZ });
  });

  it("emits positions in the contract's snake_case shape", () => {
    const request = buildSolveRequest(buildInput({ slots: [slot({ requiredLevel: "senior" })] }));
    expect(request.positions[0]).toEqual({
      id: "slot-a:2026-08-03:0",
      date: "2026-08-03",
      location_id: LOC,
      role_id: "kitchen",
      start: "2026-08-03T16:00:00+10:00",
      end: "2026-08-03T23:00:00+10:00",
      required_level: "senior",
    });
  });

  it("substitutes persisted roster_position ids when the roster has been seeded", () => {
    const request = buildSolveRequest(
      buildInput({ positionIdByKey: { "slot-a:2026-08-03:0": "row-uuid-1" } }),
    );
    expect(request.positions[0].id).toBe("row-uuid-1");
  });

  it("resolves each person's hour ceiling and pre-resolves their availability", () => {
    const request = buildSolveRequest(
      buildInput({
        days: 1,
        members: [
          member({ employmentType: "part_time", maxHoursWeek: null, minHoursWeek: 12 }),
        ],
      }),
    );
    const person = request.people[0];
    expect(person.max_hours_week).toBe(30); // part-time default from the rule
    expect(person.min_hours_week).toBe(12);
    expect(person.max_shifts_week).toBeNull();
    expect(person.preferred_time).toBe("no_preference");
    expect(person.availability).toEqual([
      { date: "2026-08-03", from: "10:00", to: "22:30" },
    ]);
  });

  it("never offers a deactivated person to the solver (H13)", () => {
    const request = buildSolveRequest(
      buildInput({ members: [member(), member({ id: "u2", active: false })] }),
    );
    expect(request.people.map((p) => p.id)).toEqual(["u1"]);
  });

  it("sends an empty availability list for someone who cannot work at all", () => {
    const request = buildSolveRequest(
      buildInput({
        days: 7,
        availability: {
          patterns: Array.from({ length: 7 }, (_, dow) => ({
            userId: "u1",
            dayOfWeek: dow,
            isAvailable: false,
            from: null,
            to: null,
          })),
          exceptions: [],
        },
      }),
    );
    expect(request.people[0].availability).toEqual([]);
  });

  it("derives senior-coverage open hours from trading hours, deduplicated", () => {
    const request = buildSolveRequest(buildInput({ days: 7 }));
    const coverage = request.rules.senior_coverage;
    expect(coverage.enabled).toBe(true);
    expect(coverage.min_count).toBe(1);
    expect(coverage.qualifying_levels).toEqual(["senior"]);
    // Senior coverage is a timeline over OPEN hours, so every open day counts —
    // one window per date, deduplicated across locations.
    expect(coverage.open_hours).toHaveLength(7);
    expect(coverage.open_hours[0]).toEqual({ date: "2026-08-03", from: "10:00", to: "22:30" });
    expect(coverage.open_hours[6]).toEqual({ date: "2026-08-09", from: "10:00", to: "22:30" });
  });

  it("skips closed days and 24-hour days are a full window", () => {
    const trading = tradingAllWeek();
    trading[2] = { ...trading[2], isOpen: false, opensAt: null, closesAt: null }; // Tue closed
    trading[3] = { ...trading[3], is24h: true }; // Wed open all day
    const request = buildSolveRequest(buildInput({ days: 7, tradingHours: trading }));
    const hours = request.rules.senior_coverage.open_hours;
    expect(hours.some((w) => w.date === "2026-08-04")).toBe(false);
    expect(hours.find((w) => w.date === "2026-08-05")).toEqual({
      date: "2026-08-05",
      from: "00:00",
      to: "24:00",
    });
  });

  it("omits open hours entirely when senior coverage is off", () => {
    const request = buildSolveRequest(
      buildInput({ rule: { ...RULE, seniorCoverageEnabled: false } }),
    );
    expect(request.rules.senior_coverage.open_hours).toEqual([]);
  });

  it("passes the hard rules through unchanged", () => {
    const request = buildSolveRequest(buildInput());
    expect(request.rules.max_consecutive_days).toBe(6);
    expect(request.rules.min_rest_hours).toBe(10);
    expect(request.rules.max_shift_hours).toBe(12);
    expect(request.rules.min_shift_hours).toBe(3);
    expect(request.rules.one_shift_per_day).toBe(true);
  });

  it("defaults the seed and time limit, and clamps the limit to the 30s ceiling", () => {
    expect(buildSolveRequest(buildInput()).seed).toBe(42);
    expect(buildSolveRequest(buildInput()).time_limit_seconds).toBe(15);
    expect(buildSolveRequest(buildInput({ timeLimitSeconds: 300 })).time_limit_seconds).toBe(30);
    expect(buildSolveRequest(buildInput({ seed: 7 })).seed).toBe(7);
  });

  it("carries locked and excluded pairs verbatim (H11/H12)", () => {
    const locked = [{ position_id: "p7", user_id: "u3" }];
    const excluded = [{ position_id: "p9", user_id: "u5" }];
    const request = buildSolveRequest(buildInput({ locked, excluded }));
    expect(request.locked).toEqual(locked);
    expect(request.excluded).toEqual(excluded);
  });

  it("prefers the business's own priority ranking over the default", () => {
    expect(buildSolveRequest(buildInput()).objective_priority).toEqual([
      "fairness",
      "cost",
      "preferences",
      "consistency",
    ]);
    expect(
      buildSolveRequest(buildInput({ rule: { ...RULE, softPriorityOrder: ["cost", "fairness"] } }))
        .objective_priority,
    ).toEqual(["cost", "fairness"]);
  });

  it("is deterministic — the same input builds a byte-identical request", () => {
    expect(JSON.stringify(buildSolveRequest(buildInput()))).toBe(
      JSON.stringify(buildSolveRequest(buildInput())),
    );
  });
});
