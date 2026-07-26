import { describe, expect, it } from "vitest";
import {
  crossesMidnight,
  paidHours,
  roundHours,
  roundMoney,
  shiftCost,
  spanMinutes,
} from "../../src/lib/domain/cost";

describe("paidHours — M10 §2 formula", () => {
  it("subtracts the break from wall-clock time", () => {
    // 09:00–17:00 is 8h; a 30-minute break leaves 7.5h.
    expect(paidHours({ start: "09:00", end: "17:00", breakMinutes: 30 })).toBe(7.5);
  });

  it("defaults the break to zero", () => {
    expect(paidHours({ start: "16:00", end: "23:00" })).toBe(7);
  });

  it("handles an overnight shift (end ≤ start ⇒ +24h)", () => {
    // 22:00–06:00 spans 8h; less a 30-min break = 7.5h.
    expect(paidHours({ start: "22:00", end: "06:00", breakMinutes: 30 })).toBe(7.5);
    expect(spanMinutes("22:00", "06:00")).toBe(480);
    expect(crossesMidnight("22:00", "06:00")).toBe(true);
  });

  it("treats equal start and end as a full 24-hour span, not zero", () => {
    expect(spanMinutes("06:00", "06:00")).toBe(1440);
  });

  it("never returns negative hours when the break exceeds the shift", () => {
    expect(paidHours({ start: "12:00", end: "13:00", breakMinutes: 90 })).toBe(0);
  });

  it("does not flag a same-day shift as overnight", () => {
    expect(crossesMidnight("09:00", "17:00")).toBe(false);
  });
});

describe("shiftCost + round-at-display (M10 §2)", () => {
  it("multiplies full-precision hours by the rate", () => {
    // 7h 15m at $29.50 = 7.25 × 29.5 = 213.875 (kept in full precision).
    const hours = paidHours({ start: "09:00", end: "16:15" });
    expect(hours).toBeCloseTo(7.25, 10);
    expect(shiftCost(hours, 29.5)).toBeCloseTo(213.875, 10);
  });

  it("rounds only at display: a total is the sum of unrounded parts, rounded once", () => {
    // Three shifts of 213.875 each. Summing then rounding gives 641.63;
    // rounding each first (213.88 × 3 = 641.64) would drift by a cent.
    const each = 213.875;
    const totalThenRound = roundMoney(each * 3);
    const roundThenTotal = roundMoney(each) * 3;
    expect(totalThenRound).toBe(641.63);
    expect(roundThenTotal).toBe(641.64);
    expect(totalThenRound).not.toBe(roundThenTotal);
  });

  it("rounds hours to two decimals for display", () => {
    expect(roundHours(7.25)).toBe(7.25);
    expect(roundHours(7.336)).toBe(7.34);
  });
});

describe("weekly template cost aggregation — round once, not per shift (M4 §5.4 / M10 §2)", () => {
  // Mirrors the template page's aggregation loop: for each slot it accumulates
  // shiftCost(paidHours × count, rate) in FULL precision, then rounds the total
  // ONCE at display. Includes an overnight slot so cross-midnight hours flow
  // through the same summation.
  interface SlotCost {
    start: string;
    end: string;
    count: number;
    rate: number;
  }

  function weeklyTotal(slots: SlotCost[]): number {
    let total = 0;
    for (const s of slots) {
      const h = paidHours({ start: s.start, end: s.end });
      total += shiftCost(h * s.count, s.rate);
    }
    return total;
  }

  const slots: SlotCost[] = [
    { start: "09:00", end: "16:15", count: 1, rate: 29.5 }, // 7.25h → 213.875
    { start: "22:00", end: "06:15", count: 1, rate: 29.5 }, // overnight 8.25h → 243.375
    { start: "16:00", end: "23:15", count: 1, rate: 29.5 }, // 7.25h → 213.875
  ];

  it("sums unrounded shift costs (overnight included) then rounds once", () => {
    const raw = weeklyTotal(slots);
    expect(raw).toBeCloseTo(671.125, 10); // 213.875 + 243.375 + 213.875
    expect(roundMoney(raw)).toBe(671.13); // 671.125 → 671.13, rounded once
  });

  it("differs from rounding each shift first — proving the invariant matters", () => {
    const roundThenSum = slots.reduce(
      (sum, s) => sum + roundMoney(shiftCost(paidHours({ start: s.start, end: s.end }) * s.count, s.rate)),
      0,
    );
    expect(roundMoney(roundThenSum)).toBe(671.14); // 213.88 + 243.38 + 213.88 — drifts a cent
    expect(roundMoney(weeklyTotal(slots))).not.toBe(roundMoney(roundThenSum));
  });

  it("multiplies span × count for a slot's hours (overnight ×2)", () => {
    // 22:00–06:00 = 8h; two people = 16h.
    const h = paidHours({ start: "22:00", end: "06:00" });
    expect(h * 2).toBe(16);
  });
});
