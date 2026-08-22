import { describe, expect, it } from "vitest";
import {
  fractionOf,
  headcountSteps,
  hourTicks,
  laneCount,
  minutesOfHHMM,
  packLanes,
  shortClock,
  spanOf,
  timelineDomain,
} from "../../src/lib/domain/day-timeline";

describe("minutesOfHHMM", () => {
  it("parses HH:MM and HH:MM:SS alike", () => {
    expect(minutesOfHHMM("09:30")).toBe(570);
    expect(minutesOfHHMM("09:30:00")).toBe(570);
    expect(minutesOfHHMM("00:00")).toBe(0);
    expect(minutesOfHHMM("23:59")).toBe(1439);
  });
});

describe("spanOf", () => {
  it("measures an ordinary slot", () => {
    expect(spanOf("09:00", "17:00")).toEqual({ startMin: 540, endMin: 1020 });
  });

  it("carries a midnight-crossing slot past 1440 rather than going negative", () => {
    expect(spanOf("22:00", "02:00", true)).toEqual({ startMin: 1320, endMin: 1560 });
  });

  it("infers the wrap when the end is not after the start", () => {
    // The flag and the times disagreeing must not produce a negative duration.
    expect(spanOf("22:00", "02:00", false).endMin).toBe(1560);
    expect(spanOf("18:00", "18:00", false).endMin).toBe(2520); // a full 24h
  });
});

describe("timelineDomain", () => {
  const open = { opensAt: "09:00", closesAt: "22:30", is24h: false };

  it("spans the trading window snapped out to whole hours", () => {
    expect(timelineDomain([], open)).toEqual({ fromMin: 540, toMin: 1380 });
  });

  it("stretches to show a slot that starts before opening", () => {
    // A prep shift starting at 07:15 is either deliberate or a mistake; either
    // way the manager must be able to see it against the trading window.
    const d = timelineDomain([spanOf("07:15", "12:00")], open);
    expect(d.fromMin).toBe(420);
  });

  it("stretches to show a slot running past close", () => {
    const d = timelineDomain([spanOf("20:00", "01:00", true)], open);
    expect(d.toMin).toBe(1500);
  });

  it("covers the whole day when trading is 24h", () => {
    expect(timelineDomain([], { opensAt: "", closesAt: "", is24h: true })).toEqual({
      fromMin: 0,
      toMin: 1440,
    });
  });

  it("handles a venue that trades past midnight", () => {
    const d = timelineDomain([], { opensAt: "17:00", closesAt: "02:00", is24h: false });
    expect(d).toEqual({ fromMin: 1020, toMin: 1560 });
  });

  it("falls back to the slots when a day is open but has no hours recorded", () => {
    const d = timelineDomain([spanOf("10:00", "14:00")], {
      opensAt: null,
      closesAt: null,
      is24h: false,
    });
    expect(d).toEqual({ fromMin: 600, toMin: 840 });
  });

  it("falls back to a sane window when there are neither hours nor slots", () => {
    const d = timelineDomain([], { opensAt: null, closesAt: null, is24h: false });
    expect(d).toEqual({ fromMin: 540, toMin: 1020 });
  });

  it("never draws an axis narrower than four hours", () => {
    const d = timelineDomain([], { opensAt: "11:00", closesAt: "12:00", is24h: false });
    expect(d.toMin - d.fromMin).toBe(240);
  });
});

describe("fractionOf", () => {
  it("maps a minute onto 0–1 across the axis", () => {
    expect(fractionOf(540, 540, 1380)).toBe(0);
    expect(fractionOf(1380, 540, 1380)).toBe(1);
    expect(fractionOf(960, 540, 1380)).toBeCloseTo(0.5, 5);
  });

  it("clamps rather than overflowing the track", () => {
    expect(fractionOf(0, 540, 1380)).toBe(0);
    expect(fractionOf(9999, 540, 1380)).toBe(1);
  });
});

