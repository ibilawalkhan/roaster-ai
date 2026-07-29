import { describe, expect, it } from "vitest";
import {
  classifySwapError,
  dropWindow,
  isUncoveredSoon,
  managerStatusLabel,
  staffStatusHeadline,
  swapErrorMessage,
  DEFAULT_DROP_CUTOFF_HOURS,
  STILL_ROSTERED_NOTICE,
} from "../../src/lib/domain/swaps";

// Friday 7 Aug 2026, 18:00 Sydney = 08:00 UTC (UTC+10, no daylight saving).
const SHIFT_START = "2026-08-07T08:00:00.000Z";
const at = (iso: string): Date => new Date(iso);

describe("dropWindow — the 4-hour cutoff (M8 §3.1)", () => {
  it("allows a request comfortably before the shift", () => {
    const w = dropWindow(SHIFT_START, at("2026-08-06T08:00:00.000Z"));
    expect(w.canRequest).toBe(true);
    expect(w.withinCutoff).toBe(false);
    expect(w.started).toBe(false);
    expect(w.reason).toBeNull();
    expect(w.hoursUntilStart).toBeCloseTo(24, 5);
  });

  it("refuses inside the cutoff and tells them to phone, never a dead end", () => {
    // Three hours out — inside the four-hour default.
    const w = dropWindow(SHIFT_START, at("2026-08-07T05:00:00.000Z"));
    expect(w.canRequest).toBe(false);
    expect(w.withinCutoff).toBe(true);
    expect(w.reason).toMatch(/phone your manager/i);
    expect(w.reason).toContain("3 hours");
  });

  it("treats the boundary itself as still allowed", () => {
    // Exactly four hours out: the rule is "inside the window", not "at it".
    const w = dropWindow(SHIFT_START, at("2026-08-07T04:00:00.000Z"));
    expect(w.hoursUntilStart).toBeCloseTo(DEFAULT_DROP_CUTOFF_HOURS, 5);
    expect(w.canRequest).toBe(true);
  });

  it("a minute inside the boundary is refused", () => {
    const w = dropWindow(SHIFT_START, at("2026-08-07T04:01:00.000Z"));
    expect(w.canRequest).toBe(false);
    expect(w.withinCutoff).toBe(true);
  });

  it("says 'minutes' rather than rounding an hour up into a lie", () => {
    const w = dropWindow(SHIFT_START, at("2026-08-07T07:15:00.000Z"));
    expect(w.reason).toContain("45 minutes");
  });

  it("a shift already under way is not an app problem", () => {
    const w = dropWindow(SHIFT_START, at("2026-08-07T09:00:00.000Z"));
    expect(w.started).toBe(true);
    expect(w.canRequest).toBe(false);
    expect(w.reason).toMatch(/already started/i);
    expect(w.hoursUntilStart).toBeLessThan(0);
  });

  it("honours a business-specific cutoff", () => {
    // A 12-hour cutoff refuses what the 4-hour default would allow.
    const eightHoursOut = at("2026-08-07T00:00:00.000Z");
    expect(dropWindow(SHIFT_START, eightHoursOut).canRequest).toBe(true);
    expect(dropWindow(SHIFT_START, eightHoursOut, 12).canRequest).toBe(false);
    // A zero cutoff means "any time before it starts".
    expect(dropWindow(SHIFT_START, at("2026-08-07T07:59:00.000Z"), 0).canRequest).toBe(true);
  });

  it("refuses rather than acting on an unreadable start time", () => {
    const w = dropWindow("not-a-date", at("2026-08-01T00:00:00.000Z"));
    expect(w.canRequest).toBe(false);
    expect(w.reason).toMatch(/manager/i);
  });
});

describe("isUncoveredSoon (M8 §7)", () => {
  it("flags an open shift inside the default 12-hour lead time", () => {
    expect(isUncoveredSoon(SHIFT_START, at("2026-08-06T23:00:00.000Z"))).toBe(true);
  });

  it("leaves a shift further out alone", () => {
    expect(isUncoveredSoon(SHIFT_START, at("2026-08-06T12:00:00.000Z"))).toBe(false);
  });

  it("still flags a shift that has already started — it is the most urgent case", () => {
    expect(isUncoveredSoon(SHIFT_START, at("2026-08-07T09:00:00.000Z"))).toBe(true);
  });

  it("never flags on an unreadable start time", () => {
    expect(isUncoveredSoon("", at("2026-08-07T09:00:00.000Z"))).toBe(false);
  });
});

