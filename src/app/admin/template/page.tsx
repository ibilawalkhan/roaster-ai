"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { Badge, Button, Card, Input, Label, Modal, Select } from "@/components/ui";
import { IconCopy, IconPlus, IconTrash, IconSparkle } from "@/components/icons";
import { BuildFromWeekModal } from "@/components/BuildFromWeekModal";
import { replaceTemplateSlots } from "@/lib/supabase/template";
import type { ConversionSummary } from "@/lib/domain/template-from-week";
import { fetchTradingHours, type TradingHoursRow } from "@/lib/supabase/availability";
import {
  copyDay,
  deleteSlot,
  ensureTemplate,
  fetchSchedulingRule,
  fetchSlots,
  upsertSlot,
  type SchedulingRuleRow,
  type SlotInput,
  type TemplateSlotRow,
} from "@/lib/supabase/template";
import {
  coverageGaps,
  perRoleShortfalls,
  seniorCoverageGaps,
  seniorSupplyVsDemand,
  slotWithinTradingHours,
  supplyVsDemand,
  type MemberLike,
  type SchedulingRuleLike,
  type SlotLike,
  type TradingDay,
} from "@/lib/domain/template-feasibility";
import { COST_DISCLAIMER, paidHours, roundMoney, shiftCost } from "@/lib/domain/cost";
import { DayTimeline } from "@/components/template/DayTimeline";
import { LEVEL_LABEL, type Level } from "@/lib/types";
import { accentOf, formatHours, formatMoney, formatTimeShort } from "@/lib/utils";

// Display order Mon–Sun; stored day_of_week is 0=Sun..6=Sat.
const DAYS: { dow: number; short: string; long: string }[] = [
  { dow: 1, short: "Mon", long: "Monday" },
  { dow: 2, short: "Tue", long: "Tuesday" },
  { dow: 3, short: "Wed", long: "Wednesday" },
  { dow: 4, short: "Thu", long: "Thursday" },
  { dow: 5, short: "Fri", long: "Friday" },
  { dow: 6, short: "Sat", long: "Saturday" },
  { dow: 0, short: "Sun", long: "Sunday" },
];

const hhmm = (t: string | null): string => (t ? t.slice(0, 5) : "");

// Fall back to sane defaults when a business has no scheduling_rule row yet.
function toRuleLike(r: SchedulingRuleRow | null): SchedulingRuleLike {
  return {
    maxHoursCasual: r?.max_hours_casual ?? 38,
    maxHoursPartTime: r?.max_hours_part_time ?? 30,
    maxHoursFullTime: r?.max_hours_full_time ?? 38,
    seniorCoverageEnabled: r?.senior_coverage_enabled ?? false,
    seniorMinCount: r?.senior_min_count ?? 1,
    seniorQualifyingLevels: (r?.senior_qualifying_levels as Level[] | undefined) ?? ["senior"],
  };
}

function toTradingDay(row: TradingHoursRow | undefined): TradingDay | null {
  if (!row) return null;
  return { isOpen: row.is_open, is24h: row.is_24h, opensAt: hhmm(row.opens_at), closesAt: hhmm(row.closes_at) };
}

function toSlotLike(s: TemplateSlotRow): SlotLike {
  return {
    dayOfWeek: s.day_of_week,
    roleId: s.role_id,
    start: hhmm(s.start_time),
    end: hhmm(s.end_time),
    count: s.count,
    requiredLevel: s.required_level,
  };
}

