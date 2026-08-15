import { describe, expect, it } from "vitest";
import {
  deriveSlotsFromWeek,
  weekdayOf,
  type SourceShift,
} from "../../src/lib/domain/template-from-week";

/**
 * M4 §4.4 — turning a real week back into staffing requirements.
 * The grouping rule is the whole feature: identical role+times collapse into
 * one slot with a count, because that is what a requirement means.
 */

function shift(over: Partial<SourceShift> = {}): SourceShift {
  return {
    locationId: "loc1",
    roleId: "kitchen",
    date: "2026-08-07", // a Friday
    start: "16:00",
    end: "23:00",
    ...over,
  };
}

describe("weekdayOf", () => {
  it("reads a business-local date without timezone drift", () => {
    expect(weekdayOf("2026-08-07")).toBe(5); // Friday
    expect(weekdayOf("2026-08-09")).toBe(0); // Sunday
  });
});

describe("grouping — the core rule", () => {
  it("collapses three identical shifts into one slot of count 3", () => {
    const { slots } = deriveSlotsFromWeek([shift(), shift(), shift()]);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ roleId: "kitchen", start: "16:00", count: 3 });
  });

  it("keeps different times apart", () => {
    const { slots } = deriveSlotsFromWeek([
      shift({ start: "16:00", end: "23:00" }),
      shift({ start: "10:00", end: "18:00" }),
    ]);
    expect(slots).toHaveLength(2);
    expect(slots.every((s) => s.count === 1)).toBe(true);
  });

  it("keeps different roles apart", () => {
    const { slots } = deriveSlotsFromWeek([shift({ roleId: "kitchen" }), shift({ roleId: "foh" })]);
    expect(slots).toHaveLength(2);
  });

  it("keeps different locations apart", () => {
    const { slots } = deriveSlotsFromWeek([shift({ locationId: "a" }), shift({ locationId: "b" })]);
    expect(slots).toHaveLength(2);
  });

  it("keeps different required levels apart", () => {
    const { slots } = deriveSlotsFromWeek([
      shift({ requiredLevel: "senior" }),
      shift({ requiredLevel: null }),
    ]);
    expect(slots).toHaveLength(2);
  });

  it("groups the same weekday across different dates", () => {
    // Two Fridays a fortnight apart are the same weekly requirement.
    const { slots } = deriveSlotsFromWeek([
      shift({ date: "2026-08-07" }),
      shift({ date: "2026-08-14" }),
    ]);
    expect(slots).toHaveLength(1);
    expect(slots[0].count).toBe(2);
  });

  it("normalises HH:MM:SS times from the database", () => {
    const { slots } = deriveSlotsFromWeek([
      shift({ start: "16:00:00", end: "23:00:00" }),
      shift({ start: "16:00", end: "23:00" }),
    ]);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ start: "16:00", end: "23:00", count: 2 });
  });
});

describe("ordering", () => {
  it("reads Monday-first, then by start time", () => {
    const { slots } = deriveSlotsFromWeek([
      shift({ date: "2026-08-09", start: "10:00" }), // Sunday
      shift({ date: "2026-08-03", start: "16:00" }), // Monday late
      shift({ date: "2026-08-03", start: "09:00" }), // Monday early
    ]);
    expect(slots.map((s) => [s.dayOfWeek, s.start])).toEqual([
      [1, "09:00"],
      [1, "16:00"],
      [0, "10:00"], // Sunday last, as the grid shows it
    ]);
  });

  it("is deterministic — the same week always yields the same template", () => {
    const week = [shift({ roleId: "b" }), shift({ roleId: "a" }), shift({ start: "09:00" })];
    expect(deriveSlotsFromWeek(week).slots).toEqual(deriveSlotsFromWeek(week).slots);
  });
});

describe("summary", () => {
  it("reports what was read, so the manager can sanity-check before applying", () => {
    const s = deriveSlotsFromWeek([
      shift(),
      shift(),
      shift({ date: "2026-08-03", roleId: "foh" }),
    ]);
    expect(s).toMatchObject({ shiftsRead: 3, daysCovered: 2, totalPositions: 3 });
    expect(s.slots).toHaveLength(2);
  });

  it("handles an empty week without pretending it found something", () => {
    expect(deriveSlotsFromWeek([])).toMatchObject({
      slots: [],
      shiftsRead: 0,
      daysCovered: 0,
      totalPositions: 0,
    });
  });

  it("never invents a label — a wrong guess is worse than a blank", () => {
    expect(deriveSlotsFromWeek([shift()]).slots[0].label).toBeNull();
  });
});
