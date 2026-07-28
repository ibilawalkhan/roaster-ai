import { describe, expect, it } from "vitest";
import {
  calendarLabel,
  describeShiftDays,
  describeUpdatedAgo,
  formatDuration,
  groupUpcomingByWeek,
  nextShift,
  pastShifts,
  periodTotals,
  relativeDayLabel,
  shiftPaidHours,
  sortShifts,
  startOfWeekISO,
  upcomingShifts,
  type MyShift,
} from "../../src/lib/domain/my-roster";

const SYDNEY = "Australia/Sydney";

let seq = 0;
function shift(partial: Partial<MyShift> & Pick<MyShift, "date" | "startAt" | "endAt">): MyShift {
  seq += 1;
  return {
    id: `shift-${seq}`,
    rosterId: "roster-1",
    breakMinutes: 0,
    roleId: "role-kitchen",
    locationId: "loc-regents-park",
    status: "assigned",
    payRateSnapshot: null,
    note: null,
    ...partial,
  };
}

/** Fri 7 Aug 2026, 16:00–23:00 Sydney (AEST +10) with a 30-minute break. */
const fridayEvening = shift({
  id: "fri-evening",
  date: "2026-08-07",
  startAt: "2026-08-07T06:00:00.000Z",
  endAt: "2026-08-07T13:00:00.000Z",
  breakMinutes: 30,
});

/** Sat 8 Aug 2026, 09:00–17:00 Sydney. */
const saturdayDay = shift({
  id: "sat-day",
  date: "2026-08-08",
  startAt: "2026-08-07T23:00:00.000Z",
  endAt: "2026-08-08T07:00:00.000Z",
});

/** Mon 10 Aug 2026, 09:00–17:00 Sydney — the following week. */
const mondayNextWeek = shift({
  id: "mon-next",
  date: "2026-08-10",
  startAt: "2026-08-09T23:00:00.000Z",
  endAt: "2026-08-10T07:00:00.000Z",
});

describe("nextShift — the one question the staff app answers (M7 §1)", () => {
  it("returns the earliest shift that has not finished, whatever order it was given in", () => {
    const now = new Date("2026-08-06T00:00:00.000Z");
    expect(nextShift([mondayNextWeek, saturdayDay, fridayEvening], now)?.id).toBe("fri-evening");
  });

  it("keeps a shift already IN PROGRESS as the next shift", () => {
    // 08:00Z is two hours into the Friday evening shift.
    const now = new Date("2026-08-07T08:00:00.000Z");
    expect(nextShift([fridayEvening, saturdayDay], now)?.id).toBe("fri-evening");
  });

  it("moves on once the shift has finished", () => {
    const now = new Date("2026-08-07T13:00:01.000Z");
    expect(nextShift([fridayEvening, saturdayDay], now)?.id).toBe("sat-day");
  });

  it("returns null when nothing is upcoming (the empty state, M7 §7)", () => {
    const now = new Date("2026-09-01T00:00:00.000Z");
    expect(nextShift([fridayEvening, saturdayDay], now)).toBeNull();
  });

  it("returns null for no shifts at all (new starter)", () => {
    expect(nextShift([], new Date("2026-08-06T00:00:00.000Z"))).toBeNull();
  });
});

describe("sorting and splitting", () => {
  it("sorts chronologically without mutating the caller's array", () => {
    const input = [mondayNextWeek, fridayEvening];
    const sorted = sortShifts(input);
    expect(sorted.map((s) => s.id)).toEqual(["fri-evening", "mon-next"]);
    expect(input.map((s) => s.id)).toEqual(["mon-next", "fri-evening"]);
  });

  it("splits upcoming from past, past newest-first", () => {
    const now = new Date("2026-08-08T00:00:00.000Z");
    const all = [fridayEvening, saturdayDay, mondayNextWeek];
    expect(upcomingShifts(all, now).map((s) => s.id)).toEqual(["sat-day", "mon-next"]);
    expect(pastShifts(all, now).map((s) => s.id)).toEqual(["fri-evening"]);
  });
});

