// The SINGLE shared availability-resolution function (M3 §6, TECH_STACK §7).
// Used by the staff screen, the manager view, roster warnings (M6) and — via
// pre-resolved request data — the solver (M5). It must exist in exactly one
// place; do not duplicate this logic anywhere else.
//
// Times are wall-clock "HH:MM" strings interpreted in the business timezone, so
// windows never drift across a DST boundary (there is no instant arithmetic).

export interface TimeWindow {
  from: string; // "HH:MM"
  to: string; // "HH:MM" ("24:00" = end of day)
}

export interface PatternInput {
  isAvailable: boolean;
  from: string | null;
  to: string | null;
}

export interface ExceptionInput {
  isAvailable: boolean;
  from: string | null;
  to: string | null;
}

export interface TradingInput {
  isOpen: boolean;
  is24h: boolean;
  opensAt: string | null;
  closesAt: string | null;
}

export interface DayResolutionInput {
  pattern?: PatternInput | null;
  exception?: ExceptionInput | null;
  trading?: TradingInput | null;
}

export interface ResolvedAvailability {
  /** Can the person work at all this day (after intersecting with trading hours)? */
  available: boolean;
  /** false when neither pattern nor exception was set → defaulted to available. */
  isSet: boolean;
  /** Available windows within trading hours; empty when unavailable or closed. */
  windows: TimeWindow[];
  source: "exception" | "pattern" | "default";
}

const hhmm = (t: string): string => t.slice(0, 5);

function toMin(t: string): number {
  if (t === "24:00") return 1440;
  const [h, m] = hhmm(t).split(":").map(Number);
  return h * 60 + m;
}

function fromMin(mins: number): string {
  if (mins >= 1440) return "24:00";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** The trading window(s) for a day, normalised to minutes-of-day. */
function tradingWindow(trading: TradingInput | null | undefined): [number, number] | null {
  if (!trading || !trading.isOpen) return null;
  if (trading.is24h) return [0, 1440];
  if (!trading.opensAt || !trading.closesAt) return null;
  const open = toMin(trading.opensAt);
  let close = toMin(trading.closesAt);
  // Overnight (e.g. 18:00→02:00): on this calendar day the window runs to midnight.
  // The solver (M5) handles the precise cross-midnight timeline; here we clamp.
  if (close <= open) close = 1440;
  return [open, close];
}

/**
 * Resolve one person's availability for one day. `pattern`/`exception` are for
 * that specific weekday/date; `trading` is the location's hours for that date.
 */
export function resolveAvailability(input: DayResolutionInput): ResolvedAvailability {
  const { pattern, exception, trading } = input;

  let source: ResolvedAvailability["source"];
  let baseWindow: [number, number] | null; // null = "any open time"
  let baseAvailable: boolean;

  if (exception) {
    source = "exception";
    baseAvailable = exception.isAvailable;
    baseWindow =
      exception.isAvailable && exception.from && exception.to
        ? [toMin(exception.from), toMin(exception.to)]
        : null;
  } else if (pattern) {
    source = "pattern";
    baseAvailable = pattern.isAvailable;
    baseWindow =
      pattern.isAvailable && pattern.from && pattern.to
        ? [toMin(pattern.from), toMin(pattern.to)]
        : null;
  } else {
    source = "default";
    baseAvailable = true;
    baseWindow = null;
  }

  const isSet = source !== "default";

  if (!baseAvailable) {
    return { available: false, isSet, windows: [], source };
  }

  const trade = tradingWindow(trading);
  if (!trade) {
    // Available in principle, but the shop is closed → no working window.
    return { available: false, isSet, windows: [], source };
  }

  const [aFrom, aTo] = baseWindow ?? [0, 1440];
  const from = Math.max(aFrom, trade[0]);
  const to = Math.min(aTo, trade[1]);
  const windows: TimeWindow[] = from < to ? [{ from: fromMin(from), to: fromMin(to) }] : [];

  return { available: windows.length > 0, isSet, windows, source };
}
