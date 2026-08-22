"use client";

import {
  fractionOf,
  headcountSteps,
  hourTicks,
  laneCount,
  packLanes,
  shortClock,
  spanOf,
  timelineDomain,
  type Span,
} from "@/lib/domain/day-timeline";
import type { TradingDay } from "@/lib/domain/template-feasibility";
import { LEVEL_LABEL } from "@/lib/types";
import type { TemplateSlotRow } from "@/lib/supabase/template";
import { accentOf } from "@/lib/utils";

/**
 * One day of a week template, drawn on a shared time axis.
 *
 * Chips in a row told you a slot existed but nothing about when. Bars on an
 * axis show duration, overlap, gaps and the evening peak at a glance — which is
 * the entire job of this screen. Roles stay as labelled rows, so "how much
 * Kitchen?" is still answerable without reading times.
 */

/** The gutter holding role names. Kept in one place so the ruler, the gridlines
 *  and the rows all start at exactly the same x. */
const GUTTER = "10.5rem";

/** Reuse the canonical shape rather than a near-copy — the feasibility checks
 *  and this view must agree on what "open" means. */
export type { TradingDay };

type Props = {
  slots: TemplateSlotRow[];
  trading: TradingDay;
  roleName: (id: string) => string;
  roleColour: (id: string) => string;
  onEditSlot: (slot: TemplateSlotRow) => void;
};

type Placed = Span & { slot: TemplateSlotRow };

