"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { Avatar, Card, Modal } from "@/components/ui";
import { AvailabilityEditor } from "@/components/AvailabilityEditor";
import {
  fetchBusinessPatterns,
  fetchTradingHours,
  type PatternRow,
  type TradingHoursRow,
} from "@/lib/supabase/availability";
import { resolveAvailability } from "@/lib/domain/availability";
import type { TeamMember } from "@/lib/types";

const DAYS: { dow: number; label: string }[] = [
  { dow: 1, label: "Mon" },
  { dow: 2, label: "Tue" },
  { dow: 3, label: "Wed" },
  { dow: 4, label: "Thu" },
  { dow: 5, label: "Fri" },
  { dow: 6, label: "Sat" },
  { dow: 0, label: "Sun" },
];

export default function TeamAvailabilityPage() {
  const { team, session } = useStore();
  const [patterns, setPatterns] = useState<PatternRow[]>([]);
  const [trading, setTrading] = useState<TradingHoursRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TeamMember | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, t] = await Promise.all([fetchBusinessPatterns(), fetchTradingHours()]);
      setPatterns(p);
      setTrading(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load availability.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState runs after the await, never during render, so
    // this can't cause a render loop (what the rule guards against).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const patternKey = (userId: string, dow: number) => `${userId}:${dow}`;
  const patternMap = useMemo(() => {
    const m = new Map<string, PatternRow>();
    for (const p of patterns) m.set(patternKey(p.user_id, p.day_of_week), p);
    return m;
  }, [patterns]);

  const tradingMap = useMemo(() => {
    const m = new Map<string, TradingHoursRow>();
    for (const t of trading) m.set(`${t.location_id}:${t.day_of_week}`, t);
    return m;
  }, [trading]);

  const active = team.filter((m) => m.active);
  const notSetCount = active.filter(
    (m) => !DAYS.some(({ dow }) => patternMap.has(patternKey(m.id, dow))),
  ).length;

  function cell(m: TeamMember, dow: number) {
    const p = patternMap.get(patternKey(m.id, dow));
    const th = m.homeLocationId ? tradingMap.get(`${m.homeLocationId}:${dow}`) : undefined;
    const r = resolveAvailability({
      pattern: p ? { isAvailable: p.is_available, from: p.from_time, to: p.to_time } : null,
      trading: th
        ? { isOpen: th.is_open, is24h: th.is_24h, opensAt: th.opens_at, closesAt: th.closes_at }
        : null,
    });
    if (!p) return { kind: "unset" as const };
    if (!r.available) return { kind: "off" as const };
    const limited = !!(p.is_available && p.from_time && p.to_time);
    return { kind: "on" as const, limited, window: r.windows[0] };
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
            Team availability
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            The usual week per person. Click anyone to set it on their behalf.
          </p>
        </div>
      </header>

      {notSetCount > 0 && (
        <div className="rise mt-4 rounded-xl border border-saffron/40 bg-saffron-soft/50 px-4 py-2.5 text-[13px] text-[#8a6212]">
          {notSetCount} {notSetCount === 1 ? "person has" : "people have"} no availability recorded —
          rosters may place them when they can&rsquo;t work.
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-clay/30 bg-clay/5 px-3 py-2 text-[13px] text-clay">
          {error}
        </p>
      )}

      <Card className="rise mt-5 overflow-x-auto" >
        {loading ? (
          <p className="p-8 text-center text-sm text-ink-faint">Loading…</p>
        ) : active.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-faint">No active team members.</p>
        ) : (
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2">
                <th className="px-4 py-2.5 text-left text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
                  Team
                </th>
                {DAYS.map((d) => (
                  <th key={d.dow} className="px-2 py-2.5 text-center text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {active.map((m) => (
                <tr
                  key={m.id}
                  onClick={() => setEditing(m)}
                  className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2/50"
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={m.name} accent={m.colour} size={30} />
                      <span className="truncate text-[13px] font-medium text-ink">{m.name}</span>
                    </div>
                  </td>
                  {DAYS.map(({ dow }) => {
                    const c = cell(m, dow);
                    return (
                      <td key={dow} className="px-2 py-2.5 text-center">
                        {c.kind === "unset" ? (
                          <span className="text-ink-faint" title="not set">
                            —
                          </span>
                        ) : c.kind === "off" ? (
                          <span className="inline-grid h-6 w-6 place-items-center rounded-full bg-clay/10 text-[12px] font-bold text-clay">
                            ✕
                          </span>
                        ) : c.limited && c.window ? (
                          <span className="nums text-[11px] font-semibold text-herb">
                            {c.window.from}–{c.window.to}
                          </span>
                        ) : (
                          <span className="inline-grid h-6 w-6 place-items-center rounded-full bg-herb-soft text-[12px] font-bold text-herb">
                            ✓
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <p className="mt-3 text-center text-[12px] text-ink-faint">
        ✓ available · a time = limited hours · ✕ not available · — not set
      </p>

      {editing && session.businessId && session.appUserId && (
        <Modal
          open
          onClose={() => {
            setEditing(null);
            void load();
          }}
          title={editing.name}
          subtitle="Set availability on their behalf"
          maxWidth={620}
        >
          <AvailabilityEditor
            userId={editing.id}
            businessId={session.businessId}
            editorId={session.appUserId}
          />
        </Modal>
      )}
    </div>
  );
}