describe("groupUpcomingByWeek", () => {
  it("groups by the business week (Monday by default) and orders weeks", () => {
    const groups = groupUpcomingByWeek([mondayNextWeek, fridayEvening, saturdayDay]);
    expect(groups.map((g) => g.weekStart)).toEqual(["2026-08-03", "2026-08-10"]);
    expect(groups[0].weekEnd).toBe("2026-08-09");
    expect(groups[0].shifts.map((s) => s.id)).toEqual(["fri-evening", "sat-day"]);
    expect(groups[1].shifts.map((s) => s.id)).toEqual(["mon-next"]);
  });

  it("honours a Sunday-start business week", () => {
    const groups = groupUpcomingByWeek([fridayEvening, saturdayDay, mondayNextWeek], 0);
    expect(groups.map((g) => g.weekStart)).toEqual(["2026-08-02", "2026-08-09"]);
    // With a Sunday start, Sunday 9 Aug's week already contains Monday 10 Aug.
    expect(groups[1].shifts.map((s) => s.id)).toEqual(["mon-next"]);
  });

  it("emits no groups for no shifts", () => {
    expect(groupUpcomingByWeek([])).toEqual([]);
  });

  it("startOfWeekISO snaps to the week start", () => {
    expect(startOfWeekISO("2026-08-07")).toBe("2026-08-03"); // Fri → Mon
    expect(startOfWeekISO("2026-08-03")).toBe("2026-08-03"); // Mon → itself
    expect(startOfWeekISO("2026-08-09")).toBe("2026-08-03"); // Sun → the Mon before
  });
});

describe("hours and estimated pay (CLAUDE.md rule 5 — estimates, never payroll)", () => {
  it("subtracts the unpaid break", () => {
    expect(shiftPaidHours(fridayEvening)).toBe(6.5);
    expect(shiftPaidHours(saturdayDay)).toBe(8);
  });

  it("totals hours and pay at the fallback rate", () => {
    const totals = periodTotals([fridayEvening, saturdayDay], 30);
    expect(totals.shiftCount).toBe(2);
    expect(totals.hours).toBe(14.5);
    expect(totals.estimatedPay).toBe(435);
  });

  it("prefers each shift's frozen rate snapshot over the current rate", () => {
    const snapshotted = { ...fridayEvening, payRateSnapshot: 40 };
    // 6.5h at the snapshot (40) + 8h at the current rate (30) = 260 + 240.
    expect(periodTotals([snapshotted, saturdayDay], 30).estimatedPay).toBe(500);
  });

  it("sums in full precision and rounds once, never the sum of rounded parts", () => {
    // Three 20-minute shifts are 1/3 h each: rounding each to 0.33 would total
    // 0.99 h, but the honest total is a full hour.
    const third = (id: string, startAt: string, endAt: string): MyShift =>
      shift({ id, date: "2026-08-07", startAt, endAt });
    const totals = periodTotals(
      [
        third("a", "2026-08-07T06:00:00.000Z", "2026-08-07T06:20:00.000Z"),
        third("b", "2026-08-07T07:00:00.000Z", "2026-08-07T07:20:00.000Z"),
        third("c", "2026-08-07T08:00:00.000Z", "2026-08-07T08:20:00.000Z"),
      ],
      30,
    );
    expect(totals.hours).toBe(1);
    expect(totals.estimatedPay).toBe(30);
  });

  it("is honest across a daylight-saving change (M5 §10)", () => {
    // Sat 4 Apr 2026 22:00 AEDT (+11) → Sun 5 Apr 06:00 AEST (+10): the clocks go
    // back, so this is a NINE-hour shift, not eight.
    const dstNight = shift({
      id: "dst",
      date: "2026-04-04",
      startAt: "2026-04-04T11:00:00.000Z",
      endAt: "2026-04-04T20:00:00.000Z",
      breakMinutes: 30,
    });
    expect(shiftPaidHours(dstNight)).toBe(8.5);
    expect(periodTotals([dstNight], 30).hours).toBe(8.5);
  });

  it("totals to zero for an empty period", () => {
    expect(periodTotals([], 30)).toEqual({ shiftCount: 0, hours: 0, estimatedPay: 0 });
  });
});