export function DayTimeline({ slots, trading, roleName, roleColour, onEditSlot }: Props) {
  const placed: Placed[] = slots.map((slot) => ({
    ...spanOf(
      slot.start_time.slice(0, 5),
      slot.end_time.slice(0, 5),
      slot.crosses_midnight ?? false,
    ),
    slot,
  }));

  const { fromMin, toMin } = timelineDomainFor(placed, trading);
  const pct = (min: number) => `${fractionOf(min, fromMin, toMin) * 100}%`;

  // Roles as rows, alphabetical — a stable order matters more than any clever
  // sort, because the manager builds muscle memory across the seven days.
  const byRole = new Map<string, Placed[]>();
  for (const p of placed) byRole.set(p.slot.role_id, [...(byRole.get(p.slot.role_id) ?? []), p]);
  const rows = [...byRole.entries()]
    .map(([roleId, items]) => ({
      roleId,
      packed: packLanes(items),
      people: items.reduce((n, p) => n + p.slot.count, 0),
    }))
    .sort((a, b) => roleName(a.roleId).localeCompare(roleName(b.roleId)));

  const ticks = hourTicks(fromMin, toMin);

  // Anything outside the trading window is shaded, so a slot that starts before
  // you open reads as the mistake it usually is.
  const known = !trading.is24h && trading.opensAt && trading.closesAt;
  const openMin = known ? Math.max(fromMin, minutesOf(trading.opensAt!)) : fromMin;
  const closeMin = known ? Math.min(toMin, closeMinutes(trading)) : toMin;

  // The sweep is clipped to trading hours, not to the axis. The axis rounds out
  // to whole hours, so a venue closing at 22:30 would otherwise show a spurious
  // "nobody rostered" gap for the half hour after it shuts.
  const steps = headcountSteps(
    placed.map((p) => ({ startMin: p.startMin, endMin: p.endMin, count: p.slot.count })),
    openMin,
    closeMin,
  );
  const peak = steps.reduce((n, s) => Math.max(n, s.count), 0);

  return (
    <div className="select-none">
      {/* Ruler */}
      <div className="flex items-end">
        <div className="shrink-0" style={{ width: GUTTER }} />
        <div className="relative h-5 flex-1">
          {ticks.map((t) => (
            <div
              key={t.min}
              className="absolute bottom-0 -translate-x-1/2 whitespace-nowrap text-[10px] nums text-ink-faint"
              style={{ left: pct(t.min) }}
            >
              {t.labelled ? shortClock(t.min) : ""}
            </div>
          ))}
        </div>
      </div>

      <div className="relative">
        {/* Background layer: closed-hours shading and hour gridlines, drawn once
            behind every row so the verticals line up perfectly. */}
        <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: GUTTER }}>
          {openMin > fromMin && (
            <div
              className="absolute inset-y-0 left-0 bg-surface-2"
              style={{ width: pct(openMin) }}
              title="Before opening"
            />
          )}
          {closeMin < toMin && (
            <div
              className="absolute inset-y-0 bg-surface-2"
              style={{ left: pct(closeMin), right: 0 }}
              title="After closing"
            />
          )}
          {ticks.map((t) => (
            <div
              key={t.min}
              className={`absolute inset-y-0 w-px ${t.labelled ? "bg-line" : "bg-line/50"}`}
              style={{ left: pct(t.min) }}
            />
          ))}
        </div>

        {/* Role rows */}
        <div className="relative">
          {rows.map((row) => {
            const accent = accentOf(roleColour(row.roleId));
            const lanes = laneCount(row.packed);
            return (
              <div key={row.roleId} className="flex items-stretch border-t border-line/60">
                <div
                  className="shrink-0 py-2 pr-3"
                  style={{ width: GUTTER }}
                  title={roleName(row.roleId)}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: accent.dot }}
                    />
                    <span className="truncate text-[13px] font-semibold text-ink">
                      {roleName(row.roleId)}
                    </span>
                  </div>
                  <span className="ml-3.5 text-[11px] nums text-ink-faint">
                    {row.people} {row.people === 1 ? "person" : "people"}
                  </span>
                </div>

                <div
                  className="relative flex-1 py-1.5"
                  style={{ minHeight: `${lanes * 34 + 12}px` }}
                >
                  {row.packed.map(({ item, lane }) => (
                    <SlotBar
                      key={item.slot.id}
                      placed={item}
                      lane={lane}
                      left={pct(item.startMin)}
                      right={`${100 - fractionOf(item.endMin, fromMin, toMin) * 100}%`}
                      accent={accent}
                      roleName={roleName(item.slot.role_id)}
                      onClick={() => onEditSlot(item.slot)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Coverage strip — the question the chips view could not answer:
            where is the peak, and where is the hole? */}
        {peak > 0 && (
          <div className="relative flex items-stretch border-t border-line/60">
            <div className="shrink-0 py-2 pr-3" style={{ width: GUTTER }}>
              <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                On shift
              </span>
              <span className="ml-1.5 text-[11px] nums text-ink-faint">peak {peak}</span>
            </div>
            <div className="relative h-9 flex-1">
              {steps.map((s) =>
                s.count === 0 ? (
                  <div
                    key={s.startMin}
                    className="absolute bottom-0 top-0 border-x border-dashed border-saffron/60 bg-saffron-soft/60"
                    style={{ left: pct(s.startMin), right: `${100 - fractionOf(s.endMin, fromMin, toMin) * 100}%` }}
                    title={`Nobody rostered ${shortClock(s.startMin)}–${shortClock(s.endMin)}`}
                  />
                ) : (
                  <div
                    key={s.startMin}
                    className="absolute bottom-0 flex items-start justify-center overflow-hidden rounded-t-[3px] bg-ember/25"
                    style={{
                      left: pct(s.startMin),
                      right: `${100 - fractionOf(s.endMin, fromMin, toMin) * 100}%`,
                      height: `${Math.max(18, (s.count / peak) * 100)}%`,
                    }}
                    title={`${s.count} rostered ${shortClock(s.startMin)}–${shortClock(s.endMin)}`}
                  >
                    <span className="pt-px text-[10px] font-semibold nums text-ember-deep">
                      {s.count}
                    </span>
                  </div>
                ),
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SlotBar({
  placed,
  lane,
  left,
  right,
  accent,
  roleName,
  onClick,
}: {
  placed: Placed;
  lane: number;
  left: string;
  right: string;
  accent: { bg: string; text: string; dot: string; border: string };
  roleName: string;
  onClick: () => void;
}) {
  const s = placed.slot;
  const times = `${shortClock(placed.startMin)}–${shortClock(placed.endMin)}`;
  const crosses = placed.endMin > 1440;

  // Bars can get narrow, so the full story always lives in the tooltip; the bar
  // itself shows as much as fits and truncates cleanly.
  const tip = [
    roleName,
    times + (crosses ? " (next day)" : ""),
    s.count > 1 ? `${s.count} people` : "1 person",
    s.required_level ? `${LEVEL_LABEL[s.required_level]} or above` : null,
    s.label,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      onClick={onClick}
      title={tip}
      aria-label={tip}
      className="absolute flex h-[30px] min-w-[26px] items-center gap-1.5 overflow-hidden rounded-md border px-1.5 text-left transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-ember/50"
      style={{
        left,
        right,
        top: `${lane * 34 + 6}px`,
        backgroundColor: accent.bg,
        borderColor: accent.border,
      }}
    >
      <span
        className="shrink-0 text-[11px] font-semibold nums"
        style={{ color: accent.text }}
      >
        {times}
        {crosses && <span className="opacity-60"> +1</span>}
      </span>
      {s.count > 1 && (
        <span
          className="shrink-0 rounded bg-white/70 px-1 text-[10px] font-bold nums"
          style={{ color: accent.text }}
        >
          ×{s.count}
        </span>
      )}
      {s.required_level && (
        <span
          className="shrink-0 rounded bg-white/70 px-1 text-[9px] font-semibold uppercase tracking-wide"
          style={{ color: accent.text }}
        >
          {LEVEL_LABEL[s.required_level]}
        </span>
      )}
      {s.label && (
        <span className="truncate text-[11px] opacity-70" style={{ color: accent.text }}>
          {s.label}
        </span>
      )}
    </button>
  );
}

// ---- local helpers -------------------------------------------------------

const minutesOf = (t: string) => {
  const [h, m] = t.slice(0, 5).split(":");
  return Number(h) * 60 + Number(m);
};

function closeMinutes(trading: TradingDay): number {
  const open = minutesOf(trading.opensAt!);
  const close = minutesOf(trading.closesAt!);
  return close <= open ? close + 1440 : close;
}

/** Thin wrapper so the component does not need to build the TradingWindow shape. */
function timelineDomainFor(placed: Placed[], trading: TradingDay) {
  return timelineDomain(
    placed.map((p) => ({ startMin: p.startMin, endMin: p.endMin })),
    { opensAt: trading.opensAt, closesAt: trading.closesAt, is24h: trading.is24h },
  );
}
