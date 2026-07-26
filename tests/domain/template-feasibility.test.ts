import { describe, expect, it } from "vitest";
import {
  coverageGaps,
  demandHours,
  openHours,
  perRoleShortfalls,
  resolveMaxHours,
  seniorCoverageGaps,
  seniorSupplyVsDemand,
  slotWithinTradingHours,
  supplyVsDemand,
  type MemberLike,
  type SchedulingRuleLike,
  type SlotLike,
  type TradingDay,
} from "../../src/lib/domain/template-feasibility";

const RULE: SchedulingRuleLike = {
  maxHoursCasual: 38,
  maxHoursPartTime: 30,
  maxHoursFullTime: 38,
  seniorCoverageEnabled: true,
  seniorMinCount: 1,
  seniorQualifyingLevels: ["senior"],
};

const open10to2230 = { isOpen: true, is24h: false, opensAt: "10:00", closesAt: "22:30" };
const closed = { isOpen: false, is24h: false, opensAt: null, closesAt: null };

function slot(over: Partial<SlotLike>): SlotLike {
  return {
    dayOfWeek: 5,
    roleId: "kitchen",
    start: "10:00",
    end: "22:30",
    count: 1,
    requiredLevel: null,
    ...over,
  };
}

describe("resolveMaxHours (M4 §5.3)", () => {
  it("prefers the person's own weekly limit", () => {
    const m: MemberLike = {
      active: true,
      level: "mid",
      employmentType: "casual",
      maxHoursWeek: 20,
      roleIds: [],
    };
    expect(resolveMaxHours(m, RULE)).toBe(20);
  });

  it("falls back to the employment-type default from the rule", () => {
    const m: MemberLike = {
      active: true,
      level: "mid",
      employmentType: "part_time",
      maxHoursWeek: null,
      roleIds: [],
    };
    expect(resolveMaxHours(m, RULE)).toBe(30);
  });
});

describe("coverageGaps (M4 §5.2)", () => {
  it("names the uncovered tail of the trading day", () => {
    const gaps = coverageGaps([slot({ start: "10:00", end: "20:00" })], open10to2230);
    expect(gaps).toEqual([{ from: "20:00", to: "22:30" }]);
  });

  it("reports no gap when slots span the whole day", () => {
    expect(coverageGaps([slot({ start: "10:00", end: "22:30" })], open10to2230)).toEqual([]);
  });

  it("does not treat the midnight boundary of chained slots as a gap", () => {
    const trading24 = { isOpen: true, is24h: true, opensAt: null, closesAt: null };
    const slots = [
      slot({ start: "06:00", end: "14:00" }),
      slot({ start: "14:00", end: "22:00" }),
      slot({ start: "22:00", end: "06:00" }), // crosses midnight, closes the loop
    ];
    expect(coverageGaps(slots, trading24)).toEqual([]);
  });

  it("returns nothing for a closed day", () => {
    expect(coverageGaps([], closed)).toEqual([]);
  });
});

describe("seniorCoverageGaps (M4 §5.2)", () => {
  it("flags the exact window with no senior-capable position", () => {
    // Trading 10:00–22:30, but the only slot runs 14:00–22:30 → 10:00–14:00 uncovered.
    const gaps = seniorCoverageGaps([slot({ start: "14:00", end: "22:30" })], open10to2230, RULE);
    expect(gaps).toEqual([{ from: "10:00", to: "14:00" }]);
  });

  it("is satisfied by overlapping slots covering all open hours", () => {
    const slots = [slot({ start: "10:00", end: "17:00" }), slot({ start: "16:00", end: "22:30" })];
    expect(seniorCoverageGaps(slots, open10to2230, RULE)).toEqual([]);
  });

  it("flags a window when fewer positions exist than seniorMinCount", () => {
    const twoSeniors = { ...RULE, seniorMinCount: 2 };
    // One position all day, but two seniors required → whole day infeasible.
    const gaps = seniorCoverageGaps([slot({ start: "10:00", end: "22:30" })], open10to2230, twoSeniors);
    expect(gaps).toEqual([{ from: "10:00", to: "22:30" }]);
  });

  it("returns nothing when the senior rule is off", () => {
    const off = { ...RULE, seniorCoverageEnabled: false };
    expect(seniorCoverageGaps([], open10to2230, off)).toEqual([]);
  });
});

