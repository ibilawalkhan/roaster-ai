import { describe, expect, it } from "vitest";
import { runPreflight, type PreflightInput } from "../../src/lib/domain/preflight";
import {
  expandPositions,
  type AvailabilityInput,
  type MemberInput,
  type SlotInput,
  type SolverRuleInput,
  type TradingHoursInput,
} from "../../src/lib/domain/solver-request";

const START = "2026-08-03"; // Monday
const TZ = "Australia/Sydney";
const LOC = "loc-1";

const RULE: SolverRuleInput = {
  maxHoursCasual: 38,
  maxHoursPartTime: 30,
  maxHoursFullTime: 38,
  seniorCoverageEnabled: false,
  seniorMinCount: 1,
  seniorQualifyingLevels: ["senior"],
  maxConsecutiveDays: 6,
  minRestHours: 10,
  maxShiftHours: 12,
  minShiftHours: 3,
  oneShiftPerDay: true,
};

const ROLES = [
  { id: "kitchen", name: "Kitchen" },
  { id: "foh", name: "Front of house" },
];

function trading(over: Partial<TradingHoursInput> = {}): TradingHoursInput[] {
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

function slot(over: Partial<SlotInput> = {}): SlotInput {
  return {
    id: "slot-a",
    locationId: LOC,
    dayOfWeek: 1,
    roleId: "kitchen",
    start: "16:00",
    end: "23:00",
    count: 1,
    requiredLevel: null,
    label: null,
    ...over,
  };
}

function member(over: Partial<MemberInput> = {}): MemberInput {
  return {
    id: "u1",
    name: "Aisha",
    active: true,
    level: "mid",
    employmentType: "casual",
    roleIds: ["kitchen"],
    homeLocationId: LOC,
    canWorkOtherLocations: false,
    payRate: 30,
    maxHoursWeek: null,
    minHoursWeek: null,
    maxShiftsWeek: null,
    preferredDays: [],
    preferredTimeOfDay: null,
    ...over,
  };
}

const NO_AVAILABILITY: AvailabilityInput = { patterns: [], exceptions: [] };

const RECORDED: AvailabilityInput = {
  patterns: [{ userId: "u1", dayOfWeek: 1, isAvailable: true, from: "10:00", to: "23:00" }],
  exceptions: [],
};

function input(over: Partial<PreflightInput> = {}): PreflightInput {
  const days = over.days ?? 7;
  const slots = "positions" in over ? [] : [slot()];
  return {
    positions: expandPositions({
      rosterStart: START,
      days,
      timezone: TZ,
      slots,
      tradingHours: trading(),
    }),
    members: [member()],
    roles: ROLES,
    availability: RECORDED,
    tradingHours: trading(),
    rule: RULE,
    rosterStart: START,
    days,
    ...over,
  };
}

const codes = (issues: { code: string }[]): string[] => issues.map((i) => i.code);

// ---------------------------------------------------------------------------

describe("runPreflight — blockers (generation is refused)", () => {
  it("blocks an empty template rather than producing a silently empty roster", () => {
    const result = runPreflight(input({ positions: [] }));
    expect(result.canGenerate).toBe(false);
    expect(codes(result.blockers)).toContain("empty_template");
    expect(result.blockers[0].detail).toMatch(/Template screen/i);
  });

  it("blocks when there are no active team members", () => {
    const result = runPreflight(input({ members: [member({ active: false })] }));
    expect(result.canGenerate).toBe(false);
    expect(codes(result.blockers)).toContain("no_active_staff");
  });

  it("blocks a role nobody on the team holds, naming the role", () => {
    const result = runPreflight(
      input({ members: [member({ roleIds: ["foh"] })] }),
    );
    expect(result.canGenerate).toBe(false);
    const issue = result.blockers.find((b) => b.code === "role_no_eligible_staff");
    expect(issue?.roleId).toBe("kitchen");
    expect(issue?.message).toBe("Nobody on your team can work Kitchen.");
  });

  it("blocks senior coverage with no senior-qualifying staff", () => {
    const result = runPreflight(
      input({ rule: { ...RULE, seniorCoverageEnabled: true } }),
    );
    expect(result.canGenerate).toBe(false);
    expect(codes(result.blockers)).toContain("no_senior_staff");
  });

  it("passes cleanly when the roster can be staffed", () => {
    const result = runPreflight(input());
    expect(result.canGenerate).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe("runPreflight — warnings (the roster still generates)", () => {
  it("warns, but does not block, when a role is short-handed on a day", () => {
    const result = runPreflight(
      input({
        positions: expandPositions({
          rosterStart: START,
          days: 7,
          timezone: TZ,
          slots: [slot({ count: 3 })],
          tradingHours: trading(),
        }),
      }),
    );
    expect(result.canGenerate).toBe(true);
    const issue = result.warnings.find((w) => w.code === "role_shortfall");
    expect(issue?.message).toContain("Kitchen needs 3 people on 2026-08-03");
    expect(issue?.message).toContain("only 1 person can work it");
  });

  it("warns about people with no availability recorded, naming them", () => {
    const result = runPreflight(
      input({
        members: [member(), member({ id: "u2", name: "Ben" })],
        availability: NO_AVAILABILITY,
      }),
    );
    expect(result.canGenerate).toBe(true);
    const issue = result.warnings.find((w) => w.code === "no_availability_recorded");
    expect(issue?.userIds).toEqual(["u1", "u2"]);
    expect(issue?.message).toBe("Aisha and Ben have no availability recorded.");
  });

  it("does not warn about someone who has only a dated exception recorded", () => {
    const result = runPreflight(
      input({
        availability: {
          patterns: [],
          exceptions: [
            { userId: "u1", date: START, isAvailable: false, from: null, to: null },
          ],
        },
      }),
    );
    expect(codes(result.warnings)).not.toContain("no_availability_recorded");
  });

  it("warns when demand exceeds the team's total weekly capacity", () => {
    // 7 positions/week × 7h = 49h demanded; one casual capped at 20h ⇒ short.
    const result = runPreflight(
      input({
        positions: expandPositions({
          rosterStart: START,
          days: 7,
          timezone: TZ,
          slots: Array.from({ length: 7 }, (_, dow) =>
            slot({ id: `slot-${dow}`, dayOfWeek: dow }),
          ),
          tradingHours: trading(),
        }),
        members: [member({ maxHoursWeek: 20 })],
      }),
    );
    expect(result.canGenerate).toBe(true);
    const issue = result.warnings.find((w) => w.code === "capacity_shortfall");
    expect(issue?.message).toContain("49 hours");
    expect(issue?.message).toContain("only allow 20");
  });

  it("scales capacity to a fortnight rather than comparing against one week", () => {
    const fortnight = input({
      days: 14,
      positions: expandPositions({
        rosterStart: START,
        days: 14,
        timezone: TZ,
        slots: [slot({ count: 3 })], // 2 Mondays × 3 × 7h = 42h
        tradingHours: trading(),
      }),
      members: [
        member({ maxHoursWeek: 25 }),
        member({ id: "u2", name: "Ben", maxHoursWeek: 25 }),
      ],
    });
    // 2 people × 25h × 2 weeks = 100h capacity vs 42h demand ⇒ no warning.
    expect(codes(runPreflight(fortnight).warnings)).not.toContain("capacity_shortfall");
  });

  it("warns about a senior shortfall without blocking", () => {
    const result = runPreflight(
      input({
        rule: { ...RULE, seniorCoverageEnabled: true },
        members: [member({ level: "senior", maxHoursWeek: 10 })],
      }),
    );
    expect(result.canGenerate).toBe(true);
    const issue = result.warnings.find((w) => w.code === "senior_shortfall");
    expect(issue?.message).toContain("hours of senior presence");
    expect(issue?.detail).toContain("will still generate");
  });
});
