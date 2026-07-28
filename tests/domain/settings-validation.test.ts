import { describe, expect, it } from "vitest";
import {
  DEFAULT_BREAK_TIERS,
  DEFAULT_SCHEDULING_RULES,
  checkLocationDeactivation,
  checkRoleDeletion,
  countSeniorQualifyingStaff,
  hasErrors,
  isOvernightWindow,
  tradingMinutes,
  validateBreakRules,
  validateSchedulingRules,
  validateTradingHours,
  validateTradingHoursDay,
  type BreakRuleTier,
  type SchedulingRuleDraft,
  type TradingHoursDay,
} from "../../src/lib/domain/settings-validation";

const day = (over: Partial<TradingHoursDay> = {}): TradingHoursDay => ({
  dayOfWeek: 1,
  isOpen: true,
  is24h: false,
  opensAt: "10:00",
  closesAt: "22:30",
  ...over,
});

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe("trading hours (M1 §3.3, §6)", () => {
  it("accepts a normal day", () => {
    expect(validateTradingHoursDay(day())).toEqual([]);
  });

  it("accepts a closed day with no times", () => {
    expect(
      validateTradingHoursDay(day({ isOpen: false, opensAt: null, closesAt: null })),
    ).toEqual([]);
  });

  it("accepts an overnight window (18:00 → 02:00) as one continuous window", () => {
    const d = day({ opensAt: "18:00", closesAt: "02:00" });
    expect(validateTradingHoursDay(d)).toEqual([]);
    expect(isOvernightWindow(d)).toBe(true);
    expect(tradingMinutes(d)).toBe(8 * 60);
  });

  it("rejects closes_at == opens_at unless the day is 24 hours", () => {
    const same = day({ opensAt: "00:00", closesAt: "00:00" });
    expect(codes(validateTradingHoursDay(same))).toEqual(["trading_zero_length"]);
    expect(validateTradingHoursDay({ ...same, is24h: true })).toEqual([]);
  });

  it("a 24-hour day is a full 1440-minute window and is not 'overnight'", () => {
    const d = day({ is24h: true, opensAt: null, closesAt: null });
    expect(validateTradingHoursDay(d)).toEqual([]);
    expect(tradingMinutes(d)).toBe(1440);
    expect(isOvernightWindow(d)).toBe(false);
  });

  it("rejects an open day with missing or malformed times", () => {
    expect(codes(validateTradingHoursDay(day({ closesAt: null })))).toEqual([
      "trading_times_missing",
    ]);
    expect(codes(validateTradingHoursDay(day({ opensAt: "9am" })))).toEqual([
      "trading_times_missing",
    ]);
  });

  it("names the day in the message so the manager knows which row to fix", () => {
    const [issue] = validateTradingHoursDay(day({ dayOfWeek: 6, closesAt: null }));
    expect(issue.message).toContain("Saturday");
  });

  it("warns (but does not block) when every day is closed", () => {
    const week = [0, 1, 2, 3, 4, 5, 6].map((dow) =>
      day({ dayOfWeek: dow, isOpen: false, opensAt: null, closesAt: null }),
    );
    const issues = validateTradingHours(week);
    expect(codes(issues)).toEqual(["trading_all_closed"]);
    expect(hasErrors(issues)).toBe(false);
  });
});

describe("locations (M1 §3.2, §6)", () => {
  const locations = [
    { id: "a", name: "Regents Park", active: true },
    { id: "b", name: "Guildford", active: true },
    { id: "c", name: "Old site", active: false },
  ];

  it("blocks deactivating the last active location", () => {
    const r = checkLocationDeactivation("a", [locations[0], locations[2]]);
    expect(r.allowed).toBe(false);
    expect(codes(r.issues)).toEqual(["location_last_active"]);
    expect(r.issues[0].message).toContain("Regents Park");
  });

  it("allows deactivating when another active location remains", () => {
    const r = checkLocationDeactivation("a", locations);
    expect(r).toMatchObject({ allowed: true, requiresConfirmation: false });
    expect(r.issues).toEqual([]);
  });

  it("requires confirmation (not a block) when the location has future shifts", () => {
    const r = checkLocationDeactivation("a", locations, 12);
    expect(r).toMatchObject({ allowed: true, requiresConfirmation: true });
    expect(codes(r.issues)).toEqual(["location_future_shifts"]);
    expect(r.issues[0].message).toContain("12 upcoming shifts");
  });

  it("blocks when the location is unknown", () => {
    expect(checkLocationDeactivation("zzz", locations).allowed).toBe(false);
  });
});