export default function TemplatePage() {
  const { roles, locations, team, session } = useStore();

  const [templateId, setTemplateId] = useState<string | null>(null);
  const [slots, setSlots] = useState<TemplateSlotRow[]>([]);
  const [trading, setTrading] = useState<TradingHoursRow[]>([]);
  const [rule, setRule] = useState<SchedulingRuleRow | null>(null);
  const [locationId, setLocationId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [slotModal, setSlotModal] = useState<{ dow: number; slot?: TemplateSlotRow } | null>(null);
  const [copyModal, setCopyModal] = useState<{ dow: number } | null>(null);
  const [buildFromWeek, setBuildFromWeek] = useState(false);

  const activeRoles = useMemo(() => roles.filter((r) => r.active), [roles]);
  const activeLocations = useMemo(() => locations.filter((l) => l.active), [locations]);

  const load = useCallback(async () => {
    if (!session.businessId) return;
    try {
      const template = await ensureTemplate(session.businessId);
      const [s, t, r] = await Promise.all([
        fetchSlots(template.id),
        fetchTradingHours(),
        fetchSchedulingRule(),
      ]);
      setTemplateId(template.id);
      setSlots(s);
      setTrading(t);
      setRule(r);
      setLocationId((prev) => prev || activeLocations[0]?.id || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the template.");
    } finally {
      setLoading(false);
    }
  }, [session.businessId, activeLocations]);

  useEffect(() => {
    // Fetch-on-mount: setState runs after the await, never during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const reloadSlots = useCallback(async () => {
    if (!templateId) return;
    const s = await fetchSlots(templateId);
    setSlots(s);
  }, [templateId]);

  // ---- derived lookups ----
  // Day sections have room for the full role name, so the short code is no
  // longer needed here — it exists for the narrow roster grid.
  const roleName = (id: string) => roles.find((x) => x.id === id)?.name ?? "Unknown role";
  const roleColour = (id: string) => roles.find((x) => x.id === id)?.colour ?? "ember";

  const tradingMap = useMemo(() => {
    const m = new Map<string, TradingHoursRow>();
    for (const t of trading) m.set(`${t.location_id}:${t.day_of_week}`, t);
    return m;
  }, [trading]);

  const tradingFor = useCallback(
    (dow: number): TradingDay | null => toTradingDay(tradingMap.get(`${locationId}:${dow}`)),
    [tradingMap, locationId],
  );

  const ruleLike = useMemo(() => toRuleLike(rule), [rule]);

  const membersLike = useMemo<MemberLike[]>(
    () =>
      team.map((m) => ({
        active: m.active,
        level: m.level,
        employmentType: m.employmentType,
        maxHoursWeek: m.maxHoursWeek,
        roleIds: m.roleIds,
      })),
    [team],
  );

  // Average base rate of staff eligible for a role — template cost is an estimate.
  const roleAvgRate = useCallback(
    (roleId: string): number => {
      const eligible = team.filter((m) => m.active && m.roleIds.includes(roleId));
      const pool = eligible.length ? eligible : team.filter((m) => m.active);
      if (!pool.length) return 0;
      return pool.reduce((sum, m) => sum + m.payRate, 0) / pool.length;
    },
    [team],
  );

  // Slots for the selected location only.
  const locSlots = useMemo(
    () => slots.filter((s) => s.location_id === locationId),
    [slots, locationId],
  );
  const slotsByDay = useMemo(() => {
    const m = new Map<number, TemplateSlotRow[]>();
    for (const s of locSlots) {
      const arr = m.get(s.day_of_week) ?? [];
      arr.push(s);
      m.set(s.day_of_week, arr);
    }
    return m;
  }, [locSlots]);

  // ---- per-day summaries ----
  function daySummary(dow: number) {
    const daySlots = slotsByDay.get(dow) ?? [];
    let people = 0;
    let hours = 0;
    let cost = 0;
    for (const s of daySlots) {
      const h = paidHours({ start: hhmm(s.start_time), end: hhmm(s.end_time) });
      people += s.count;
      hours += h * s.count;
      cost += shiftCost(h * s.count, roleAvgRate(s.role_id));
    }
    return { people, hours, cost, count: daySlots.length };
  }

  const weekly = useMemo(() => {
    let people = 0;
    let hours = 0;
    let cost = 0;
    for (const s of locSlots) {
      const h = paidHours({ start: hhmm(s.start_time), end: hhmm(s.end_time) });
      people += s.count;
      hours += h * s.count;
      cost += shiftCost(h * s.count, roleAvgRate(s.role_id));
    }
    return { people, hours, cost };
  }, [locSlots, roleAvgRate]);

  // ---- feasibility (M4 §5.2–5.3) ----
  const slotLikes = useMemo(() => locSlots.map(toSlotLike), [locSlots]);
  const feasibility = useMemo(() => {
    const sd = supplyVsDemand(slotLikes, membersLike, ruleLike);
    const roleGaps = perRoleShortfalls(slotLikes, membersLike);
    const tradingByDay = DAYS.map((d) => tradingFor(d.dow));
    const seniorSd = seniorSupplyVsDemand(tradingByDay, membersLike, ruleLike);

    const dayCoverage: { dow: number; long: string; gaps: { from: string; to: string }[] }[] = [];
    const daySenior: { dow: number; long: string; gaps: { from: string; to: string }[] }[] = [];
    for (const d of DAYS) {
      const t = tradingFor(d.dow);
      const dSlots = slotLikes.filter((s) => s.dayOfWeek === d.dow);
      const cg = coverageGaps(dSlots, t);
      if (cg.length) dayCoverage.push({ dow: d.dow, long: d.long, gaps: cg });
      const sg = seniorCoverageGaps(dSlots, t, ruleLike);
      if (sg.length) daySenior.push({ dow: d.dow, long: d.long, gaps: sg });
    }
    return { sd, roleGaps, seniorSd, dayCoverage, daySenior };
  }, [slotLikes, membersLike, ruleLike, tradingFor]);

  const issueCount =
    (feasibility.sd.shortfallHours > 0 ? 1 : 0) +
    feasibility.roleGaps.length +
    (feasibility.seniorSd && feasibility.seniorSd.shortfallHours > 0 ? 1 : 0) +
    feasibility.dayCoverage.length +
    feasibility.daySenior.length;

  // ---- mutations (optimistic; roll back from the server on failure) ----
  const saveSlot = async (input: Omit<SlotInput, "businessId" | "templateId">, id?: string) => {
    if (!session.businessId || !templateId) return;
    setError(null);
    setBusy(true);
    const snapshot = slots;
    // Optimistic: reflect the change immediately.
    const optimistic: TemplateSlotRow = {
      id: id ?? `tmp_${Date.now()}`,
      business_id: session.businessId,
      template_id: templateId,
      location_id: input.locationId,
      day_of_week: input.dayOfWeek,
      role_id: input.roleId,
      start_time: input.start,
      end_time: input.end,
      crosses_midnight: input.end <= input.start,
      count: input.count,
      required_level: input.requiredLevel,
      label: input.label,
      active: true,
    };
    setSlots((prev) => (id ? prev.map((s) => (s.id === id ? optimistic : s)) : [...prev, optimistic]));
    setSlotModal(null);
    try {
      await upsertSlot({ ...input, id, businessId: session.businessId, templateId });
      await reloadSlots();
    } catch (e) {
      setSlots(snapshot); // visible roll-back
      setError(e instanceof Error ? e.message : "Couldn't save that shift requirement. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const removeSlot = async (id: string) => {
    setError(null);
    setBusy(true);
    const snapshot = slots;
    setSlots((prev) => prev.filter((s) => s.id !== id)); // optimistic
    setSlotModal(null);
    try {
      await deleteSlot(id);
      await reloadSlots();
    } catch (e) {
      setSlots(snapshot);
      setError(e instanceof Error ? e.message : "Couldn't remove that requirement. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const runCopyDay = async (fromDow: number, toDows: number[]) => {
    if (!session.businessId || !templateId || !locationId) return;
    setError(null);
    setBusy(true);
    setCopyModal(null);
    try {
      await copyDay(templateId, session.businessId, locationId, fromDow, toDows);
      await reloadSlots();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't copy that day. Try again.");
      await reloadSlots().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  /**
   * M4 §4.4 — replace the template with slots derived from a real week.
   * Replaces rather than merges: blending two weeks produces a template that
   * matches neither, and the modal states that before the manager confirms.
   */
  const applyDerivedSlots = async (summary: ConversionSummary) => {
    if (!session.businessId || !templateId) return;
    setError(null);
    setBusy(true);
    try {
      await replaceTemplateSlots(session.businessId, templateId, summary.slots);
      await reloadSlots();
    } catch (e) {
      // Re-read either way: the manager must never be left looking at a
      // template that doesn't match what's stored.
      await reloadSlots().catch(() => {});
      throw e;
    } finally {
      setBusy(false);
    }
  };

  // ---- render ----
  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8">
        <Card className="p-8 text-center text-sm text-ink-faint">Loading template…</Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Week template</h1>
          <p className="mt-1 text-sm text-ink-soft">
            The staffing your restaurant needs each week — the scheduler fills these with real people.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* M4 §4.4 — the onboarding shortcut: a restaurant with real rosters
              should never face a blank template. */}
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => setBuildFromWeek(true)}
            disabled={busy}
          >
            <IconSparkle width={15} height={15} /> Build from a past week
          </Button>
        {activeLocations.length > 1 && (
          <div className="w-52">
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} aria-label="Location">
              {activeLocations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        </div>
      </header>

      {error && (
        <div className="rise mt-4 flex items-center justify-between gap-3 rounded-xl border border-clay/30 bg-clay/5 px-4 py-2.5 text-[13px] text-clay">
          <span>{error}</span>
          <button onClick={() => void load()} className="shrink-0 font-semibold underline">
            Retry
          </button>
        </div>
      )}

      {/* Weekly totals */}
      <div className="rise mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3" style={{ animationDelay: "40ms" }}>
        <Card className="p-4">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">People / week</p>
          <p className="nums mt-1 font-display text-2xl font-semibold text-ink">{weekly.people}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">Hours / week</p>
          <p className="nums mt-1 font-display text-2xl font-semibold text-ink">{formatHours(weekly.hours)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">Est. weekly cost</p>
          <p className="nums mt-1 font-display text-2xl font-semibold text-ink">
            {formatMoney(roundMoney(weekly.cost))}
          </p>
          <p className="mt-0.5 text-[11px] text-ink-faint">{COST_DISCLAIMER}</p>
        </Card>
      </div>

      {/* Feasibility panel */}
      <FeasibilityPanel
        issueCount={issueCount}
        feasibility={feasibility}
        roleName={roleName}
      />

      {/* ---------------------------------------------------------------
          Day sections, not day columns.

          A template is authored one day at a time — "what does Monday need?"
          — so the day is the heading and everything sits beneath it. Seven
          narrow columns squeezed each slot into a cramped box and made the
          role grouping unreadable. A full-width section gives the content room
          and lets slots sit as chips that wrap, which handles any screen width
          without a horizontal scrollbar.

          Roles are sub-headed inside the day, because the manager's next
          question after "what does Monday need?" is always "how much Kitchen?"
      ---------------------------------------------------------------- */}
      <div className="rise mt-5 space-y-3" style={{ animationDelay: "120ms" }}>
        {DAYS.map((d) => {
          const t = tradingFor(d.dow);
          const closed = !t || !t.isOpen;
          const sum = daySummary(d.dow);

          // Slots grouped by role, each group ordered by start time.
          const groups = new Map<string, TemplateSlotRow[]>();
          for (const slot of slotsByDay.get(d.dow) ?? []) {
            groups.set(slot.role_id, [...(groups.get(slot.role_id) ?? []), slot]);
          }
          const roleGroups = [...groups.entries()]
            .map(([roleId, list]) => ({
              roleId,
              slots: list
                .slice()
                .sort((a, b) => hhmm(a.start_time).localeCompare(hhmm(b.start_time))),
              people: list.reduce((n, x) => n + x.count, 0),
            }))
            .sort((a, b) => roleName(a.roleId).localeCompare(roleName(b.roleId)));

          // A closed day collapses to one quiet line — seven full sections is a
          // lot of scrolling, and a day you don't trade shouldn't claim any.
          if (closed) {
            return (
              <div
                key={d.dow}
                className="flex flex-wrap items-center gap-3 rounded-card border border-dashed border-line px-4 py-2.5"
              >
                <span className="font-display text-sm font-semibold text-ink-faint">{d.long}</span>
                <span className="text-[12px] text-ink-faint">
                  Closed — open this day in Settings to add requirements.
                </span>
              </div>
            );
          }

          return (
            <Card key={d.dow} className="overflow-hidden">
              {/* Day header: the name, the hours you are designing against, and
                  the totals — all visible without scrolling into the day. */}
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-surface-2 px-4 py-3">
                <div className="flex items-baseline gap-3">
                  <h2 className="font-display text-lg font-semibold text-ink">{d.long}</h2>
                  <span className="nums text-[12px] text-ink-soft">
                    {t!.is24h ? "Open 24 hours" : `${t!.opensAt}–${t!.closesAt}`}
                  </span>
                </div>

                <div className="flex items-center gap-4">
                  {sum.count > 0 && (
                    <div className="flex items-baseline gap-3 text-[13px]">
                      <span className="text-ink-soft">
                        <span className="nums font-semibold text-ink">{sum.people}</span>{" "}
                        {sum.people === 1 ? "person" : "people"}
                      </span>
                      <span className="nums text-ink-soft">{formatHours(sum.hours)}</span>
                      <span className="nums font-semibold text-ink">
                        {formatMoney(roundMoney(sum.cost))}
                      </span>
                    </div>
                  )}
                  <button
                    onClick={() => setCopyModal({ dow: d.dow })}
                    disabled={sum.count === 0}
                    className="flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-ink-faint transition hover:text-ember disabled:opacity-40"
                    title="Copy this day to other days"
                  >
                    <IconCopy width={14} height={14} /> Copy
                  </button>
                </div>
              </div>

              <div className="space-y-3 px-4 py-3">
                {roleGroups.length === 0 ? (
                  <p className="py-2 text-[13px] text-ink-faint">
                    Nothing rostered yet on {d.long}.
                  </p>
                ) : (
                  <>
                    {/* Wide screens get the timeline: bars on a shared axis, so
                        duration, overlap and the evening peak are visible
                        without reading a single number. */}
                    <div className="hidden lg:block">
                      <DayTimeline
                        slots={slotsByDay.get(d.dow) ?? []}
                        trading={t!}
                        roleName={roleName}
                        roleColour={roleColour}
                        onEditSlot={(slot) => setSlotModal({ dow: d.dow, slot })}
                      />
                    </div>

                    {/* Narrow screens keep the chip list — a time axis squeezed
                        into a phone is worse than no axis at all. */}
                    <div className="space-y-3 lg:hidden">
                      {roleGroups.map((g) => (
                    <div key={g.roleId}>
                      <div className="mb-1.5 flex items-baseline gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: accentOf(roleColour(g.roleId)).dot }}
                        />
                        <span className="text-[13px] font-semibold text-ink">
                          {roleName(g.roleId)}
                        </span>
                        <span className="nums text-[12px] text-ink-faint">
                          {g.people} {g.people === 1 ? "person" : "people"}
                        </span>
                      </div>

                      {/* Chips wrap, so this reads at any width with no
                          horizontal scrollbar. */}
                      <div className="flex flex-wrap gap-2">
                        {g.slots.map((slot) => (
                          <button
                            key={slot.id}
                            onClick={() => setSlotModal({ dow: d.dow, slot })}
                            className="flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 py-1.5 text-left transition hover:border-ember hover:bg-ember-soft/40"
                          >
                            <span className="nums text-[13px] font-semibold text-ink">
                              {formatTimeShort(hhmm(slot.start_time))}–
                              {formatTimeShort(hhmm(slot.end_time))}
                              {slot.crosses_midnight && (
                                <span className="text-ink-faint" title="Finishes the next day">
                                  {" "}
                                  +1
                                </span>
                              )}
                            </span>
                            {slot.count > 1 && (
                              <span className="nums text-[13px] font-bold text-ember">
                                ×{slot.count}
                              </span>
                            )}
                            {slot.required_level && (
                              <Badge tone="ember" className="!px-1.5 !py-0 !text-[9px]">
                                {LEVEL_LABEL[slot.required_level]}
                              </Badge>
                            )}
                            {slot.label && (
                              <span className="max-w-28 truncate text-[12px] text-ink-faint">
                                {slot.label}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                      ))}
                    </div>
                  </>
                )}

                <button
                  onClick={() => setSlotModal({ dow: d.dow })}
                  className="flex min-h-11 items-center gap-1.5 rounded-xl border border-dashed border-line-strong px-3 text-[13px] font-medium text-ink-faint transition hover:border-ember hover:text-ember"
                >
                  <IconPlus width={15} height={15} /> Add a slot
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      <p className="mt-3 text-[12px] text-ink-faint">{COST_DISCLAIMER}</p>

      {slotModal && (
        <SlotModal
          dow={slotModal.dow}
          slot={slotModal.slot}
          locationId={locationId}
          trading={tradingFor(slotModal.dow)}
          roles={activeRoles}
          allowOvernight={rule?.allow_overnight ?? false}
          busy={busy}
          onClose={() => setSlotModal(null)}
          onSave={saveSlot}
          onDelete={removeSlot}
        />
      )}

      {buildFromWeek && (
        <BuildFromWeekModal
          existingSlotCount={slots.length}
          roleName={roleName}
          onClose={() => setBuildFromWeek(false)}
          onApply={applyDerivedSlots}
        />
      )}

      {copyModal && (
        <CopyDayModal
          fromDow={copyModal.dow}
          busy={busy}
          onClose={() => setCopyModal(null)}
          onCopy={runCopyDay}
        />
      )}
    </div>
  );
}

// ---------- Feasibility panel ----------

interface FeasibilityData {
  sd: { demandHours: number; capacityHours: number; shortfallHours: number };
  roleGaps: { roleId: string; dayLabel: string; needed: number; available: number }[];
  seniorSd: { demandHours: number; supplyHours: number; shortfallHours: number } | null;
  dayCoverage: { dow: number; long: string; gaps: { from: string; to: string }[] }[];
  daySenior: { dow: number; long: string; gaps: { from: string; to: string }[] }[];
}

function FeasibilityPanel({
  issueCount,
  feasibility,
  roleName,
}: {
  issueCount: number;
  feasibility: FeasibilityData;
  roleName: (id: string) => string;
}) {
  const { sd, roleGaps, seniorSd, dayCoverage, daySenior } = feasibility;
  const ok = issueCount === 0;

  return (
    <Card className="rise mt-5 overflow-hidden" >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="font-display text-base font-semibold text-ink">Feasibility</h2>
        <Badge tone={ok ? "herb" : "clay"}>
          {ok ? "No issues" : `${issueCount} ${issueCount === 1 ? "issue" : "issues"}`}
        </Badge>
      </div>

      <div className="space-y-2.5 p-4 text-[13px]">
        {/* Supply vs demand */}
        <div className="flex items-start gap-2">
          <Dot ok={sd.shortfallHours <= 0} />
          <p className="text-ink-soft">
            Template needs{" "}
            <span className="nums font-semibold text-ink">{formatHours(sd.demandHours)}</span>; your team&rsquo;s
            limits total <span className="nums font-semibold text-ink">{formatHours(sd.capacityHours)}</span>.
            {sd.shortfallHours > 0 ? (
              <span className="text-clay">
                {" "}
                Short by {formatHours(sd.shortfallHours)} — rosters will be short-staffed.
              </span>
            ) : (
              <span className="text-herb"> Team capacity covers it.</span>
            )}
          </p>
        </div>

        {/* Senior supply vs demand */}
        {seniorSd && (
          <div className="flex items-start gap-2">
            <Dot ok={seniorSd.shortfallHours <= 0} />
            <p className="text-ink-soft">
              Senior coverage needs{" "}
              <span className="nums font-semibold text-ink">{formatHours(seniorSd.demandHours)}</span> of senior
              presence; your seniors can work{" "}
              <span className="nums font-semibold text-ink">{formatHours(seniorSd.supplyHours)}</span>.
              {seniorSd.shortfallHours > 0 && (
                <span className="text-clay"> That&rsquo;s not enough by {formatHours(seniorSd.shortfallHours)}.</span>
              )}
            </p>
          </div>
        )}

        {/* Per-role shortfalls */}
        {roleGaps.map((g) => (
          <div key={g.roleId} className="flex items-start gap-2">
            <Dot ok={false} />
            <p className="text-clay">
              You need {g.needed} {roleName(g.roleId)} on {g.dayLabel} but only {g.available}{" "}
              {g.available === 1 ? "person" : "people"} can work that role.
            </p>
          </div>
        ))}

        {/* Open-hours coverage gaps */}
        {dayCoverage.map((d) => (
          <div key={`cov-${d.dow}`} className="flex items-start gap-2">
            <Dot ok={false} warn />
            <p className="text-ink-soft">
              No one is rostered{" "}
              {d.gaps.map((g, i) => (
                <span key={i} className="nums font-medium text-ink">
                  {i > 0 ? ", " : ""}
                  {g.from}–{g.to}
                </span>
              ))}{" "}
              on {d.long}.
            </p>
          </div>
        ))}

        {/* Senior coverage gaps */}
        {daySenior.map((d) => (
          <div key={`sen-${d.dow}`} className="flex items-start gap-2">
            <Dot ok={false} />
            <p className="text-clay">
              No senior can be on{" "}
              {d.gaps.map((g, i) => (
                <span key={i} className="nums font-medium">
                  {i > 0 ? ", " : ""}
                  {g.from}–{g.to}
                </span>
              ))}{" "}
              on {d.long} — senior coverage can&rsquo;t be met.
            </p>
          </div>
        ))}

        {ok && (
          <div className="flex items-center gap-2 text-herb">
            <Dot ok />
            <p>This template can be staffed by your current team.</p>
          </div>
        )}
      </div>
    </Card>
  );
}

function Dot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  const colour = ok ? "bg-herb" : warn ? "bg-saffron" : "bg-clay";
  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${colour}`} />;
}

// ---------- Slot add/edit modal ----------

interface SlotModalRole {
  id: string;
  name: string;
  shortCode: string | null;
}

const LEVELS: Level[] = ["junior", "mid", "senior"];

function SlotModal({
  dow,
  slot,
  locationId,
  trading,
  roles,
  allowOvernight,
  busy,
  onClose,
  onSave,
  onDelete,
}: {
  dow: number;
  slot?: TemplateSlotRow;
  locationId: string;
  trading: TradingDay | null;
  roles: SlotModalRole[];
  allowOvernight: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (input: Omit<SlotInput, "businessId" | "templateId">, id?: string) => void;
  onDelete: (id: string) => void;
}) {
  const dayLong = DAYS.find((d) => d.dow === dow)?.long ?? "";
  const defStart = trading?.opensAt || "09:00";
  const defEnd = trading?.closesAt || "17:00";

  const [roleId, setRoleId] = useState(slot?.role_id ?? roles[0]?.id ?? "");
  const [start, setStart] = useState(hhmm(slot?.start_time ?? defStart));
  const [end, setEnd] = useState(hhmm(slot?.end_time ?? defEnd));
  const [count, setCount] = useState(String(slot?.count ?? 1));
  const [requiredLevel, setRequiredLevel] = useState<string>(slot?.required_level ?? "");
  const [label, setLabel] = useState(slot?.label ?? "");
  const [vError, setVError] = useState<string | null>(null);

  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  };

  const validate = (): string | null => {
    if (!roleId) return "Choose a role.";
    if (!start || !end) return "Set a start and end time.";
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1) return "Count must be at least 1.";
    const overnight = toMin(end) <= toMin(start);
    if (overnight && !allowOvernight) {
      return "This shift crosses midnight, which isn't allowed for this business. Adjust the times, or enable overnight shifts in Settings.";
    }
    // Times within trading hours (M4 §5.1), unless the day is 24-hour. Uses the
    // shared cyclic-aware domain check so overnight trading days (and slots that
    // fall after midnight) are judged correctly and consistently with coverage.
    if (
      trading &&
      trading.isOpen &&
      !trading.is24h &&
      !slotWithinTradingHours(start, end, trading)
    ) {
      return `Outside trading hours (${trading.opensAt}–${trading.closesAt}). Adjust the times, or extend trading hours in Settings.`;
    }
    return null;
  };

  const submit = () => {
    const err = validate();
    if (err) {
      setVError(err);
      return;
    }
    onSave(
      {
        locationId,
        dayOfWeek: dow,
        roleId,
        start,
        end,
        count: Number(count),
        requiredLevel: (requiredLevel || null) as Level | null,
        label: label.trim() || null,
      },
      slot?.id,
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={slot ? "Edit requirement" : "Add requirement"}
      subtitle={`${dayLong}${trading?.isOpen ? (trading.is24h ? " · open 24 hours" : ` · ${trading.opensAt}–${trading.closesAt}`) : ""}`}
      footer={
        <>
          {slot && (
            <Button variant="danger" size="sm" onClick={() => onDelete(slot.id)} disabled={busy} className="mr-auto">
              <IconTrash width={15} height={15} /> Delete
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : slot ? "Save" : "Add"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {vError && (
          <p className="rounded-lg border border-clay/30 bg-clay/5 px-3 py-2 text-[13px] text-clay">{vError}</p>
        )}
        <div>
          <Label htmlFor="slot-role">Role</Label>
          <Select id="slot-role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {roles.length === 0 && <option value="">No active roles</option>}
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="slot-start">Start</Label>
            <Input id="slot-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} className="nums" />
          </div>
          <div>
            <Label htmlFor="slot-end">End</Label>
            <Input id="slot-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="nums" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="slot-count">People needed</Label>
            <Input
              id="slot-count"
              type="number"
              min={1}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="nums"
            />
          </div>
          <div>
            <Label htmlFor="slot-level">Required level</Label>
            <Select id="slot-level" value={requiredLevel} onChange={(e) => setRequiredLevel(e.target.value)}>
              <option value="">Any level</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {LEVEL_LABEL[l]} or above
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <Label htmlFor="slot-label">Label (optional)</Label>
          <Input
            id="slot-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. open, close, lunch rush"
          />
        </div>
      </div>
    </Modal>
  );
}

// ---------- Copy-day modal ----------

function CopyDayModal({
  fromDow,
  busy,
  onClose,
  onCopy,
}: {
  fromDow: number;
  busy: boolean;
  onClose: () => void;
  onCopy: (fromDow: number, toDows: number[]) => void;
}) {
  const fromLong = DAYS.find((d) => d.dow === fromDow)?.long ?? "";
  const [selected, setSelected] = useState<number[]>([]);
  const toggle = (dow: number) =>
    setSelected((prev) => (prev.includes(dow) ? prev.filter((d) => d !== dow) : [...prev, dow]));

  return (
    <Modal
      open
      onClose={onClose}
      title={`Copy ${fromLong}`}
      subtitle="Replace these days' requirements with a copy of this day"
      maxWidth={420}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onCopy(fromDow, selected)} disabled={busy || selected.length === 0}>
            {busy ? "Copying…" : `Copy to ${selected.length || "…"}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap gap-2">
        {DAYS.filter((d) => d.dow !== fromDow).map((d) => {
          const on = selected.includes(d.dow);
          return (
            <button
              key={d.dow}
              onClick={() => toggle(d.dow)}
              className={`min-h-11 rounded-xl border px-4 text-sm font-medium transition ${
                on ? "border-ember bg-ember-soft text-ember-deep" : "border-line-strong bg-surface text-ink-soft hover:border-ink-faint"
              }`}
            >
              {d.long}
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-[12px] text-ink-faint">
        The selected days&rsquo; current requirements are replaced. This does not change any roster you&rsquo;ve
        already generated.
      </p>
    </Modal>
  );
}
