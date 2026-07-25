import { describe, expect, it } from "vitest";
import { resolveAvailability } from "../../src/lib/domain/availability";

const open10to2230 = { isOpen: true, is24h: false, opensAt: "10:00", closesAt: "22:30" };

describe("resolveAvailability — resolution order (M3 §3.3)", () => {
  it("defaults to available (whole open day) with isSet=false when nothing is set", () => {
    const r = resolveAvailability({ trading: open10to2230 });
    expect(r).toMatchObject({ available: true, isSet: false, source: "default" });
    expect(r.windows).toEqual([{ from: "10:00", to: "22:30" }]);
  });

  it("uses the weekly pattern when no exception exists", () => {
    const r = resolveAvailability({
      pattern: { isAvailable: true, from: "16:00", to: "23:00" },
      trading: open10to2230,
    });
    expect(r.source).toBe("pattern");
    expect(r.windows).toEqual([{ from: "16:00", to: "22:30" }]); // clipped to close
  });

  it("an unavailable pattern day yields no window", () => {
    const r = resolveAvailability({
      pattern: { isAvailable: false, from: null, to: null },
      trading: open10to2230,
    });
    expect(r).toMatchObject({ available: false, source: "pattern" });
    expect(r.windows).toEqual([]);
  });

  it("an exception overrides the pattern entirely (unavailable wins)", () => {
    const r = resolveAvailability({
      pattern: { isAvailable: true, from: null, to: null },
      exception: { isAvailable: false, from: null, to: null },
      trading: open10to2230,
    });
    expect(r).toMatchObject({ available: false, source: "exception" });
  });

  it("an exception can make a normally-off day available this once", () => {
    const r = resolveAvailability({
      pattern: { isAvailable: false, from: null, to: null },
      exception: { isAvailable: true, from: "12:00", to: "18:00" },
      trading: open10to2230,
    });
    expect(r.source).toBe("exception");
    expect(r.windows).toEqual([{ from: "12:00", to: "18:00" }]);
  });
});

describe("resolveAvailability — trading-hours intersection (M3 §7)", () => {
  it("availability entirely outside trading hours resolves to nothing", () => {
    const r = resolveAvailability({
      pattern: { isAvailable: true, from: "06:00", to: "09:00" },
      trading: open10to2230,
    });
    expect(r.available).toBe(false);
    expect(r.windows).toEqual([]);
  });

  it("a closed day yields no window even when the person is available", () => {
    const r = resolveAvailability({
      pattern: { isAvailable: true, from: null, to: null },
      trading: { isOpen: false, is24h: false, opensAt: null, closesAt: null },
    });
    expect(r.available).toBe(false);
  });

  it("a 24-hour day exposes the person's full window", () => {
    const r = resolveAvailability({
      pattern: { isAvailable: true, from: "22:00", to: "24:00" },
      trading: { isOpen: true, is24h: true, opensAt: null, closesAt: null },
    });
    expect(r.windows).toEqual([{ from: "22:00", to: "24:00" }]);
  });

  it("an overnight trading window is clamped to midnight on the start day", () => {
    const r = resolveAvailability({
      pattern: { isAvailable: true, from: null, to: null },
      trading: { isOpen: true, is24h: false, opensAt: "18:00", closesAt: "02:00" },
    });
    expect(r.windows).toEqual([{ from: "18:00", to: "24:00" }]);
  });
});

describe("resolveAvailability — DST safety (M3 §8)", () => {
  it("a wall-clock window is identical regardless of any DST change", () => {
    // Pure string arithmetic on wall-clock times — no instant math — so the
    // same inputs always give the same window, on a DST date or not.
    const input = {
      pattern: { isAvailable: true, from: "16:00", to: "23:00" },
      trading: { isOpen: true, is24h: false, opensAt: "10:00", closesAt: "23:00" },
    };
    expect(resolveAvailability(input).windows).toEqual([{ from: "16:00", to: "23:00" }]);
  });
});