describe("roles (M1 §3.4, §6)", () => {
  it("allows hard-deleting a role nothing references", () => {
    const r = checkRoleDeletion("Driver", { staffCount: 0, templateSlotCount: 0, rosterCount: 0 });
    expect(r.allowed).toBe(true);
    expect(r.requiresConfirmation).toBe(true);
  });

  it("blocks deleting a role held by staff and tells the manager to deactivate", () => {
    const r = checkRoleDeletion("Kitchen", { staffCount: 3, templateSlotCount: 0, rosterCount: 0 });
    expect(r.allowed).toBe(false);
    expect(codes(r.issues)).toEqual(["role_in_use"]);
    expect(r.issues[0].message).toContain("3 people");
    expect(r.issues[0].message).toContain("Turn it off instead");
  });

  it("blocks deleting a role used only by rostered shifts", () => {
    const r = checkRoleDeletion("Driver", { staffCount: 0, templateSlotCount: 0, rosterCount: 1 });
    expect(r.allowed).toBe(false);
    expect(r.issues[0].message).toContain("1 rostered shift");
  });

  it("lists every kind of reference", () => {
    const r = checkRoleDeletion("FOH", { staffCount: 2, templateSlotCount: 4, rosterCount: 9 });
    expect(r.issues[0].message).toContain("2 people, 4 template slots and 9 rostered shifts");
  });
});

describe("scheduling rules (M1 §3.6, §6)", () => {
  const ctx = { seniorQualifyingStaffCount: 3 };
  const draft = (over: Partial<SchedulingRuleDraft> = {}): SchedulingRuleDraft => ({
    ...DEFAULT_SCHEDULING_RULES,
    ...over,
  });

  it("the shipped defaults are valid — accepting everything gives a usable config", () => {
    expect(validateSchedulingRules(draft(), ctx)).toEqual([]);
  });

  it("rejects min_shift_hours > max_shift_hours", () => {
    const issues = validateSchedulingRules(draft({ minShiftHours: 14, maxShiftHours: 12 }), ctx);
    expect(codes(issues)).toContain("shift_length_order");
    expect(hasErrors(issues)).toBe(true);
  });

  it("accepts min_shift_hours == max_shift_hours", () => {
    expect(
      validateSchedulingRules(draft({ minShiftHours: 8, maxShiftHours: 8 }), ctx),
    ).toEqual([]);
  });

  it("requires max_consecutive_days between 1 and 7", () => {
    expect(codes(validateSchedulingRules(draft({ maxConsecutiveDays: 0 }), ctx))).toContain(
      "consecutive_days_range",
    );
    expect(codes(validateSchedulingRules(draft({ maxConsecutiveDays: 8 }), ctx))).toContain(
      "consecutive_days_range",
    );
    expect(codes(validateSchedulingRules(draft({ maxConsecutiveDays: 1 }), ctx))).not.toContain(
      "consecutive_days_range",
    );
    // 7 is legal but worth flagging.
    const seven = validateSchedulingRules(draft({ maxConsecutiveDays: 7 }), ctx);
    expect(codes(seven)).toEqual(["consecutive_days_seven"]);
    expect(hasErrors(seven)).toBe(false);
  });

  it("warns — does not block — when senior_min_count exceeds the seniors employed", () => {
    const issues = validateSchedulingRules(draft({ seniorMinCount: 2 }), {
      seniorQualifyingStaffCount: 1,
    });
    expect(codes(issues)).toEqual(["senior_short_staffed"]);
    expect(hasErrors(issues)).toBe(false);
    expect(issues[0].message).toBe(
      "You have 1 Senior but require 2 present; rosters will fail to generate.",
    );
  });

  it("pluralises the senior warning and respects the qualifying levels", () => {
    const issues = validateSchedulingRules(
      draft({ seniorMinCount: 2, seniorQualifyingLevels: ["mid", "senior"] }),
      { seniorQualifyingStaffCount: 0 },
    );
    expect(issues[0].message).toContain("You have 0 senior-qualifying staff members but require 2");
  });

  it("does not check senior staffing when senior coverage is off", () => {
    expect(
      validateSchedulingRules(
        draft({ seniorCoverageEnabled: false, seniorMinCount: 5 }),
        { seniorQualifyingStaffCount: 0 },
      ),
    ).toEqual([]);
  });

  it("rejects senior coverage with no qualifying level selected", () => {
    expect(
      codes(validateSchedulingRules(draft({ seniorQualifyingLevels: [] }), ctx)),
    ).toContain("senior_levels_empty");
  });

  it("rejects a soft-priority ranking that drops or repeats an item", () => {
    expect(
      codes(validateSchedulingRules(draft({ softPriorityOrder: ["fairness", "cost"] }), ctx)),
    ).toContain("soft_priority_incomplete");
    expect(
      codes(
        validateSchedulingRules(
          draft({ softPriorityOrder: ["fairness", "fairness", "cost", "preferences"] }),
          ctx,
        ),
      ),
    ).toContain("soft_priority_incomplete");
  });

  it("rejects nonsensical weekly hour caps", () => {
    expect(codes(validateSchedulingRules(draft({ maxHoursCasual: 0 }), ctx))).toContain(
      "max_hours_invalid",
    );
    expect(codes(validateSchedulingRules(draft({ maxHoursFullTime: 200 }), ctx))).toContain(
      "max_hours_over_week",
    );
  });

  it("counts only active staff at a qualifying level", () => {
    const staff = [
      { level: "senior" as const, active: true },
      { level: "senior" as const, active: false },
      { level: "mid" as const, active: true },
      { level: "junior" as const, active: true },
    ];
    expect(countSeniorQualifyingStaff(staff, ["senior"])).toBe(1);
    expect(countSeniorQualifyingStaff(staff, ["mid", "senior"])).toBe(2);
    expect(countSeniorQualifyingStaff(staff, [])).toBe(0);
  });
});

