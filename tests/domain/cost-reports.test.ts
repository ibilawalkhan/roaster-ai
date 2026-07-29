import { describe, expect, it } from "vitest";
import {
  allocateRounded,
  costByDay,
  costByLocation,
  costByPerson,
  costByRole,
  costByWeek,
  filterShifts,
  isFilled,
  reportShiftCost,
  reportShiftHours,
  rosterCostSummary,
  type ReportPeriod,
  type ReportShift,
} from "../../src/lib/domain/cost-reports";
import { roundMoney } from "../../src/lib/domain/cost";
import { minutesOfDay, zonedInstant } from "../../src/lib/domain/timezone";

// ---------------------------------------------------------------------------
// Fixture helpers — shifts are built the way the roster builds them: wall-clock
// times on a trading date, converted to real instants in the business timezone.
// ---------------------------------------------------------------------------

const TZ = "Australia/Sydney";

let seq = 0;

interface ShiftSpec {
  date: string;
  /** "HH:MM" wall clock. */
  start: string;
  /** "HH:MM" wall clock; ≤ start ⇒ the shift runs past midnight. */
  end: string;
  breakMinutes?: number;
  role?: string;
  location?: string;
  /** null ⇒ an unfilled position. */
  user?: string | null;
  name?: string | null;
  rate?: number | null;
}

function s(spec: ShiftSpec): ReportShift {
  seq += 1;
  const startMin = minutesOfDay(spec.start);
  const endMin = minutesOfDay(spec.end) <= startMin ? minutesOfDay(spec.end) + 1440 : minutesOfDay(spec.end);
  const filled = spec.user !== null;
  return {
    id: `sh_${seq}`,
    date: spec.date,
    startAt: zonedInstant(spec.date, startMin, TZ).toISOString(),
    endAt: zonedInstant(spec.date, endMin, TZ).toISOString(),
    breakMinutes: spec.breakMinutes ?? 0,
    roleId: spec.role ?? "role_kitchen",
    locationId: spec.location ?? "loc_main",
    userId: filled ? spec.user ?? "u_amina" : null,
    userName: filled ? spec.name ?? "Amina" : null,
    payRateSnapshot: filled ? (spec.rate === undefined ? 30 : spec.rate) : null,
  };
}

/** An unfilled position — nobody on it, no rate, no cost. */
function unfilled(spec: Omit<ShiftSpec, "user" | "name" | "rate">): ReportShift {
  return s({ ...spec, user: null });
}

const PERIOD: ReportPeriod = { startDate: "2026-08-03", days: 14 }; // Mon, a fortnight

// ---------------------------------------------------------------------------

describe("per-shift primitives (M10 §2)", () => {
  it("computes paid hours from real elapsed time, break excluded", () => {
    expect(reportShiftHours(s({ date: "2026-08-03", start: "09:00", end: "17:00", breakMinutes: 30 }))).toBe(7.5);
  });

  it("costs a shift at its OWN rate snapshot", () => {
    expect(reportShiftCost(s({ date: "2026-08-03", start: "09:00", end: "16:15", rate: 29.5 }))).toBeCloseTo(213.875, 10);
  });

  it("charges nothing for an unfilled position but still measures its hours", () => {
    const gap = unfilled({ date: "2026-08-03", start: "17:00", end: "23:00" });
    expect(isFilled(gap)).toBe(false);
    expect(reportShiftCost(gap)).toBe(0);
    expect(reportShiftHours(gap)).toBe(6);
  });

  it("charges nothing when a filled shift carries no rate snapshot — a gap, not a freebie", () => {
    const noRate = s({ date: "2026-08-03", start: "09:00", end: "17:00", rate: null });
    expect(reportShiftCost(noRate)).toBe(0);
    expect(rosterCostSummary([noRate]).missingRateCount).toBe(1);
    // The hours are still real and still counted.
    expect(rosterCostSummary([noRate]).totalHours).toBe(8);
  });
});

describe("pay-rate snapshots — a raise never rewrites history (M10 §2.1)", () => {
  // Amina worked in July at $25, was given a raise, and worked in August at $32.
  const july = s({ date: "2026-07-06", start: "09:00", end: "17:00", user: "u_amina", rate: 25 });
  const august = s({ date: "2026-08-03", start: "09:00", end: "17:00", user: "u_amina", rate: 32 });

  it("costs each shift at the rate frozen on it, not the person's latest rate", () => {
    expect(reportShiftCost(july)).toBe(200); // 8h × $25 — unchanged by the raise
    expect(reportShiftCost(august)).toBe(256); // 8h × $32
  });

  it("leaves the historical period's total untouched when a later, dearer shift exists", () => {
    const historyAlone = rosterCostSummary([july]).totalCost;
    const historyWithLaterRaise = rosterCostSummary([july, august]).totalCost - reportShiftCost(august);
    expect(historyAlone).toBe(200);
    expect(roundMoney(historyWithLaterRaise)).toBe(200);
  });

  it("flags a person whose shifts carry more than one snapshot rate", () => {
    const [amina] = costByPerson([july, august]);
    expect(amina.rateVaries).toBe(true);
    expect(amina.cost).toBe(456);
    expect(amina.hours).toBe(16);
    expect(amina.rate).toBe(28.5); // effective $/h across the two snapshots
  });
});

