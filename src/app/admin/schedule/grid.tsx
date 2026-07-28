"use client";

// The roster grid (M6 §2.1): staff down the side, days across the top.
//
// The single most important rule on this screen: an unfilled position is a
// CARD, never blank space. Blank space reads as "nothing needed here"; an
// unfilled marker reads as "you have a problem here". Everything else on the
// screen is easier to fix than that distinction.
//
// Auto-assigned and manager-edited shifts are distinguished quietly — a small
// dot, not a badge. The manager should be able to see the algorithm's work
// versus their own without the grid turning into a sticker album.

import { useMemo } from "react";
import { Card } from "@/components/ui";
import { IconPin, IconPlus } from "@/components/icons";
import type { RosterPositionRow, ShiftRow } from "@/lib/supabase/roster";
import type { EligibilityIssue } from "@/lib/domain/eligibility";
import { elapsedHours, wallTimeIn } from "@/lib/domain/timezone";
import { COST_DISCLAIMER, roundMoney, shiftCost } from "@/lib/domain/cost";
import { LEVEL_LABEL } from "@/lib/types";
import { formatDayLabel, formatHours, formatMoney } from "@/lib/utils";

export interface GridMember {
  id: string;
  name: string;
  active: boolean;
}

export interface RosterGridProps {
  dates: string[];
  timezone: string;
  positions: RosterPositionRow[];
  shifts: ShiftRow[];
  team: GridMember[];
  roleName: (id: string) => string;
  /** Live rule breaches per shift id, for the quiet warning marker. */
  issuesByShift: Map<string, EligibilityIssue[]>;
  /** Solver reasons per unfilled position id. */
  unfilledDetail: Map<string, { reason: string; detail: string }>;
  /** The cell the manager just jumped to from the health panel. */
  focusedCell: string | null;
  busy: boolean;
  onOpenShift: (shift: ShiftRow, position: RosterPositionRow | null) => void;
  onOpenPosition: (position: RosterPositionRow) => void;
  onAddPosition: () => void;
}

const hoursOf = (s: ShiftRow): number => elapsedHours(s.start_at, s.end_at, s.break_minutes);
const costOf = (s: ShiftRow): number => shiftCost(hoursOf(s), Number(s.pay_rate_snapshot ?? 0));