describe("break rules (M1 §3.7)", () => {
  it("the shipped defaults are clean", () => {
    expect(validateBreakRules(DEFAULT_BREAK_TIERS)).toEqual([]);
  });

  it("treats touching tiers (5h end / 5h start) as adjacent, not overlapping", () => {
    const tiers: BreakRuleTier[] = [
      { minHours: 0, maxHours: 5, breakMinutes: 0 },
      { minHours: 5, maxHours: 8, breakMinutes: 30 },
    ];
    expect(validateBreakRules(tiers)).toEqual([]);
  });

  it("rejects overlapping tiers", () => {
    const issues = validateBreakRules([
      { minHours: 0, maxHours: 6, breakMinutes: 0 },
      { minHours: 5, maxHours: 8, breakMinutes: 30 },
    ]);
    expect(codes(issues)).toContain("break_tiers_overlap");
    expect(hasErrors(issues)).toBe(true);
  });

  it("rejects tiers listed out of order", () => {
    const issues = validateBreakRules([
      { minHours: 5, maxHours: 8, breakMinutes: 30 },
      { minHours: 0, maxHours: 5, breakMinutes: 0 },
    ]);
    expect(codes(issues)).toContain("break_tiers_unordered");
  });

  it("rejects an open-ended tier that is not last", () => {
    const issues = validateBreakRules([
      { minHours: 0, maxHours: null, breakMinutes: 0 },
      { minHours: 8, maxHours: null, breakMinutes: 45 },
    ]);
    expect(codes(issues)).toContain("break_open_tier_not_last");
    expect(codes(issues)).toContain("break_tiers_overlap");
  });

  it("rejects a tier whose 'to' is not above its 'from'", () => {
    expect(
      codes(validateBreakRules([{ minHours: 5, maxHours: 5, breakMinutes: 30 }])),
    ).toContain("break_range_invalid");
  });

  it("rejects a break longer than the shift it applies to", () => {
    expect(
      codes(validateBreakRules([{ minHours: 0, maxHours: 1, breakMinutes: 90 }])),
    ).toContain("break_longer_than_shift");
  });

  it("warns about gaps between tiers and about short shifts with no rule", () => {
    const issues = validateBreakRules([
      { minHours: 2, maxHours: 5, breakMinutes: 0 },
      { minHours: 8, maxHours: null, breakMinutes: 45 },
    ]);
    expect(codes(issues).sort()).toEqual(["break_tiers_gap", "break_tiers_no_short"]);
    expect(hasErrors(issues)).toBe(false);
  });

  it("warns when there are no break rules at all", () => {
    const issues = validateBreakRules([]);
    expect(codes(issues)).toEqual(["break_rules_empty"]);
    expect(hasErrors(issues)).toBe(false);
  });
});