describe("classifySwapError — Postgres exceptions become sentences (M8 §5)", () => {
  // These strings are raised verbatim by supabase/migrations/0007_swaps.sql and
  // 0010_shift_integrity.sql. If a migration changes one, this suite fails —
  // which is the point: the mapping is a contract, not a guess.

  it("the loser of a concurrent approval is told the shift is filled", () => {
    const failure = classifySwapError(new Error("shift is no longer available"));
    expect(failure.kind).toBe("already_filled");
    expect(failure.message).toBe("Sorry, this shift has already been filled.");
    expect(failure.refresh).toBe(true);
  });

  it("claiming a filled shift gives the same plain answer", () => {
    expect(swapErrorMessage(new Error("sorry, this shift has already been filled"))).toBe(
      "Sorry, this shift has already been filled.",
    );
  });

  it("handles a PostgrestError object, which is not an Error instance", () => {
    // supabase-js rejects with a plain object — assuming `instanceof Error`
    // here would silently downgrade every real message to the fallback.
    const failure = classifySwapError({
      message: "shift is no longer available",
      code: "P0001",
      details: null,
      hint: null,
    });
    expect(failure.kind).toBe("already_filled");
  });

  it("maps the manager-only gate to a permission message", () => {
    const failure = classifySwapError(new Error("only a manager can approve a claim"));
    expect(failure.kind).toBe("not_manager");
    expect(failure.message).toMatch(/only a manager can approve cover/i);
  });

  it("maps a decided claim, a foreign shift and a second drop request", () => {
    expect(classifySwapError(new Error("claim is no longer pending")).kind).toBe(
      "claim_decided",
    );
    expect(classifySwapError(new Error("you can only drop your own shift")).kind).toBe(
      "not_owner",
    );
    expect(
      classifySwapError(new Error("this shift already has a cover request in progress")).kind,
    ).toBe("drop_in_progress");
    expect(classifySwapError(new Error("shift not found")).kind).toBe("not_found");
    expect(classifySwapError(new Error("not authenticated")).kind).toBe("not_authenticated");
  });

  it("maps the database's no-double-booking guard (migration 0010)", () => {
    const failure = classifySwapError(
      new Error(
        "shift_no_overlap: this person is already rostered on an overlapping shift (abc starting 2026-08-07)",
      ),
    );
    expect(failure.kind).toBe("overlap");
    expect(failure.message).toMatch(/overlaps this one/i);
  });

  it("maps an RLS refusal to 'nothing was saved'", () => {
    const failure = classifySwapError(new Error("new row violates row-level security policy"));
    expect(failure.kind).toBe("not_permitted");
    expect(failure.message).toMatch(/nothing was saved/i);
  });

  it("falls back without ever claiming the write succeeded or failed", () => {
    const failure = classifySwapError(new Error("TypeError: Failed to fetch"));
    expect(failure.kind).toBe("unknown");
    expect(failure.message).toMatch(/nothing has been confirmed/i);
    // Never leaks the raw text at a person.
    expect(failure.message).not.toMatch(/TypeError/);
  });

  it("survives being handed something that isn't an error at all", () => {
    expect(classifySwapError(undefined).kind).toBe("unknown");
    expect(classifySwapError(null).kind).toBe("unknown");
    expect(classifySwapError("shift is no longer available").kind).toBe("already_filled");
  });
});

describe("labels", () => {
  it("every swap state has a manager label", () => {
    expect(managerStatusLabel("drop_requested")).toBe("Cover requested");
    expect(managerStatusLabel("open")).toBe("Open to team");
    expect(managerStatusLabel("claimed_pending")).toBe("Claimed — needs approval");
    expect(managerStatusLabel("assigned")).toBe("Covered");
  });

  it("a staff member with a request in flight is told they are still on it", () => {
    expect(staffStatusHeadline("drop_requested")).toBe("Cover requested — waiting for manager");
    expect(staffStatusHeadline("open")).not.toBeNull();
    expect(staffStatusHeadline("claimed_pending")).not.toBeNull();
    // Nothing to say about an ordinary shift.
    expect(staffStatusHeadline("assigned")).toBeNull();
  });

  it("the still-rostered notice is exact — this sentence prevents no-shows", () => {
    expect(STILL_ROSTERED_NOTICE).toBe("You're still rostered until your manager confirms.");
  });
});