export function RosterGrid({
  dates,
  timezone,
  positions,
  shifts,
  team,
  roleName,
  issuesByShift,
  unfilledDetail,
  focusedCell,
  busy,
  onOpenShift,
  onOpenPosition,
  onAddPosition,
}: RosterGridProps) {
  const positionById = useMemo(
    () => new Map(positions.map((p) => [p.id, p])),
    [positions],
  );

  const filledPositionIds = useMemo(
    () => new Set(shifts.flatMap((s) => (s.roster_position_id ? [s.roster_position_id] : []))),
    [shifts],
  );

  const byUserDate = useMemo(() => {
    const m = new Map<string, ShiftRow[]>();
    for (const s of shifts) {
      if (!s.assigned_user_id) continue;
      const key = `${s.assigned_user_id}|${s.date}`;
      const arr = m.get(key) ?? [];
      arr.push(s);
      m.set(key, arr);
    }
    return m;
  }, [shifts]);

  const unfilledByDate = useMemo(() => {
    const m = new Map<string, RosterPositionRow[]>();
    for (const p of positions) {
      if (filledPositionIds.has(p.id)) continue;
      const arr = m.get(p.date) ?? [];
      arr.push(p);
      m.set(p.date, arr);
    }
    return m;
  }, [positions, filledPositionIds]);

  const assignedIds = useMemo(
    () => new Set(shifts.flatMap((s) => (s.assigned_user_id ? [s.assigned_user_id] : []))),
    [shifts],
  );
  const rows = team.filter((m) => m.active || assignedIds.has(m.id));

  const perDay = useMemo(() => {
    const m = new Map<string, { hours: number; cost: number }>();
    for (const d of dates) m.set(d, { hours: 0, cost: 0 });
    for (const s of shifts) {
      const cell = m.get(s.date);
      if (!cell) continue;
      cell.hours += hoursOf(s);
      cell.cost += costOf(s);
    }
    return m;
  }, [dates, shifts]);

  const perPerson = useMemo(() => {
    const m = new Map<string, { hours: number; cost: number }>();
    for (const s of shifts) {
      if (!s.assigned_user_id) continue;
      const cell = m.get(s.assigned_user_id) ?? { hours: 0, cost: 0 };
      cell.hours += hoursOf(s);
      cell.cost += costOf(s);
      m.set(s.assigned_user_id, cell);
    }
    return m;
  }, [shifts]);

  const totalUnfilled = positions.length - filledPositionIds.size;

  if (positions.length === 0) {
    return (
      <Card className="rise mt-5 p-8 text-center">
        <p className="text-sm text-ink-faint">
          This roster has no positions. Add requirements to the week template and create it again,
          or add a one-off position here.
        </p>
        <button
          onClick={onAddPosition}
          className="mx-auto mt-4 flex min-h-11 items-center gap-1.5 rounded-xl border border-dashed border-line-strong px-4 text-[13px] font-medium text-ink-soft transition hover:border-ember hover:text-ember"
        >
          <IconPlus width={15} height={15} /> Add a position
        </button>
      </Card>
    );
  }

  return (
    <Card className="rise mt-5 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="font-display text-base font-semibold text-ink">Roster</h2>
        <button
          onClick={onAddPosition}
          disabled={busy}
          className="flex min-h-11 items-center gap-1.5 rounded-xl border border-dashed border-line-strong px-3 text-[13px] font-medium text-ink-soft transition hover:border-ember hover:text-ember disabled:opacity-40"
        >
          <IconPlus width={15} height={15} /> Add position
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line bg-surface-2">
              <th className="sticky left-0 z-10 bg-surface-2 px-3 py-2.5 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
                Person
              </th>
              {dates.map((d) => (
                // Coverage gaps aren't about one cell, so the health panel jumps
                // to the day column instead.
                <th
                  key={d}
                  id={`cell-day-${d}`}
                  className={`min-w-[128px] px-2 py-2.5 text-[12px] font-semibold text-ink-soft ${
                    focusedCell === `day-${d}` ? "ring-2 ring-ember" : ""
                  }`}
                >
                  {formatDayLabel(d)}
                </th>
              ))}
              <th className="min-w-[104px] px-3 py-2.5 text-right text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
                Total
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((m) => {
              const totals = perPerson.get(m.id) ?? { hours: 0, cost: 0 };
              return (
                <tr key={m.id} className="border-b border-line align-top">
                  <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-[13px] font-medium text-ink">
                    {m.name}
                    {!m.active && (
                      <span className="ml-1.5 text-[11px] font-normal text-clay">inactive</span>
                    )}
                  </th>

                  {dates.map((d) => {
                    const cell = byUserDate.get(`${m.id}|${d}`) ?? [];
                    return (
                      <td key={d} className="px-1.5 py-2">
                        {cell.length === 0 ? (
                          <span className="block py-2 text-center text-[12px] text-ink-faint">
                            —
                          </span>
                        ) : (
                          <div className="space-y-1">
                            {cell.map((s) => {
                              const issues = issuesByShift.get(s.id) ?? [];
                              const focused = focusedCell === s.id;
                              return (
                                <button
                                  key={s.id}
                                  id={`cell-${s.id}`}
                                  onClick={() =>
                                    onOpenShift(
                                      s,
                                      s.roster_position_id
                                        ? (positionById.get(s.roster_position_id) ?? null)
                                        : null,
                                    )
                                  }
                                  className={`block w-full min-h-11 rounded-lg border px-2 py-1.5 text-left transition hover:border-ember ${
                                    issues.length
                                      ? "border-saffron/60 bg-saffron-soft/40"
                                      : "border-line bg-surface"
                                  } ${focused ? "ring-2 ring-ember" : ""}`}
                                >
                                  <span className="flex items-center justify-between gap-1">
                                    <span className="truncate text-[12px] font-semibold text-ink">
                                      {roleName(s.role_id)}
                                    </span>
                                    <span className="flex shrink-0 items-center gap-1">
                                      {s.locked && (
                                        <IconPin
                                          width={11}
                                          height={11}
                                          aria-label="Pinned"
                                          className="text-ink-faint"
                                        />
                                      )}
                                      {/* Quiet marker: the manager's own edit. */}
                                      {s.origin === "manual" && (
                                        <span
                                          title="Edited by you"
                                          className="h-1.5 w-1.5 rounded-full bg-ember"
                                        />
                                      )}
                                    </span>
                                  </span>
                                  <span className="nums block text-[11px] text-ink-soft">
                                    {wallTimeIn(s.start_at, timezone)}–
                                    {wallTimeIn(s.end_at, timezone)}
                                    {s.break_minutes > 0 && (
                                      <span className="text-ink-faint"> · {s.break_minutes}m br</span>
                                    )}
                                  </span>
                                  {issues.length > 0 && (
                                    <span className="mt-0.5 block truncate text-[10px] text-[#8a6212]">
                                      {issues[0].short}
                                      {issues.length > 1 && ` +${issues.length - 1}`}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </td>
                    );
                  })}

                  <td className="px-3 py-2 text-right">
                    <p className="nums text-[13px] font-semibold text-ink">
                      {formatHours(totals.hours)}
                    </p>
                    <p className="nums text-[11px] text-ink-faint">
                      {formatMoney(roundMoney(totals.cost))}
                    </p>
                  </td>
                </tr>
              );
            })}

            {/* Unfilled positions are a ROW, not an absence. */}
            <tr className="bg-clay/5 align-top">
              <th className="sticky left-0 z-10 bg-[#fbf1ed] px-3 py-2 text-[13px] font-semibold text-clay">
                Unfilled
                {totalUnfilled > 0 && <span className="nums ml-1 font-normal">({totalUnfilled})</span>}
              </th>
              {dates.map((d) => {
                const cell = unfilledByDate.get(d) ?? [];
                return (
                  <td key={d} className="px-1.5 py-2">
                    {cell.length === 0 ? (
                      <span className="block py-2 text-center text-[12px] text-ink-faint">—</span>
                    ) : (
                      <div className="space-y-1">
                        {cell.map((p) => {
                          const why = unfilledDetail.get(p.id);
                          const focused = focusedCell === p.id;
                          return (
                            <button
                              key={p.id}
                              id={`cell-${p.id}`}
                              onClick={() => onOpenPosition(p)}
                              title={why?.detail ?? "Nobody is on this shift yet."}
                              className={`block min-h-11 w-full rounded-lg border border-dashed border-clay/50 bg-clay/5 px-2 py-1.5 text-left transition hover:border-clay ${
                                focused ? "ring-2 ring-ember" : ""
                              }`}
                            >
                              <span className="truncate text-[12px] font-semibold text-clay">
                                {roleName(p.role_id)}
                                {p.required_level && (
                                  <span className="ml-1 font-normal">
                                    · {LEVEL_LABEL[p.required_level]}
                                  </span>
                                )}
                                {p.source === "manual" && (
                                  <span className="ml-1 font-normal text-ink-faint">· one-off</span>
                                )}
                              </span>
                              <span className="nums block text-[11px] text-clay/80">
                                {wallTimeIn(p.start_at, timezone)}–{wallTimeIn(p.end_at, timezone)}
                                {" · unfilled"}
                              </span>
                              <span className="mt-0.5 block truncate text-[10px] leading-snug text-ink-faint">
                                {why?.detail ?? "Tap to fill it."}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </td>
                );
              })}
              <td />
            </tr>
          </tbody>

          <tfoot>
            <tr className="border-t border-line bg-surface-2">
              <th className="sticky left-0 z-10 bg-surface-2 px-3 py-2.5 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
                Per day
              </th>
              {dates.map((d) => {
                const t = perDay.get(d) ?? { hours: 0, cost: 0 };
                return (
                  <td key={d} className="px-2 py-2.5">
                    <p className="nums text-[12px] font-semibold text-ink">
                      {formatHours(t.hours)}
                    </p>
                    <p className="nums text-[11px] text-ink-faint">
                      {formatMoney(roundMoney(t.cost))}
                    </p>
                  </td>
                );
              })}
              <td className="px-3 py-2.5 text-right">
                <p className="nums text-[13px] font-semibold text-ink">
                  {formatHours(Array.from(perDay.values()).reduce((n, t) => n + t.hours, 0))}
                </p>
                <p className="nums text-[11px] text-ink-faint">
                  {formatMoney(
                    roundMoney(Array.from(perDay.values()).reduce((n, t) => n + t.cost, 0)),
                  )}
                </p>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="border-t border-line px-4 py-2.5 text-[12px] text-ink-faint">
        {COST_DISCLAIMER}
      </p>
    </Card>
  );
}