describe("describeShiftDays — honest labels in the BUSINESS timezone (M7 §7)", () => {
  it("shows a plain time range for a same-day shift", () => {
    const d = describeShiftDays(fridayEvening, SYDNEY);
    expect(d.label).toBe("16:00 – 23:00");
    expect(d.crossesMidnight).toBe(false);
    expect(d.startDate).toBe("2026-08-07");
    expect(d.endDate).toBe("2026-08-07");
  });

  it("names BOTH days for an overnight shift so nobody misreads the finish day", () => {
    // Fri 7 Aug 22:00 → Sat 8 Aug 06:00 Sydney (AEST).
    const overnight = shift({
      id: "overnight",
      date: "2026-08-07",
      startAt: "2026-08-07T12:00:00.000Z",
      endAt: "2026-08-07T20:00:00.000Z",
    });
    const d = describeShiftDays(overnight, SYDNEY);
    expect(d.label).toBe("Fri 22:00 – Sat 06:00");
    expect(d.crossesMidnight).toBe(true);
    expect(d.startDate).toBe("2026-08-07");
    expect(d.endDate).toBe("2026-08-08");
  });

  it("renders in the business timezone, not the device's", () => {
    // The same instant reads 16:00 in Sydney and 06:00 in London.
    expect(describeShiftDays(fridayEvening, SYDNEY).startTime).toBe("16:00");
    expect(describeShiftDays(fridayEvening, "Europe/London").startTime).toBe("07:00");
  });

  it("labels an overnight shift across the DST change correctly", () => {
    const dstNight = shift({
      id: "dst-label",
      date: "2026-04-04",
      startAt: "2026-04-04T11:00:00.000Z",
      endAt: "2026-04-04T20:00:00.000Z",
    });
    expect(describeShiftDays(dstNight, SYDNEY).label).toBe("Sat 22:00 – Sun 06:00");
  });
});

describe("day labels", () => {
  it('says "Today" and "Tomorrow" where they apply', () => {
    expect(relativeDayLabel("2026-08-07", "2026-08-07")).toBe("Today");
    expect(relativeDayLabel("2026-08-08", "2026-08-07")).toBe("Tomorrow");
    expect(relativeDayLabel("2026-08-09", "2026-08-07")).toBeNull();
    expect(relativeDayLabel("2026-08-06", "2026-08-07")).toBeNull();
  });

  it("rolls Tomorrow over a month boundary", () => {
    expect(relativeDayLabel("2026-09-01", "2026-08-31")).toBe("Tomorrow");
  });

  it("formats a calendar date the way a roster reads", () => {
    expect(calendarLabel("2026-08-07")).toBe("Fri 7 Aug");
    expect(calendarLabel("2026-12-25")).toBe("Fri 25 Dec");
  });
});

describe("formatDuration", () => {
  it("reads at a glance", () => {
    expect(formatDuration(6.5)).toBe("6h 30m");
    expect(formatDuration(7)).toBe("7h");
    expect(formatDuration(0.75)).toBe("45m");
    expect(formatDuration(0)).toBe("0m");
  });

  it("never shows negative time", () => {
    expect(formatDuration(-3)).toBe("0m");
  });
});

describe("describeUpdatedAgo — stale data must never look current (M7 §5)", () => {
  const now = new Date("2026-08-07T12:00:00.000Z");

  it("describes the age of the cached roster", () => {
    expect(describeUpdatedAgo("2026-08-07T11:59:30.000Z", now)).toBe("just now");
    expect(describeUpdatedAgo("2026-08-07T11:59:00.000Z", now)).toBe("1 minute ago");
    expect(describeUpdatedAgo("2026-08-07T11:30:00.000Z", now)).toBe("30 minutes ago");
    expect(describeUpdatedAgo("2026-08-07T10:00:00.000Z", now)).toBe("2 hours ago");
    expect(describeUpdatedAgo("2026-08-04T12:00:00.000Z", now)).toBe("3 days ago");
  });

  it("never reads as older than it is when the device clock is ahead", () => {
    expect(describeUpdatedAgo("2026-08-07T12:05:00.000Z", now)).toBe("just now");
  });

  it("returns null for an unusable timestamp so the caller omits the line", () => {
    expect(describeUpdatedAgo("not-a-date", now)).toBeNull();
  });
});
