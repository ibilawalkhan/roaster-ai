import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEAD_HOURS,
  selectUncoveredAlerts,
  type SweepShift,
} from "../../src/lib/domain/uncovered";

/**
 * M8 §7 / M9 E13 — the safety net for "a shift is never quietly owned by
 * nobody". Clock is injected, so these are deterministic.
 */

const NOW = new Date("2026-08-14T08:00:00Z");

function shift(over: Partial<SweepShift> = {}): SweepShift {
  return {
    id: "s1",
    businessId: "b1",
    status: "open",
    startAt: "2026-08-14T14:00:00Z", // 6 hours away
    alreadyAlerted: false,
    ...over,
  };
}

describe("selectUncoveredAlerts", () => {
  it("alerts on an open shift inside the lead window", () => {
    const alerts = selectUncoveredAlerts([shift()], NOW);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ shiftId: "s1", hoursUntilStart: 6 });
  });

  it("ignores a shift beyond the lead window", () => {
    const far = shift({ startAt: "2026-08-16T14:00:00Z" }); // ~2 days out
    expect(selectUncoveredAlerts([far], NOW)).toEqual([]);
  });

  it("ignores a shift that has already started", () => {
    const past = shift({ startAt: "2026-08-14T07:00:00Z" });
    expect(selectUncoveredAlerts([past], NOW)).toEqual([]);
  });

  it("ignores a settled shift — only unresolved swap states qualify", () => {
    expect(selectUncoveredAlerts([shift({ status: "assigned" })], NOW)).toEqual([]);
  });

  it("covers every unresolved swap state", () => {
    const states = ["open", "claimed_pending", "drop_requested"];
    const shifts = states.map((status, i) => shift({ id: `s${i}`, status }));
    expect(selectUncoveredAlerts(shifts, NOW)).toHaveLength(3);
  });

  it("never alerts twice about the same shift", () => {
    // Without this an hourly sweep would text the manager twelve times about
    // one shift, and they would learn to ignore all of them.
    expect(selectUncoveredAlerts([shift({ alreadyAlerted: true })], NOW)).toEqual([]);
  });

  it("respects a custom lead time", () => {
    // 6 hours away, but only warning 4 hours out.
    expect(selectUncoveredAlerts([shift()], NOW, 4)).toEqual([]);
    expect(selectUncoveredAlerts([shift()], NOW, 8)).toHaveLength(1);
  });

  it("orders soonest first so a truncated run still sends the urgent one", () => {
    const shifts = [
      shift({ id: "later", startAt: "2026-08-14T18:00:00Z" }),
      shift({ id: "sooner", startAt: "2026-08-14T10:00:00Z" }),
    ];
    expect(selectUncoveredAlerts(shifts, NOW).map((a) => a.shiftId)).toEqual([
      "sooner",
      "later",
    ]);
  });

  it("survives a malformed timestamp rather than throwing", () => {
    // A sweep that crashes stops protecting every other shift too.
    const bad = shift({ startAt: "not-a-date" });
    expect(selectUncoveredAlerts([bad, shift({ id: "ok" })], NOW)).toHaveLength(1);
  });

  it("defaults to a twelve-hour lead (M8 §7)", () => {
    expect(DEFAULT_LEAD_HOURS).toBe(12);
  });
});