describe("supplyVsDemand + demandHours (M4 §5.3)", () => {
  const members: MemberLike[] = [
    { active: true, level: "senior", employmentType: "casual", maxHoursWeek: 38, roleIds: ["kitchen"] },
    { active: true, level: "mid", employmentType: "part_time", maxHoursWeek: null, roleIds: ["foh"] },
    { active: false, level: "mid", employmentType: "casual", maxHoursWeek: 38, roleIds: ["kitchen"] },
  ];

  it("sums span × count for demanded hours", () => {
    const slots = [slot({ start: "10:00", end: "18:00", count: 2 })]; // 8h × 2 = 16
    expect(demandHours(slots)).toBe(16);
  });

  it("reports a shortfall when demand exceeds active capacity", () => {
    // demand 16h × … build 100h of demand; capacity = 38 + 30 = 68 (inactive excluded).
    const slots = Array.from({ length: 10 }, () => slot({ start: "10:00", end: "20:00" })); // 10h ×10 = 100
    const sd = supplyVsDemand(slots, members, RULE);
    expect(sd.demandHours).toBe(100);
    expect(sd.capacityHours).toBe(68);
    expect(sd.shortfallHours).toBe(32);
  });
});

describe("perRoleShortfalls (M4 §5.3)", () => {
  it("names the worst day where positions outnumber eligible staff", () => {
    const members: MemberLike[] = [
      { active: true, level: "mid", employmentType: "casual", maxHoursWeek: 38, roleIds: ["kitchen"] },
      { active: true, level: "mid", employmentType: "casual", maxHoursWeek: 38, roleIds: ["kitchen"] },
    ];
    const slots = [
      slot({ dayOfWeek: 5, roleId: "kitchen", count: 4 }), // Friday needs 4, only 2 people
      slot({ dayOfWeek: 1, roleId: "kitchen", count: 1 }),
    ];
    const out = perRoleShortfalls(slots, members);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ roleId: "kitchen", dayLabel: "Friday", needed: 4, available: 2 });
  });
});

describe("seniorSupplyVsDemand (M4 §5.3)", () => {
  it("computes senior demand as open hours × min count", () => {
    const seniors: MemberLike[] = [
      { active: true, level: "senior", employmentType: "casual", maxHoursWeek: 38, roleIds: [] },
      { active: true, level: "senior", employmentType: "casual", maxHoursWeek: 38, roleIds: [] },
    ];
    // Seven days of 13h open = 91h demand (min count 1); 2 seniors × 38 = 76 supply.
    const week = Array.from({ length: 7 }, () => ({ isOpen: true, is24h: false, opensAt: "10:00", closesAt: "23:00" }));
    const r = seniorSupplyVsDemand(week, seniors, RULE);
    expect(r).not.toBeNull();
    expect(r!.demandHours).toBe(91);
    expect(r!.supplyHours).toBe(76);
    expect(r!.shortfallHours).toBe(15);
  });

  it("returns null when the senior rule is off", () => {
    expect(seniorSupplyVsDemand([open10to2230], [], { ...RULE, seniorCoverageEnabled: false })).toBeNull();
  });

  it("openHours is zero for a closed day", () => {
    expect(openHours(closed)).toBe(0);
    expect(openHours(open10to2230)).toBe(12.5);
  });

  it("counts open hours for an overnight trading day (18:00→02:00 = 8h)", () => {
    const overnightTrading = { isOpen: true, is24h: false, opensAt: "18:00", closesAt: "02:00" };
    expect(openHours(overnightTrading)).toBe(8);
  });

  it("senior demand for a single overnight trading day = open hours × min count", () => {
    const overnightTrading = { isOpen: true, is24h: false, opensAt: "18:00", closesAt: "02:00" };
    const seniors: MemberLike[] = [
      { active: true, level: "senior", employmentType: "casual", maxHoursWeek: 38, roleIds: [] },
    ];
    const twoSeniors = { ...RULE, seniorMinCount: 2 };
    const r = seniorSupplyVsDemand([overnightTrading], seniors, twoSeniors);
    expect(r).not.toBeNull();
    expect(r!.demandHours).toBe(16); // 8h open × 2 required seniors
    expect(r!.supplyHours).toBe(38);
    expect(r!.shortfallHours).toBe(16 - 38);
  });
});

