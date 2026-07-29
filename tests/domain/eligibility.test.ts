import { describe, expect, it } from "vitest";
import {
  checkEligibility,
  seniorCoverageGaps,
  type EligibilityContext,
  type EligibilityShift,
  type EligibilityTarget,
} from "../../src/lib/domain/eligibility";
import type {
  AvailabilityInput,
  MemberInput,
  SolverRuleInput,
  TradingHoursInput,
} from "../../src/lib/domain/solver-request";

// Monday 3 Aug 2026, Sydney = UTC+10 (no daylight saving in August).
const MON = "2026-08-03";
const TUE = "2026-08-04";
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
  oneShiftPerDay: false,
};

function trading(over: Partial<TradingHoursInput> = {}): TradingHoursInput[] {
  return Array.from({ length: 7 }, (_, dow) => ({
    locationId: LOC,
    dayOfWeek: dow,
    isOpen: true,
    is24h: true,
    opensAt: "00:00",
    closesAt: "24:00",
    ...over,
  }));
}

function member(over: Partial<MemberInput> = {}): MemberInput {
  return {
    id: "u1",
    name: "Bilal",
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

/** A shift on `date` from `from`–`to` Sydney wall time (UTC+10 in August). */
function shift(
  id: string,
  date: string,
  from: number,
  to: number,
  over: Partial<EligibilityShift> = {},
): EligibilityShift {
  const pad = (n: number) => String(n).padStart(2, "0");
  const utc = (d: string, h: number) => {
    const hour = h - 10; // Sydney → UTC
    if (hour < 0) return `${addDay(d, -1)}T${pad(hour + 24)}:00:00.000Z`;
    if (hour >= 24) return `${addDay(d, 1)}T${pad(hour - 24)}:00:00.000Z`;
    return `${d}T${pad(hour)}:00:00.000Z`;
  };
  return {
    id,
    assignedUserId: "u1",
    date,
    startUtc: utc(date, from),
    endUtc: to >= 24 ? utc(date, to) : utc(date, to),
    breakMinutes: 0,
    ...over,
  };
}

function addDay(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000);
  return at.toISOString().slice(0, 10);
}

function target(over: Partial<EligibilityTarget> = {}): EligibilityTarget {
  const s = shift("t", MON, 16, 23);
  return {
    date: MON,
    startUtc: s.startUtc,
    endUtc: s.endUtc,
    roleId: "kitchen",
    breakMinutes: 0,
    ...over,
  };
}

function context(over: Partial<EligibilityContext> = {}): EligibilityContext {
  return {
    timezone: TZ,
    rosterStart: MON,
    rule: RULE,
    availability: { patterns: [], exceptions: [] } as AvailabilityInput,
    tradingHours: trading(),
    shifts: [],
    roleNames: { kitchen: "Kitchen", foh: "Front of house" },
    ...over,
  };
}

const rules = (issues: { rule: string }[]) => issues.map((i) => i.rule);

// ---------------------------------------------------------------------------

describe("checkEligibility — BLOCK: physically impossible, never overridable", () => {
  it("blocks a deactivated person", () => {
    const r = checkEligibility(member({ active: false }), target(), context());
    expect(r.blocked).toBe(true);
    expect(rules(r.blocks)).toContain("inactive");
    expect(r.blocks[0].message).toBe("Bilal is deactivated and can't be rostered.");
  });

  it("blocks a role the person doesn't hold, naming the role", () => {
    const r = checkEligibility(member({ roleIds: ["foh"] }), target(), context());
    expect(r.blocked).toBe(true);
    const issue = r.blocks.find((b) => b.rule === "role");
    expect(issue?.message).toBe("Bilal isn't marked for Kitchen.");
    expect(issue?.short).toBe("Not marked for Kitchen");
  });

  it("blocks an overlapping shift and says when the clash is", () => {
    const r = checkEligibility(
      member(),
      target(),
      context({ shifts: [shift("s1", MON, 20, 23)] }),
    );
    expect(r.blocked).toBe(true);
    const issue = r.blocks.find((b) => b.rule === "overlap");
    expect(issue?.message).toContain("already rostered 20:00–23:00 on Mon 3 Aug");
    expect(issue?.message).toContain("two places at once");
  });

  it("does not clash with the shift currently being edited", () => {
    const existing = shift("s1", MON, 16, 23);
    const r = checkEligibility(
      member(),
      target({ shiftId: "s1" }),
      context({ shifts: [existing] }),
    );
    expect(r.blocked).toBe(false);
  });

  it("does not clash with a shift belonging to someone else", () => {
    const r = checkEligibility(
      member(),
      target(),
      context({ shifts: [shift("s1", MON, 16, 23, { assignedUserId: "u2" })] }),
    );
    expect(r.blocked).toBe(false);
  });

  it("never marks a block as persistable — a block is refused, not recorded", () => {
    const r = checkEligibility(member({ active: false, roleIds: [] }), target(), context());
    expect(r.blocks.every((b) => b.persistedRule === null)).toBe(true);
  });
});

// The location rule (H9) exists for M8 §4: an open shift must not be offered to
// someone who doesn't work at that site. It is OPT-IN — the M6 roster screen
// passes no locationId and must keep behaving exactly as it did.
describe("checkEligibility — BLOCK: location (H9)", () => {
  const OTHER = "loc-2";

  it("is not checked at all when the caller gives no location", () => {
    const r = checkEligibility(
      member({ homeLocationId: LOC, canWorkOtherLocations: false }),
      target(),
      context(),
    );
    expect(rules(r.blocks)).not.toContain("location");
    expect(r.blocked).toBe(false);
  });

  it("blocks someone tied to another site, naming the location", () => {
    const r = checkEligibility(
      member({ homeLocationId: LOC, canWorkOtherLocations: false }),
      target({ locationId: OTHER }),
      context({ locationNames: { [OTHER]: "Guildford" } }),
    );
    expect(r.blocked).toBe(true);
    expect(rules(r.blocks)).toContain("location");
    expect(r.blocks[0].message).toBe("Bilal isn't set up to work at Guildford.");
  });

  it("allows their own home location", () => {
    const r = checkEligibility(member(), target({ locationId: LOC }), context());
    expect(rules(r.blocks)).not.toContain("location");
  });

  it("allows anyone marked as able to work other locations", () => {
    const r = checkEligibility(
      member({ canWorkOtherLocations: true }),
      target({ locationId: OTHER }),
      context(),
    );
    expect(rules(r.blocks)).not.toContain("location");
  });

  it("allows someone with no home location — they are not tied anywhere", () => {
    const r = checkEligibility(
      member({ homeLocationId: null }),
      target({ locationId: OTHER }),
      context(),
    );
    expect(rules(r.blocks)).not.toContain("location");
  });

  it("falls back to plain words when the location name is unknown", () => {
    const r = checkEligibility(member(), target({ locationId: OTHER }), context());
    expect(r.blocks[0].message).toBe("Bilal isn't set up to work at that location.");
  });
});

describe("checkEligibility — WARN: allowed, but named and persisted", () => {
  it("is clean when nothing is breached", () => {
    const r = checkEligibility(member(), target(), context());
    expect(r).toMatchObject({ eligible: true, blocked: false, reason: null });
    expect(r.issues).toEqual([]);
  });

  it("warns when the person is marked unavailable that day", () => {
    const r = checkEligibility(
      member(),
      target(),
      context({
        availability: {
          patterns: [],
          exceptions: [{ userId: "u1", date: MON, isAvailable: false, from: null, to: null }],
        },
      }),
    );
    expect(r.blocked).toBe(false);
    const issue = r.warnings.find((w) => w.rule === "availability");
    expect(issue?.message).toBe("Bilal is marked unavailable on Mon 3 Aug.");
    expect(issue?.persistedRule).toBe("availability");
  });

  it("warns with the actual window when the shift runs past it", () => {
    const r = checkEligibility(
      member(),
      target(),
      context({
        availability: {
          patterns: [{ userId: "u1", dayOfWeek: 1, isAvailable: true, from: "10:00", to: "18:00" }],
          exceptions: [],
        },
      }),
    );
    const issue = r.warnings.find((w) => w.rule === "availability");
    expect(issue?.message).toBe(
      "Bilal is only available 10:00–18:00 on Mon 3 Aug; this shift runs 16:00–23:00.",
    );
  });

  it("accepts a shift that sits inside the available window", () => {
    const r = checkEligibility(
      member(),
      target(),
      context({
        availability: {
          patterns: [{ userId: "u1", dayOfWeek: 1, isAvailable: true, from: "12:00", to: "24:00" }],
          exceptions: [],
        },
      }),
    );
    expect(rules(r.warnings)).not.toContain("availability");
  });

  it("warns over the weekly hour limit, quoting both figures", () => {
    const r = checkEligibility(
      member({ maxHoursWeek: 10 }),
      target(), // 7h
      context({ shifts: [shift("s1", TUE, 9, 14)] }), // + 5h = 12h
    );
    expect(r.blocked).toBe(false);
    const issue = r.warnings.find((w) => w.rule === "max_hours");
    expect(issue?.message).toBe("This puts Bilal at 12h in the week of Mon 3 Aug (limit 10h).");
    expect(issue?.persistedRule).toBe("max_hours");
  });

  it("uses the employment-type default when the person has no own limit", () => {
    const many = Array.from({ length: 5 }, (_, i) => shift(`s${i}`, addDay(TUE, i), 9, 17));
    const r = checkEligibility(
      member({ employmentType: "part_time", maxHoursWeek: null }),
      target(),
      context({ shifts: many }),
    );
    // 5 × 8h + 7h = 47h against the 30h part-time default.
    expect(r.warnings.find((w) => w.rule === "max_hours")?.message).toContain("limit 30h");
  });

  it("counts hours per ROSTER WEEK, not across the whole fortnight", () => {
    const nextWeek = shift("s1", addDay(MON, 8), 9, 21); // 12h, week 2
    const r = checkEligibility(
      member({ maxHoursWeek: 10 }),
      target(), // 7h in week 1
      context({ shifts: [nextWeek] }),
    );
    expect(rules(r.warnings)).not.toContain("max_hours");
  });

  it("warns on short rest between shifts", () => {
    // Closes 23:00 Mon, opens 06:00 Tue = 7h rest, limit 10h.
    const r = checkEligibility(
      member(),
      target({
        ...target(),
        date: TUE,
        startUtc: shift("t", TUE, 6, 12).startUtc,
        endUtc: shift("t", TUE, 6, 12).endUtc,
      }),
      context({ shifts: [shift("s1", MON, 16, 23)] }),
    );
    const issue = r.warnings.find((w) => w.rule === "min_rest");
    expect(issue?.message).toBe(
      "Only 7h rest between Bilal's shift on Mon 3 Aug and this one (10h required).",
    );
    expect(issue?.persistedRule).toBe("min_rest");
  });

  it("warns past the consecutive-days limit, counting the run either side", () => {
    const before = [0, 1, 2].map((i) => shift(`b${i}`, addDay(MON, i - 3), 9, 14));
    const after = [1, 2, 3].map((i) => shift(`a${i}`, addDay(MON, i), 9, 14));
    const r = checkEligibility(
      member({ maxHoursWeek: 200 }),
      target(),
      context({ rosterStart: addDay(MON, -3), shifts: [...before, ...after] }),
    );
    const issue = r.warnings.find((w) => w.rule === "consecutive_days");
    expect(issue?.message).toBe("This would be day 7 in a row for Bilal (limit 6).");
  });

  it("warns about a second shift the same day when the business rosters one", () => {
    const r = checkEligibility(
      member(),
      target(),
      context({ rule: { ...RULE, oneShiftPerDay: true }, shifts: [shift("s1", MON, 6, 12)] }),
    );
    expect(r.blocked).toBe(false);
    const issue = r.warnings.find((w) => w.rule === "one_shift_per_day");
    expect(issue?.message).toContain("already has a shift on Mon 3 Aug");
    // Not in the roster_warning CHECK vocabulary — warns live, isn't persisted.
    expect(issue?.persistedRule).toBeNull();
  });

  it("warns when the person is still under their guaranteed minimum hours", () => {
    const r = checkEligibility(member({ minHoursWeek: 20 }), target(), context());
    const issue = r.warnings.find((w) => w.rule === "min_hours");
    expect(issue?.message).toBe(
      "Bilal would still be on 7h in the week of Mon 3 Aug, below their 20h minimum.",
    );
    expect(issue?.persistedRule).toBe("min_hours");
  });

  it("surfaces the first issue as a short picker reason, blocks winning", () => {
    const r = checkEligibility(
      member({ roleIds: [], maxHoursWeek: 1 }),
      target(),
      context(),
    );
    expect(r.reason).toBe("Not marked for Kitchen");
  });

  it("every persistable warning uses a rule the database will accept", () => {
    const r = checkEligibility(
      member({ maxHoursWeek: 1, minHoursWeek: 40 }),
      target(),
      context({
        availability: {
          patterns: [],
          exceptions: [{ userId: "u1", date: MON, isAvailable: false, from: null, to: null }],
        },
        shifts: [shift("s1", MON, 6, 12)],
      }),
    );
    const allowed = new Set([
      "availability",
      "max_hours",
      "min_rest",
      "consecutive_days",
      "senior_coverage",
      "min_hours",
    ]);
    for (const w of r.warnings) {
      if (w.persistedRule) expect(allowed.has(w.persistedRule)).toBe(true);
    }
    expect(r.warnings.length).toBeGreaterThan(2);
  });
});

describe("seniorCoverageGaps — a roster-level rule, recomputed after every edit", () => {
  const seniorRule: SolverRuleInput = {
    ...RULE,
    seniorCoverageEnabled: true,
    seniorMinCount: 1,
    seniorQualifyingLevels: ["senior"],
  };
  const open10to22 = trading({ is24h: false, opensAt: "10:00", closesAt: "22:00" });
  const senior = member({ id: "s1", name: "Aisha", level: "senior" });
  const junior = member({ id: "j1", name: "Tom", level: "junior" });

  it("returns nothing when the rule is switched off", () => {
    expect(
      seniorCoverageGaps({
        dates: [MON],
        locationIds: [LOC],
        shifts: [],
        members: [senior],
        rule: RULE,
        tradingHours: open10to22,
        timezone: TZ,
      }),
    ).toEqual([]);
  });

  it("flags the whole open day when no senior is on", () => {
    const gaps = seniorCoverageGaps({
      dates: [MON],
      locationIds: [LOC],
      shifts: [shift("s1", MON, 10, 22, { assignedUserId: "j1" })],
      members: [senior, junior],
      rule: seniorRule,
      tradingHours: open10to22,
      timezone: TZ,
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ date: MON, from: "10:00", to: "22:00" });
    expect(gaps[0].detail).toBe("No senior is rostered 10:00–22:00 on Mon 3 Aug.");
  });

  it("is satisfied by two seniors covering the day between them", () => {
    const gaps = seniorCoverageGaps({
      dates: [MON],
      locationIds: [LOC],
      shifts: [
        shift("a", MON, 10, 17, { assignedUserId: "s1" }),
        shift("b", MON, 16, 22, { assignedUserId: "s2" }),
      ],
      members: [senior, { ...senior, id: "s2", name: "Omar" }],
      rule: seniorRule,
      tradingHours: open10to22,
      timezone: TZ,
    });
    expect(gaps).toEqual([]);
  });

  it("names the exact uncovered window when the seniors don't quite meet", () => {
    const gaps = seniorCoverageGaps({
      dates: [MON],
      locationIds: [LOC],
      shifts: [
        shift("a", MON, 10, 16, { assignedUserId: "s1" }),
        shift("b", MON, 18, 22, { assignedUserId: "s2" }),
      ],
      members: [senior, { ...senior, id: "s2", name: "Omar" }],
      rule: seniorRule,
      tradingHours: open10to22,
      timezone: TZ,
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ from: "16:00", to: "18:00" });
  });

  it("ignores a closed day", () => {
    const closedMon = open10to22.map((t) =>
      t.dayOfWeek === 1 ? { ...t, isOpen: false, opensAt: null, closesAt: null } : t,
    );
    expect(
      seniorCoverageGaps({
        dates: [MON],
        locationIds: [LOC],
        shifts: [],
        members: [senior],
        rule: seniorRule,
        tradingHours: closedMon,
        timezone: TZ,
      }),
    ).toEqual([]);
  });
});