describe("overnight shifts anchor to their start date (M10 §2, §8)", () => {
  const overnight = s({ date: "2026-08-07", start: "22:00", end: "06:00" }); // Fri 22:00 → Sat 06:00

  it("puts the whole shift on the day it started", () => {
    const days = costByDay([overnight], PERIOD);
    const friday = days.find((d) => d.date === "2026-08-07");
    const saturday = days.find((d) => d.date === "2026-08-08");
    expect(friday?.hours).toBe(8);
    expect(friday?.cost).toBe(240);
    expect(saturday?.hours).toBe(0);
    expect(saturday?.cost).toBe(0);
  });

  it("keeps a shift starting in week 1 in week 1 even though it ends in week 2", () => {
    const crossover = s({ date: "2026-08-09", start: "22:00", end: "06:00" }); // Sun → Mon of week 2
    const weeks = costByWeek([crossover], PERIOD);
    expect(weeks[0].hours).toBe(8);
    expect(weeks[1].hours).toBe(0);
  });
});

describe("daylight saving — real elapsed hours, never assumed (M10 §2)", () => {
  it("counts a 22:00–06:00 shift as 9 hours when the clocks go back", () => {
    // Sydney leaves daylight saving at 03:00 on 5 April 2026 → the night is longer.
    const night = s({ date: "2026-04-04", start: "22:00", end: "06:00", rate: 30 });
    expect(reportShiftHours(night)).toBe(9);
    expect(rosterCostSummary([night]).totalCost).toBe(270);
  });

  it("counts the same shift as 7 hours when the clocks go forward", () => {
    // Sydney enters daylight saving at 02:00 on 4 October 2026 → the night is shorter.
    const night = s({ date: "2026-10-03", start: "22:00", end: "06:00", rate: 30 });
    expect(reportShiftHours(night)).toBe(7);
    expect(rosterCostSummary([night]).totalCost).toBe(210);
  });

  it("never assumes 8 hours for either", () => {
    const back = s({ date: "2026-04-04", start: "22:00", end: "06:00" });
    const forward = s({ date: "2026-10-03", start: "22:00", end: "06:00" });
    expect(reportShiftHours(back)).not.toBe(8);
    expect(reportShiftHours(forward)).not.toBe(8);
  });
});

