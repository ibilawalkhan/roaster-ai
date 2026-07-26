"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { Badge, Button, Card, Input, Label, Modal, Select } from "@/components/ui";
import { IconCopy, IconPlus, IconTrash } from "@/components/icons";
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
import { LEVEL_LABEL, type Level } from "@/lib/types";
import { formatHours, formatMoney, formatTimeShort } from "@/lib/utils";

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
  const roleShort = (id: string) => {
    const r = roles.find((x) => x.id === id);
    return r?.shortCode || r?.name?.slice(0, 3).toUpperCase() || "—";
  };
  const roleName = (id: string) => roles.find((x) => x.id === id)?.name ?? "Unknown role";

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

      {/* Grid */}
      <div className="rise mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7" style={{ animationDelay: "120ms" }}>
        {DAYS.map((d) => {
          const t = tradingFor(d.dow);
          const closed = !t || !t.isOpen;
          const daySlots = (slotsByDay.get(d.dow) ?? []).slice().sort((a, b) =>
            hhmm(a.start_time).localeCompare(hhmm(b.start_time)),
          );
          const sum = daySummary(d.dow);
          return (
            <Card key={d.dow} className={`flex flex-col overflow-hidden ${closed ? "opacity-70" : ""}`}>
              <div className="border-b border-line bg-surface-2 px-3 py-2.5">
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-sm font-semibold text-ink">{d.short}</span>
                  <span className="nums text-[11px] text-ink-faint">
                    {closed ? "Closed" : t!.is24h ? "24 hours" : `${t!.opensAt}–${t!.closesAt}`}
                  </span>
                </div>
              </div>

              <div className="flex-1 space-y-1.5 p-2">
                {closed ? (
                  <p className="px-1 py-6 text-center text-[12px] text-ink-faint">
                    Closed. Open this day in Settings to add requirements.
                  </p>
                ) : (
                  <>
                    {daySlots.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setSlotModal({ dow: d.dow, slot: s })}
                        className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-left transition hover:border-ink-faint hover:bg-surface-2"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate text-[12px] font-semibold text-ink">
                            {roleShort(s.role_id)}
                            {s.count > 1 && <span className="text-ember"> ×{s.count}</span>}
                          </span>
                          {s.required_level && (
                            <Badge tone="ember" className="!px-1.5 !py-0 !text-[9px]">
                              {LEVEL_LABEL[s.required_level]}
                            </Badge>
                          )}
                        </div>
                        <p className="nums mt-0.5 text-[11px] text-ink-soft">
                          {formatTimeShort(hhmm(s.start_time))}–{formatTimeShort(hhmm(s.end_time))}
                          {s.crosses_midnight && <span className="text-ink-faint"> +1</span>}
                        </p>
                        {s.label && <p className="truncate text-[10px] text-ink-faint">{s.label}</p>}
                      </button>
                    ))}
                    <button
                      onClick={() => setSlotModal({ dow: d.dow })}
                      className="flex min-h-11 w-full items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong text-[12px] font-medium text-ink-faint transition hover:border-ember hover:text-ember"
                    >
                      <IconPlus width={14} height={14} /> Add
                    </button>
                  </>
                )}
              </div>

              {!closed && (
                <div className="border-t border-line px-3 py-2 text-[11px] text-ink-soft">
                  <div className="flex items-center justify-between">
                    <span>{sum.people} ppl</span>
                    <span className="nums">{formatHours(sum.hours)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between">
                    <span className="nums font-semibold text-ink">{formatMoney(roundMoney(sum.cost))}</span>
                    <button
                      onClick={() => setCopyModal({ dow: d.dow })}
                      disabled={sum.count === 0}
                      className="flex items-center gap-1 rounded-md px-1.5 py-1 text-ink-faint transition hover:text-ember disabled:opacity-40"
                      title="Copy this day to other days"
                    >
                      <IconCopy width={13} height={13} /> Copy
                    </button>
                  </div>
                </div>
              )}
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
