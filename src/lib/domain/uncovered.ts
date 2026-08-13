// M8 §7 / M9 E13 — "this shift is still uncovered and starts soon".
//
// THE INVARIANT THIS PROTECTS (CLAUDE.md rule 4): a shift is never quietly
// owned by nobody. When a drop is never picked up, the dropper legally still
// holds the shift — but if neither they nor the manager realises, nobody turns
// up. This is the sweep that makes certain the manager is told in time.
//
// Deliberately NOT a state change: the shift is not reassigned or reverted, and
// ownership does not move. It only raises an alarm. Silently mutating a roster
// on a timer would be far more dangerous than a missed shift.
//
// Pure and clock-injected so it can be tested without waiting for real time.

/** The states that mean "this shift is in the swap flow and not resettled". */
export const UNCOVERED_STATUSES = ["open", "claimed_pending", "drop_requested"] as const;
export type UncoveredStatus = (typeof UNCOVERED_STATUSES)[number];

export interface SweepShift {
  id: string;
  businessId: string;
  status: string;
  /** UTC instant the shift begins. */
  startAt: string;
  /** Whether an E13 has already been raised for this shift. */
  alreadyAlerted: boolean;
}

export interface UncoveredAlert {
  shiftId: string;
  businessId: string;
  startAt: string;
  /** Whole hours from now until the shift starts; never negative. */
  hoursUntilStart: number;
}

/** M8 §7 default: warn the manager twelve hours out. */
export const DEFAULT_LEAD_HOURS = 12;

const MS_PER_HOUR = 3_600_000;

/**
 * Which shifts need an "uncovered, starting soon" alert right now.
 *
 * A shift qualifies when it is still unsettled in the swap flow, starts inside
 * the lead window, has not started yet, and has not already been alerted about.
 *
 * The already-alerted check is what makes the sweep safe to run on a tight
 * schedule: without it an hourly cron would text the manager about the same
 * shift twelve times, which trains people to ignore the one that matters.
 */
export function selectUncoveredAlerts(
  shifts: readonly SweepShift[],
  now: Date,
  leadHours: number = DEFAULT_LEAD_HOURS,
): UncoveredAlert[] {
  const nowMs = now.getTime();
  const horizonMs = nowMs + leadHours * MS_PER_HOUR;
  const statuses = new Set<string>(UNCOVERED_STATUSES);

  const alerts: UncoveredAlert[] = [];
  for (const shift of shifts) {
    if (shift.alreadyAlerted) continue;
    if (!statuses.has(shift.status)) continue;

    const startMs = Date.parse(shift.startAt);
    if (Number.isNaN(startMs)) continue;

    // Already started: too late to be useful, and M8 §7 says a shift that
    // begins while still open is handled separately, not spammed about.
    if (startMs <= nowMs) continue;
    if (startMs > horizonMs) continue;

    alerts.push({
      shiftId: shift.id,
      businessId: shift.businessId,
      startAt: shift.startAt,
      hoursUntilStart: Math.max(0, Math.round((startMs - nowMs) / MS_PER_HOUR)),
    });
  }

  // Soonest first: if a run is ever truncated, the most urgent went out.
  return alerts.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}