describe("unfilled positions cost nothing but are never hidden (M10 §8)", () => {
  const shifts = [
    s({ date: "2026-08-03", start: "09:00", end: "17:00", rate: 30 }),
    unfilled({ date: "2026-08-03", start: "17:00", end: "23:00" }),
    unfilled({ date: "2026-08-05", start: "17:00", end: "23:00" }),
    unfilled({ date: "2026-08-06", start: "17:00", end: "23:00" }),
  ];

  it("reports the count and the uncovered hours alongside the cost", () => {
    const summary = rosterCostSummary(shifts, PERIOD);
    expect(summary.totalCost).toBe(240); // one filled shift only
    expect(summary.shiftCount).toBe(1);
    expect(summary.unfilledCount).toBe(3);
    expect(summary.unfilledHours).toBe(18);
  });

  it("surfaces the gaps on the day they fall, so a cheap-looking day is not trusted", () => {
    const days = costByDay(shifts, PERIOD);
    const wed = days.find((d) => d.date === "2026-08-05");
    expect(wed?.cost).toBe(0);
    expect(wed?.unfilledCount).toBe(1);
    expect(wed?.unfilledHours).toBe(6);
  });

  it("keeps unfilled positions out of the by-person ranking (nobody is on them)", () => {
    const people = costByPerson(shifts);
    expect(people).toHaveLength(1);
    expect(people[0].shiftCount).toBe(1);
  });

  it("counts unfilled positions in the by-role and by-location breakdowns", () => {
    expect(costByRole(shifts)[0].unfilledCount).toBe(3);
    expect(costByLocation(shifts)[0].unfilledCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// The reconciliation invariants (M10 §9)
// ---------------------------------------------------------------------------

const ROSTER: ReportShift[] = [
  // Week 1
  s({ date: "2026-08-03", start: "09:00", end: "16:15", user: "u_amina", name: "Amina", role: "role_foh", rate: 29.5 }),
  s({ date: "2026-08-04", start: "09:00", end: "16:15", user: "u_amina", name: "Amina", role: "role_foh", rate: 29.5 }),
  s({ date: "2026-08-05", start: "16:00", end: "23:30", user: "u_bilal", name: "Bilal", role: "role_kitchen", rate: 34.75, breakMinutes: 20 }),
  s({ date: "2026-08-07", start: "22:00", end: "06:00", user: "u_chen", name: "Chen", role: "role_kitchen", rate: 31.2, location: "loc_west" }),
  unfilled({ date: "2026-08-08", start: "17:00", end: "23:00", role: "role_foh" }),
  // Week 2
  s({ date: "2026-08-10", start: "09:00", end: "16:15", user: "u_amina", name: "Amina", role: "role_foh", rate: 29.5 }),
  s({ date: "2026-08-12", start: "11:45", end: "19:20", user: "u_bilal", name: "Bilal", role: "role_kitchen", rate: 34.75 }),
  s({ date: "2026-08-14", start: "16:00", end: "23:45", user: "u_chen", name: "Chen", role: "role_kitchen", rate: 31.2, location: "loc_west", breakMinutes: 45 }),
];

const summary = rosterCostSummary(ROSTER, PERIOD);
const sum = (xs: readonly number[]): number => Number(xs.reduce((a, b) => a + b, 0).toFixed(2));

describe("every breakdown reconciles to the same period total (M10 §9)", () => {
  it("by day", () => {
    expect(sum(costByDay(ROSTER, PERIOD).map((d) => d.cost))).toBe(summary.totalCost);
    expect(sum(costByDay(ROSTER, PERIOD).map((d) => d.hours))).toBe(summary.totalHours);
  });

  it("by week", () => {
    const weeks = costByWeek(ROSTER, PERIOD);
    expect(weeks).toHaveLength(2);
    expect(sum(weeks.map((w) => w.cost))).toBe(summary.totalCost);
    expect(sum(weeks.map((w) => w.hours))).toBe(summary.totalHours);
    expect(summary.weeks).toEqual(weeks); // the fortnight comparison, M10 §3.1
  });

  it("by person", () => {
    expect(sum(costByPerson(ROSTER).map((p) => p.cost))).toBe(summary.totalCost);
    expect(sum(costByPerson(ROSTER).map((p) => p.hours))).toBe(summary.totalHours);
  });

  it("by role", () => {
    expect(sum(costByRole(ROSTER).map((r) => r.cost))).toBe(summary.totalCost);
    expect(sum(costByRole(ROSTER).map((r) => r.hours))).toBe(summary.totalHours);
  });

  it("by location", () => {
    expect(sum(costByLocation(ROSTER).map((l) => l.cost))).toBe(summary.totalCost);
    expect(sum(costByLocation(ROSTER).map((l) => l.hours))).toBe(summary.totalHours);
  });

  it("counts every shift and every unfilled position exactly once in each view", () => {
    const views = [
      costByDay(ROSTER, PERIOD),
      costByWeek(ROSTER, PERIOD),
      costByRole(ROSTER),
      costByLocation(ROSTER),
    ];
    for (const rows of views) {
      expect(rows.reduce((n, r) => n + r.shiftCount, 0)).toBe(summary.shiftCount);
      expect(rows.reduce((n, r) => n + r.unfilledCount, 0)).toBe(summary.unfilledCount);
    }
  });

  it("shares of the by-role breakdown add to 100%", () => {
    expect(sum(costByRole(ROSTER).map((r) => r.share))).toBeCloseTo(1, 3);
  });
});

describe("a column total equals the sum of its rows AS SHOWN (M10 §9)", () => {
  // Three shifts of exactly $213.875. Rounded once, the total is $641.63; each
  // row naively rounded to $213.88 would add to $641.64 — the off-by-cents
  // column M10 §2 warns about.
  const awkward = [
    s({ date: "2026-08-03", start: "09:00", end: "16:15", rate: 29.5, user: "u_a", name: "A" }),
    s({ date: "2026-08-04", start: "09:00", end: "16:15", rate: 29.5, user: "u_b", name: "B" }),
    s({ date: "2026-08-05", start: "09:00", end: "16:15", rate: 29.5, user: "u_c", name: "C" }),
  ];

  it("computes the total from unrounded values, rounded once", () => {
    expect(rosterCostSummary(awkward).totalCost).toBe(641.63);
    expect(roundMoney(213.875) * 3).toBe(641.64); // what the naive sum would give
  });

  it("makes the displayed day rows add up to the displayed total", () => {
    const rows = costByDay(awkward).map((d) => d.cost);
    expect(sum(rows)).toBe(641.63);
    // No row is misstated by more than a cent.
    for (const r of rows) expect(Math.abs(r - 213.875)).toBeLessThanOrEqual(0.01);
  });

  it("makes the displayed person rows add up to the displayed total", () => {
    expect(sum(costByPerson(awkward).map((p) => p.cost))).toBe(641.63);
  });
});

describe("allocateRounded", () => {
  it("returns rows that sum exactly to the total", () => {
    const values = [213.875, 213.875, 213.875];
    const rows = allocateRounded(values, 641.63);
    expect(sum(rows)).toBe(641.63);
  });

  it("puts the residual on the largest row", () => {
    expect(allocateRounded([100.005, 1.005], 101.01)).toEqual([100.01, 1]);
  });

  it("is a no-op on an empty column and on an exact column", () => {
    expect(allocateRounded([], 0)).toEqual([]);
    expect(allocateRounded([10, 20, 30], 60)).toEqual([10, 20, 30]);
  });

  it("handles a total that needs more than one row's worth of adjustment", () => {
    const rows = allocateRounded([1, 1, 1], 3.05);
    expect(sum(rows)).toBe(3.05);
  });
});

describe("summary figures (M10 §3.1)", () => {
  it("reports shifts, people, hours and the average $/hour", () => {
    expect(summary.shiftCount).toBe(7);
    expect(summary.peopleCount).toBe(3);
    expect(summary.unfilledCount).toBe(1);
    expect(summary.averageHourlyRate).toBe(roundMoney(summary.totalCost / summary.totalHours));
  });

  it("has no week comparison for a single-week period", () => {
    expect(rosterCostSummary(ROSTER, { startDate: "2026-08-03", days: 7 }).weeks).toEqual([]);
    expect(rosterCostSummary(ROSTER).weeks).toEqual([]);
  });

  it("reports zeroes, not NaN, for an empty period", () => {
    const empty = rosterCostSummary([], PERIOD);
    expect(empty.totalCost).toBe(0);
    expect(empty.totalHours).toBe(0);
    expect(empty.averageHourlyRate).toBe(0);
    expect(empty.peopleCount).toBe(0);
    expect(costByDay([], PERIOD)).toHaveLength(14);
    expect(costByPerson([])).toEqual([]);
    expect(costByRole([])).toEqual([]);
  });
});

describe("ranking (M10 §3.3, §3.4)", () => {
  it("ranks people highest cost to lowest", () => {
    const people = costByPerson(ROSTER);
    for (let i = 1; i < people.length; i += 1) {
      expect(people[i - 1].cost).toBeGreaterThanOrEqual(people[i].cost);
    }
  });

  it("ranks roles highest cost to lowest and reports each one's share", () => {
    const roles = costByRole(ROSTER);
    expect(roles[0].cost).toBeGreaterThanOrEqual(roles[1].cost);
    expect(roles[0].share).toBeGreaterThan(0);
  });
});

describe("filters apply consistently across every view (M10 §5)", () => {
  it("narrows to one location and every view agrees on the smaller total", () => {
    const west = filterShifts(ROSTER, { locationId: "loc_west" });
    const westSummary = rosterCostSummary(west, PERIOD);
    expect(westSummary.shiftCount).toBe(2);
    expect(sum(costByDay(west, PERIOD).map((d) => d.cost))).toBe(westSummary.totalCost);
    expect(sum(costByPerson(west).map((p) => p.cost))).toBe(westSummary.totalCost);
    expect(sum(costByRole(west).map((r) => r.cost))).toBe(westSummary.totalCost);
    expect(costByLocation(west)).toHaveLength(1);
  });

  it("narrows to one role for the by-person view", () => {
    const foh = filterShifts(ROSTER, { roleId: "role_foh" });
    // Three filled FOH shifts plus one unfilled FOH position.
    expect(foh).toHaveLength(4);
    expect(costByPerson(foh)).toHaveLength(1);
  });

  it("treats null/undefined as no filter at all", () => {
    expect(filterShifts(ROSTER, { locationId: null, roleId: null })).toHaveLength(ROSTER.length);
    expect(filterShifts(ROSTER)).toHaveLength(ROSTER.length);
  });
});

describe("costByDay padding", () => {
  it("emits one row per day of the period, including quiet days", () => {
    const days = costByDay(ROSTER, PERIOD);
    expect(days).toHaveLength(14);
    expect(days[0].date).toBe("2026-08-03");
    expect(days[13].date).toBe("2026-08-16");
    expect(days.filter((d) => d.cost === 0 && d.unfilledCount === 0).length).toBeGreaterThan(0);
  });

  it("still shows a shift that falls outside the stated period, so the column adds up", () => {
    const strays = [...ROSTER, s({ date: "2026-09-01", start: "09:00", end: "17:00", user: "u_amina", name: "Amina" })];
    const days = costByDay(strays, PERIOD);
    expect(days.some((d) => d.date === "2026-09-01")).toBe(true);
    expect(sum(days.map((d) => d.cost))).toBe(rosterCostSummary(strays, PERIOD).totalCost);
  });
});