describe("packLanes", () => {
  it("keeps non-overlapping slots on one line", () => {
    const packed = packLanes([spanOf("09:00", "12:00"), spanOf("12:00", "17:00")]);
    expect(laneCount(packed)).toBe(1);
  });

  it("gives overlapping slots their own lane", () => {
    const packed = packLanes([spanOf("09:00", "17:00"), spanOf("10:00", "15:00")]);
    expect(laneCount(packed)).toBe(2);
  });

  it("reuses a lane once its occupant has finished", () => {
    // 9–5 blankets the row; 10–12 and 1–3 do not overlap each other, so they
    // share lane 1 rather than pushing the day three rows tall.
    const packed = packLanes([
      spanOf("09:00", "17:00"),
      spanOf("10:00", "12:00"),
      spanOf("13:00", "15:00"),
    ]);
    expect(laneCount(packed)).toBe(2);
  });

  it("treats touching slots as non-overlapping", () => {
    const packed = packLanes([spanOf("09:00", "12:00"), spanOf("12:00", "14:00")]);
    expect(laneCount(packed)).toBe(1);
  });

  it("is stable for identical intervals", () => {
    const packed = packLanes([spanOf("09:00", "12:00"), spanOf("09:00", "12:00")]);
    expect(laneCount(packed)).toBe(2);
  });

  it("returns every item exactly once", () => {
    const items = [spanOf("15:00", "18:00"), spanOf("09:00", "12:00"), spanOf("10:00", "16:00")];
    const packed = packLanes(items);
    expect(packed).toHaveLength(3);
    expect(new Set(packed.map((p) => p.item))).toEqual(new Set(items));
  });
});

describe("headcountSteps", () => {
  it("adds up overlapping slots, honouring each slot's count", () => {
    const steps = headcountSteps(
      [
        { ...spanOf("09:00", "17:00"), count: 1 },
        { ...spanOf("12:00", "15:00"), count: 2 },
      ],
      540,
      1020,
    );
    expect(steps).toEqual([
      { startMin: 540, endMin: 720, count: 1 },
      { startMin: 720, endMin: 900, count: 3 },
      { startMin: 900, endMin: 1020, count: 1 },
    ]);
  });

  it("reports an uncovered stretch as zero rather than omitting it", () => {
    // The 12–2 hole is the whole point of drawing this strip.
    const steps = headcountSteps(
      [
        { ...spanOf("09:00", "12:00"), count: 1 },
        { ...spanOf("14:00", "17:00"), count: 1 },
      ],
      540,
      1020,
    );
    expect(steps).toEqual([
      { startMin: 540, endMin: 720, count: 1 },
      { startMin: 720, endMin: 840, count: 0 },
      { startMin: 840, endMin: 1020, count: 1 },
    ]);
  });

  it("merges neighbouring stretches with the same headcount", () => {
    const steps = headcountSteps(
      [
        { ...spanOf("09:00", "12:00"), count: 1 },
        { ...spanOf("12:00", "15:00"), count: 1 },
      ],
      540,
      900,
    );
    expect(steps).toEqual([{ startMin: 540, endMin: 900, count: 1 }]);
  });

  it("returns a single empty step for a day with no slots", () => {
    expect(headcountSteps([], 540, 1020)).toEqual([
      { startMin: 540, endMin: 1020, count: 0 },
    ]);
  });

  it("ignores boundaries outside the axis", () => {
    const steps = headcountSteps([{ ...spanOf("06:00", "23:00"), count: 2 }], 540, 1020);
    expect(steps).toEqual([{ startMin: 540, endMin: 1020, count: 2 }]);
  });
});

describe("hourTicks", () => {
  it("emits one tick per hour inclusive of both ends", () => {
    expect(hourTicks(540, 900)).toHaveLength(7);
  });

  it("labels every hour on a short day", () => {
    expect(hourTicks(540, 900).every((t) => t.labelled)).toBe(true);
  });

  it("thins the labels on a long day so they cannot collide", () => {
    const ticks = hourTicks(540, 1380); // 14 hours
    expect(ticks).toHaveLength(15);
    expect(ticks.filter((t) => t.labelled)).toHaveLength(8); // every 2nd
  });

  it("thins further on a 24-hour day", () => {
    expect(hourTicks(0, 1440).filter((t) => t.labelled)).toHaveLength(9); // every 3rd
  });
});

describe("shortClock", () => {
  it("formats the twelve-hour clock compactly", () => {
    expect(shortClock(0)).toBe("12a");
    expect(shortClock(540)).toBe("9a");
    expect(shortClock(720)).toBe("12p");
    expect(shortClock(1350)).toBe("10:30p");
  });

  it("wraps past midnight so a 1am finish reads as 1a", () => {
    expect(shortClock(1500)).toBe("1a");
  });
});
