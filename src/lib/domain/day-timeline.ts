/**
 * Geometry for the day-timeline view of a week template.
 *
 * A template day is a set of time intervals grouped by role. Drawing them on a
 * shared time axis is the only way to see overlap, gaps and peaks — so the
 * arithmetic that turns "09:30" into an x-offset lives here, pure and tested,
 * rather than inline in the page.
 *
 * All values are **minutes from midnight of the day the slot starts on**. A
 * slot that crosses midnight simply has an `endMin` past 1440; nothing else in
 * this module needs to know about the wrap.
 */

export type Span = { startMin: number; endMin: number };

export const MINUTES_PER_DAY = 1440;

/** "09:30" → 570. Tolerates "09:30:00". */
export function minutesOfHHMM(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * The interval a slot occupies. `crossesMidnight` comes from the row, but we
 * also infer it when the end is at or before the start — a 22:00–02:00 slot is
 * four hours long, not minus twenty.
 */
export function spanOf(start: string, end: string, crossesMidnight = false): Span {
  const startMin = minutesOfHHMM(start);
  let endMin = minutesOfHHMM(end);
  if (crossesMidnight || endMin <= startMin) endMin += MINUTES_PER_DAY;
  return { startMin, endMin };
}

export type TradingWindow = {
  opensAt: string | null;
  closesAt: string | null;
  is24h: boolean;
};

/** Shown when a day is open but has no hours recorded — better a sane axis than
 *  a crash or a zero-width one. */
const FALLBACK_WINDOW = { from: 9 * 60, to: 17 * 60 };

/**
 * The visible time axis: the trading window, widened to cover every slot, then
 * snapped out to whole hours so the ruler has clean ticks.
 *
 * Slots outside trading hours deliberately stretch the axis instead of being
 * clipped — a slot starting before you open is a mistake the manager needs to
 * see, not one the view should hide.
 */
export function timelineDomain(spans: Span[], trading: TradingWindow): { fromMin: number; toMin: number } {
  let from: number;
  let to: number;

  if (trading.is24h) {
    from = 0;
    to = MINUTES_PER_DAY;
  } else if (trading.opensAt && trading.closesAt) {
    from = minutesOfHHMM(trading.opensAt);
    to = minutesOfHHMM(trading.closesAt);
    if (to <= from) to += MINUTES_PER_DAY; // trades past midnight
  } else if (spans.length) {
    // Open, but no hours recorded — let the slots themselves define the axis.
    from = Math.min(...spans.map((s) => s.startMin));
    to = Math.max(...spans.map((s) => s.endMin));
  } else {
    from = FALLBACK_WINDOW.from;
    to = FALLBACK_WINDOW.to;
  }

  for (const s of spans) {
    from = Math.min(from, s.startMin);
    to = Math.max(to, s.endMin);
  }

  from = Math.floor(from / 60) * 60;
  to = Math.ceil(to / 60) * 60;

  // A very short window makes bars unreadably wide; keep at least four hours.
  if (to - from < 240) to = from + 240;

  return { fromMin: from, toMin: to };
}

/** Fraction (0–1) of the axis at which a minute value sits. */
export function fractionOf(min: number, fromMin: number, toMin: number): number {
  const width = toMin - fromMin;
  if (width <= 0) return 0;
  return Math.min(1, Math.max(0, (min - fromMin) / width));
}

/**
 * Stack overlapping intervals into rows.
 *
 * Greedy first-fit by start time: each item drops into the lowest lane whose
 * previous occupant has already finished. Non-overlapping slots therefore share
 * a lane and a role with no overlap stays a single line — which is the common
 * case and keeps the day compact.
 */
export function packLanes<T extends Span>(items: T[]): { item: T; lane: number }[] {
  const ordered = items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.startMin - b.item.startMin || a.item.endMin - b.item.endMin || a.i - b.i);

  const laneEnds: number[] = [];
  const out: { item: T; lane: number }[] = [];

  for (const { item } of ordered) {
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMin);
    } else {
      laneEnds[lane] = item.endMin;
    }
    out.push({ item, lane });
  }

  return out;
}

export function laneCount(packed: { lane: number }[]): number {
  return packed.reduce((n, p) => Math.max(n, p.lane + 1), 0);
}

export type HeadcountStep = { startMin: number; endMin: number; count: number };

/**
 * How many people are rostered at each moment of the day.
 *
 * This is the question the chips view could not answer at all: a manager wants
 * to see the dinner peak and the 3pm hole without adding anything up. Runs of
 * equal headcount are merged so the result is a compact step function.
 */
export function headcountSteps(
  items: (Span & { count: number })[],
  fromMin: number,
  toMin: number,
): HeadcountStep[] {
  const edges = new Set<number>([fromMin, toMin]);
  for (const it of items) {
    if (it.startMin > fromMin && it.startMin < toMin) edges.add(it.startMin);
    if (it.endMin > fromMin && it.endMin < toMin) edges.add(it.endMin);
  }
  const points = [...edges].sort((a, b) => a - b);

  const steps: HeadcountStep[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const startMin = points[i];
    const endMin = points[i + 1];
    const mid = (startMin + endMin) / 2;
    const count = items.reduce(
      (n, it) => (it.startMin <= mid && it.endMin > mid ? n + it.count : n),
      0,
    );

    const prev = steps[steps.length - 1];
    if (prev && prev.count === count && prev.endMin === startMin) prev.endMin = endMin;
    else steps.push({ startMin, endMin, count });
  }

  return steps;
}

/**
 * Hour marks for the ruler. Wide days get a label every second or third hour so
 * the numbers never collide, but a tick is emitted for every hour regardless —
 * the faint gridlines are what make bar lengths comparable by eye.
 */
export function hourTicks(fromMin: number, toMin: number): { min: number; labelled: boolean }[] {
  const hours = (toMin - fromMin) / 60;
  const every = hours > 18 ? 3 : hours > 11 ? 2 : 1;
  const ticks: { min: number; labelled: boolean }[] = [];
  for (let m = fromMin; m <= toMin; m += 60) {
    ticks.push({ min: m, labelled: ((m - fromMin) / 60) % every === 0 });
  }
  return ticks;
}

/** "9a", "12p", "10:30p" — compact enough for a ruler tick. */
export function shortClock(min: number): string {
  const wrapped = ((min % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h24 = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  const suffix = h24 < 12 ? "a" : "p";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}