// ---- Edge coverage added by QA (M4 §5.2/§5.3, §7) ----

describe("overnight & cross-midnight coverage (M4 §7)", () => {
  const trading24 = { isOpen: true, is24h: true, opensAt: null, closesAt: null };
  const overnightTrading = { isOpen: true, is24h: false, opensAt: "18:00", closesAt: "02:00" };

  it("an overnight slot fully covers overnight trading — no gap", () => {
    const slots = [slot({ start: "18:00", end: "02:00" })];
    expect(coverageGaps(slots, overnightTrading)).toEqual([]);
  });

  it("names the cross-midnight tail an overnight slot leaves uncovered", () => {
    // Trading 18:00–02:00 but the slot stops at midnight → 00:00–02:00 uncovered.
    const slots = [slot({ start: "18:00", end: "00:00" })];
    expect(coverageGaps(slots, overnightTrading)).toEqual([{ from: "00:00", to: "02:00" }]);
  });

  it("merges a wrap-around gap on a 24h day into one window (22:00→06:00)", () => {
    // Slots cover 06:00–22:00 only; the uncovered ends of the day join across midnight.
    const slots = [slot({ start: "06:00", end: "22:00" })];
    expect(coverageGaps(slots, trading24)).toEqual([{ from: "22:00", to: "06:00" }]);
  });

  it("reports the whole 24h day uncovered when no slot exists", () => {
    expect(coverageGaps([], trading24)).toEqual([{ from: "00:00", to: "24:00" }]);
  });

  it("senior coverage is satisfied by chained slots across midnight (24h)", () => {
    const slots = [
      slot({ start: "06:00", end: "14:00" }),
      slot({ start: "14:00", end: "22:00" }),
      slot({ start: "22:00", end: "06:00" }),
    ];
    expect(seniorCoverageGaps(slots, trading24, RULE)).toEqual([]);
  });

  it("counts overnight slot hours in weekly demand (span × count)", () => {
    // 22:00–06:00 = 8h; two people = 16h.
    expect(demandHours([slot({ start: "22:00", end: "06:00", count: 2 })])).toBe(16);
    // A cross-midnight partial: 22:00–06:15 = 8.25h.
    expect(demandHours([slot({ start: "22:00", end: "06:15", count: 1 })])).toBe(8.25);
  });
});

describe("per-role shortfalls — multi-role & zero-eligible (M4 §5.3)", () => {
  it("reports a role with NO eligible staff (available 0)", () => {
    const members: MemberLike[] = [
      { active: true, level: "mid", employmentType: "casual", maxHoursWeek: 38, roleIds: ["kitchen"] },
    ];
    const slots = [slot({ dayOfWeek: 1, roleId: "bar", count: 1 })]; // nobody can work bar
    const out = perRoleShortfalls(slots, members);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ roleId: "bar", needed: 1, available: 0, dayLabel: "Monday" });
  });

  it("reports one shortfall per role when several are short", () => {
    const members: MemberLike[] = [
      { active: true, level: "mid", employmentType: "casual", maxHoursWeek: 38, roleIds: ["kitchen"] },
    ];
    const slots = [
      slot({ dayOfWeek: 5, roleId: "kitchen", count: 3 }), // 3 vs 1
      slot({ dayOfWeek: 6, roleId: "foh", count: 2 }), // 2 vs 0
    ];
    const out = perRoleShortfalls(slots, members);
    expect(out).toHaveLength(2);
    const byRole = Object.fromEntries(out.map((g) => [g.roleId, g]));
    expect(byRole.kitchen).toMatchObject({ needed: 3, available: 1, dayLabel: "Friday" });
    expect(byRole.foh).toMatchObject({ needed: 2, available: 0, dayLabel: "Saturday" });
  });

  it("picks the worst day for a role (largest shortfall), not merely the first", () => {
    const members: MemberLike[] = [
      { active: true, level: "mid", employmentType: "casual", maxHoursWeek: 38, roleIds: ["kitchen"] },
      { active: true, level: "mid", employmentType: "casual", maxHoursWeek: 38, roleIds: ["kitchen"] },
    ];
    const slots = [
      slot({ dayOfWeek: 6, roleId: "kitchen", count: 3 }), // Sat: shortfall 1
      slot({ dayOfWeek: 5, roleId: "kitchen", count: 5 }), // Fri: shortfall 3 → worst
    ];
    const out = perRoleShortfalls(slots, members);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ dayLabel: "Friday", needed: 5, available: 2 });
  });

  it("excludes inactive members from the eligible count", () => {
    const members: MemberLike[] = [
      { active: true, level: "mid", employmentType: "casual", maxHoursWeek: 38, roleIds: ["kitchen"] },
      { active: false, level: "mid", employmentType: "casual", maxHoursWeek: 38, roleIds: ["kitchen"] },
    ];
    const out = perRoleShortfalls([slot({ dayOfWeek: 1, roleId: "kitchen", count: 2 })], members);
    expect(out[0]).toMatchObject({ needed: 2, available: 1 });
  });
});

describe("team capacity — per-person override vs employment-type default (M4 §5.3)", () => {
  it("sums each active member's resolved ceiling, mixing overrides and defaults", () => {
    const members: MemberLike[] = [
      { active: true, level: "mid", employmentType: "full_time", maxHoursWeek: 25, roleIds: [] }, // override 25
      { active: true, level: "mid", employmentType: "full_time", maxHoursWeek: null, roleIds: [] }, // default 38
      { active: true, level: "mid", employmentType: "part_time", maxHoursWeek: null, roleIds: [] }, // default 30
      { active: true, level: "mid", employmentType: "casual", maxHoursWeek: null, roleIds: [] }, // default 38
      { active: false, level: "mid", employmentType: "full_time", maxHoursWeek: null, roleIds: [] }, // excluded
    ];
    const sd = supplyVsDemand([], members, RULE);
    expect(sd.capacityHours).toBe(25 + 38 + 30 + 38); // 131, inactive excluded
  });

  it("resolveMaxHours honours a zero override (0 is a real limit, not 'unset')", () => {
    const m: MemberLike = {
      active: true,
      level: "mid",
      employmentType: "full_time",
      maxHoursWeek: 0,
      roleIds: [],
    };
    expect(resolveMaxHours(m, RULE)).toBe(0);
  });
});

describe("slotWithinTradingHours (M4 §5.1 — regression: overnight trading)", () => {
  const dayShift: TradingDay = { isOpen: true, is24h: false, opensAt: "10:00", closesAt: "22:30" };
  const overnight: TradingDay = { isOpen: true, is24h: false, opensAt: "18:00", closesAt: "02:00" };

  it("accepts a slot fully within a normal day", () => {
    expect(slotWithinTradingHours("10:00", "16:00", dayShift)).toBe(true);
  });

  it("rejects a slot starting before open", () => {
    expect(slotWithinTradingHours("09:00", "12:00", dayShift)).toBe(false);
  });

  it("rejects a slot ending after close", () => {
    expect(slotWithinTradingHours("21:00", "23:30", dayShift)).toBe(false);
  });

  it("accepts a post-midnight slot on an overnight trading day (the bug)", () => {
    // 00:30–01:30 sits inside an 18:00→02:00 window — must NOT be flagged.
    expect(slotWithinTradingHours("00:30", "01:30", overnight)).toBe(true);
    expect(slotWithinTradingHours("00:00", "02:00", overnight)).toBe(true);
  });

  it("accepts a slot that itself crosses midnight within overnight trading", () => {
    expect(slotWithinTradingHours("20:00", "01:00", overnight)).toBe(true);
  });

  it("rejects a slot outside an overnight window (the shop's daytime)", () => {
    expect(slotWithinTradingHours("12:00", "14:00", overnight)).toBe(false);
  });

  it("accepts any slot on a 24-hour day and none on a closed day", () => {
    expect(slotWithinTradingHours("03:00", "05:00", { isOpen: true, is24h: true, opensAt: null, closesAt: null })).toBe(true);
    expect(slotWithinTradingHours("10:00", "12:00", { isOpen: false, is24h: false, opensAt: null, closesAt: null })).toBe(false);
  });
});
