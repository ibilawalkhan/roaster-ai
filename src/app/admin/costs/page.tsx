"use client";

// Module 10 — Costs & Reporting (manager screen).
//
// GOVERNING RULE (M10 §0): every dollar on this page is an INDICATIVE LABOUR-COST
// ESTIMATE FOR ROSTERING ONLY — never payroll. The disclaimer is rendered beside
// every figure, in plain words, not as fine print, because an owner who mistakes
// these numbers for wages and underpays staff has a serious problem and "the app
// said so" protects nobody.
//
// All arithmetic comes from src/lib/domain/cost-reports.ts (which itself uses the
// single shared cost.ts / timezone.ts primitives), so this screen, the roster
// grid, the template preview and the staff app can never disagree. Nothing is
// computed inline here.
//
// Access: managers only (M10 §7, M11 §4.1). The admin layout gates the route and
// RLS gates the data — a staff member gets nothing back from these queries.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { Badge, Button, Card, Input, Label, Select } from "@/components/ui";
import { IconChart } from "@/components/icons";
import { COST_DISCLAIMER } from "@/lib/domain/cost";
import {
  costByDay,
  costByLocation,
  costByPerson,
  costByRole,
  filterShifts,
  rosterCostSummary,
  type ReportPeriod,
  type ReportShift,
} from "@/lib/domain/cost-reports";
import {
  fetchCostRosters,
  fetchRangeReportShifts,
  fetchRosterReportShifts,
  type CostRosterOption,
} from "@/lib/supabase/cost-reports";
import { addDays, formatDayLabel, formatHours, formatMoney, formatRange, parseISO, todayISO } from "@/lib/utils";

type Mode = "roster" | "range";

type Selection =
  | { kind: "roster"; roster: CostRosterOption }
  | { kind: "range"; from: string; to: string };

/** Inclusive day count between two "YYYY-MM-DD" dates. */
function daysBetween(from: string, to: string): number {
  const ms = parseISO(to).getTime() - parseISO(from).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** A custom range longer than this is a report nobody reads and a query nobody wants. */
const MAX_RANGE_DAYS = 92;

const ALL = "all";

export default function CostsPage() {
  const { locations, roles, session, business } = useStore();

  const [rosters, setRosters] = useState<CostRosterOption[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [shifts, setShifts] = useState<ReportShift[] | null>(null);
  const [loadingRosters, setLoadingRosters] = useState(true);
  const [loadingShifts, setLoadingShifts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("roster");
  const [draftFrom, setDraftFrom] = useState(() => addDays(todayISO(), -13));
  const [draftTo, setDraftTo] = useState(() => todayISO());
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string>(ALL);
  const [roleId, setRoleId] = useState<string>(ALL);

  // ---- loading -------------------------------------------------------------

  const loadRosters = useCallback(async () => {
    if (!session.businessId) return;
    setLoadingRosters(true);
    setError(null);
    try {
      const list = await fetchCostRosters();
      setRosters(list);
      setSelection((prev) => prev ?? (list[0] ? { kind: "roster", roster: list[0] } : null));
      if (list.length === 0) setMode("range");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your rosters.");
    } finally {
      setLoadingRosters(false);
    }
  }, [session.businessId]);

  useEffect(() => {
    // Fetch-on-mount: setState runs after the await, never during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRosters();
  }, [loadRosters]);

  const loadShifts = useCallback(async () => {
    if (!selection) return;
    setLoadingShifts(true);
    setError(null);
    try {
      const rows =
        selection.kind === "roster"
          ? await fetchRosterReportShifts(selection.roster.id)
          : await fetchRangeReportShifts(selection.from, selection.to);
      setShifts(rows);
    } catch (e) {
      setShifts(null);
      setError(e instanceof Error ? e.message : "Couldn't load the cost figures.");
    } finally {
      setLoadingShifts(false);
    }
  }, [selection]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadShifts();
  }, [loadShifts]);

  const retry = useCallback(() => {
    if (rosters.length === 0) void loadRosters();
    else void loadShifts();
  }, [rosters.length, loadRosters, loadShifts]);

  // ---- period + filters ----------------------------------------------------

  const period = useMemo<ReportPeriod | undefined>(() => {
    if (!selection) return undefined;
    return selection.kind === "roster"
      ? { startDate: selection.roster.startDate, days: selection.roster.days }
      : { startDate: selection.from, days: daysBetween(selection.from, selection.to) };
  }, [selection]);

  const periodLabel = useMemo(() => {
    if (!period) return "";
    return formatRange(period.startDate, addDays(period.startDate, period.days - 1));
  }, [period]);

  const activeLocations = useMemo(() => locations.filter((l) => l.active), [locations]);
  const roleName = useCallback(
    (id: string) => roles.find((r) => r.id === id)?.name ?? "Unknown role",
    [roles],
  );
  const locationName = useCallback(
    (id: string) => locations.find((l) => l.id === id)?.name ?? "Unknown location",
    [locations],
  );

  // The location filter applies to EVERY view (M10 §5); the role filter narrows
  // the by-person table only, and that table states its own subtotal so the
  // narrowed column still adds up.
  const scoped = useMemo(
    () => filterShifts(shifts ?? [], { locationId: locationId === ALL ? null : locationId }),
    [shifts, locationId],
  );
  const summary = useMemo(() => rosterCostSummary(scoped, period), [scoped, period]);
  const days = useMemo(() => costByDay(scoped, period), [scoped, period]);
  const byRole = useMemo(() => costByRole(scoped), [scoped]);
  const byLocation = useMemo(() => costByLocation(scoped), [scoped]);

  const personScoped = useMemo(
    () => filterShifts(scoped, { roleId: roleId === ALL ? null : roleId }),
    [scoped, roleId],
  );
  const people = useMemo(() => costByPerson(personScoped), [personScoped]);
  const peopleTotals = useMemo(() => rosterCostSummary(personScoped), [personScoped]);

  const draftRoster = selection?.kind === "roster" && selection.roster.status === "draft";
  const hasData = (shifts?.length ?? 0) > 0;

  // ---- range picker --------------------------------------------------------

  const applyRange = () => {
    if (!draftFrom || !draftTo) {
      setRangeError("Choose a start and an end date.");
      return;
    }
    const span = daysBetween(draftFrom, draftTo);
    if (span < 1) {
      setRangeError("The end date must be on or after the start date.");
      return;
    }
    if (span > MAX_RANGE_DAYS) {
      setRangeError(`Choose a range of up to ${MAX_RANGE_DAYS} days.`);
      return;
    }
    setRangeError(null);
    setSelection({ kind: "range", from: draftFrom, to: draftTo });
  };

  // ---- render --------------------------------------------------------------

  if (loadingRosters && !selection) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8">
        <Card className="p-8 text-center text-sm text-ink-faint">Loading labour costs…</Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Labour cost</h1>
          <p className="mt-1 text-sm text-ink-soft">
            What this roster is estimated to cost, and where the money is going.
          </p>
        </div>
        {periodLabel && (
          <div className="flex items-center gap-2">
            <Badge tone="neutral">{periodLabel}</Badge>
            {draftRoster && <Badge tone="saffron">Draft</Badge>}
          </div>
        )}
      </header>

      {/* The disclaimer, unmissable and first — M10 §0. */}
      <div className="rise mt-4 rounded-xl border border-saffron/40 bg-saffron-soft/50 px-4 py-3 text-[13px] leading-relaxed text-[#8a6212]">
        <strong className="font-semibold">{COST_DISCLAIMER}</strong> Every figure below is rostered
        hours multiplied by the base rate you entered for each person. It does not include casual
        loading, penalty rates, overtime, allowances, superannuation or tax, so do not use it to pay
        anyone.
      </div>

      {error && (
        <div className="rise mt-4 flex items-center justify-between gap-3 rounded-xl border border-clay/30 bg-clay/5 px-4 py-2.5 text-[13px] text-clay">
          <span>{error}</span>
          <button onClick={retry} className="min-h-11 shrink-0 px-2 font-semibold underline">
            Retry
          </button>
        </div>
      )}

      {/* ---- period + location pickers (M10 §5) ---- */}
      <Card className="rise mt-5 p-4" >
        <div className="flex flex-wrap items-end gap-3">
          <div className="inline-flex rounded-[11px] border border-line bg-surface p-1 shadow-soft">
            {(["roster", "range"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                disabled={m === "roster" && rosters.length === 0}
                className={`min-h-11 rounded-lg px-3.5 text-[13px] font-medium transition disabled:opacity-40 ${
                  mode === m ? "bg-charcoal text-paper" : "text-ink-soft hover:text-ink"
                }`}
              >
                {m === "roster" ? "By roster" : "Custom dates"}
              </button>
            ))}
          </div>

          {mode === "roster" ? (
            <div className="min-w-56 flex-1 sm:max-w-xs">
              <Label htmlFor="cost-roster">Period</Label>
              <Select
                id="cost-roster"
                value={selection?.kind === "roster" ? selection.roster.id : ""}
                onChange={(e) => {
                  const r = rosters.find((x) => x.id === e.target.value);
                  if (r) setSelection({ kind: "roster", roster: r });
                }}
              >
                {rosters.length === 0 && <option value="">No rosters yet</option>}
                {rosters.map((r, i) => (
                  <option key={r.id} value={r.id}>
                    {i === 0 ? "Current — " : ""}
                    {formatRange(r.startDate, addDays(r.startDate, r.days - 1))}
                    {r.status === "draft" ? " (draft)" : ""}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <>
              <div className="w-44">
                <Label htmlFor="cost-from">From</Label>
                <Input
                  id="cost-from"
                  type="date"
                  value={draftFrom}
                  onChange={(e) => setDraftFrom(e.target.value)}
                  className="nums"
                />
              </div>
              <div className="w-44">
                <Label htmlFor="cost-to">To</Label>
                <Input
                  id="cost-to"
                  type="date"
                  value={draftTo}
                  onChange={(e) => setDraftTo(e.target.value)}
                  className="nums"
                />
              </div>
              <Button onClick={applyRange} className="min-h-11">
                Show costs
              </Button>
            </>
          )}

          {activeLocations.length > 1 && (
            <div className="min-w-48 sm:ml-auto">
              <Label htmlFor="cost-location">Location</Label>
              <Select
                id="cost-location"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                <option value={ALL}>All locations</option>
                {activeLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>

        {rangeError && <p className="mt-3 text-[13px] text-clay">{rangeError}</p>}

        {draftRoster && (
          <p className="mt-3 text-[12px] text-ink-soft">
            This roster isn&rsquo;t published yet — these figures estimate a plan that may still change.
          </p>
        )}
      </Card>

      {/* ---- states ---- */}
      {loadingShifts ? (
        <Card className="mt-5 p-8 text-center text-sm text-ink-faint">Working out the costs…</Card>
      ) : !selection ? (
        <EmptyState
          title="No rosters yet"
          body="Create a roster and its estimated labour cost will appear here — by day, by person and by role."
        />
      ) : !hasData ? (
        <EmptyState
          title="Nothing rostered in this period"
          body="There are no shifts or open positions between these dates, so there is nothing to cost. Try another period."
        />
      ) : (
        <>
          {/* ---- 3.1 Summary ---- */}
          <div className="rise mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="p-5">
              <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
                Estimated cost
              </p>
              <p className="nums mt-2 font-display text-3xl font-semibold leading-none text-ink">
                {formatMoney(summary.totalCost)}
              </p>
              <p className="mt-1.5 text-sm text-ink-soft">
                {summary.unfilledCount > 0 ? (
                  <span className="text-clay">
                    {summary.unfilledCount} position{summary.unfilledCount === 1 ? "" : "s"} unfilled
                    {" · "}
                    {formatHours(summary.unfilledHours)} uncovered
                  </span>
                ) : (
                  "Every position filled"
                )}
              </p>
              <p className="mt-1 text-[11px] text-ink-faint">{COST_DISCLAIMER}</p>
            </Card>

            <Card className="p-5">
              <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
                Rostered hours
              </p>
              <p className="nums mt-2 font-display text-3xl font-semibold leading-none text-ink">
                {formatHours(summary.totalHours)}
              </p>
              <p className="mt-1.5 text-sm text-ink-soft">
                {summary.shiftCount} shift{summary.shiftCount === 1 ? "" : "s"}
              </p>
            </Card>

            <Card className="p-5">
              <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
                People rostered
              </p>
              <p className="nums mt-2 font-display text-3xl font-semibold leading-none text-ink">
                {summary.peopleCount}
              </p>
              <p className="mt-1.5 text-sm text-ink-soft">across {periodLabel}</p>
            </Card>

            <Card className="p-5">
              <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
                Average $/hour
              </p>
              <p className="nums mt-2 font-display text-3xl font-semibold leading-none text-ink">
                {formatMoney(summary.averageHourlyRate, true)}
              </p>
              <p className="mt-1.5 text-sm text-ink-soft">base rates only</p>
              <p className="mt-1 text-[11px] text-ink-faint">{COST_DISCLAIMER}</p>
            </Card>
          </div>

          {summary.missingRateCount > 0 && (
            <div className="mt-4 rounded-xl border border-clay/30 bg-clay/5 px-4 py-2.5 text-[13px] text-clay">
              {summary.missingRateCount} rostered shift
              {summary.missingRateCount === 1 ? " has" : "s have"} no pay rate recorded, so
              {summary.missingRateCount === 1 ? " its" : " their"} cost is missing from these totals.
              The hours are still counted.
            </div>
          )}

          {/* ---- 3.1 Week 1 vs week 2 ---- */}
          {summary.weeks.length > 1 && (
            <Card className="rise mt-5 overflow-hidden">
              <SectionHeading title="Week by week" note={`${summary.weeks.length} weeks in this period`} />
              <div className="grid gap-px bg-line sm:grid-cols-2">
                {summary.weeks.map((w) => (
                  <div key={w.index} className="bg-surface p-4">
                    <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
                      Week {w.index}
                    </p>
                    <p className="text-[12px] text-ink-faint">{formatRange(w.startDate, w.endDate)}</p>
                    <p className="nums mt-2 font-display text-2xl font-semibold text-ink">
                      {formatMoney(w.cost)}
                    </p>
                    <p className="mt-1 text-sm text-ink-soft">
                      {formatHours(w.hours)} · {w.shiftCount} shift{w.shiftCount === 1 ? "" : "s"}
                      {w.unfilledCount > 0 && (
                        <span className="text-clay"> · {w.unfilledCount} unfilled</span>
                      )}
                    </p>
                  </div>
                ))}
              </div>
              <Footnote />
            </Card>
          )}

          {/* ---- 3.2 Cost by day ---- */}
          <Card className="rise mt-5 overflow-hidden">
            <SectionHeading
              title="Cost by day"
              note="A shift that runs past midnight counts entirely on the day it starts."
            />
            <DayChart
              days={days}
              total={summary.totalCost}
              totalHours={summary.totalHours}
            />
            <Footnote />
          </Card>

          {/* ---- 3.3 Cost by team member ---- */}
          <Card className="rise mt-5 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div>
                <h2 className="font-display text-base font-semibold text-ink">Cost by team member</h2>
                <p className="mt-0.5 text-[12px] text-ink-soft">
                  Ranked highest to lowest, using the pay rate saved on each shift when it was
                  assigned — a later pay change never rewrites these figures.
                </p>
              </div>
              {roles.length > 0 && (
                <div className="w-44">
                  <Select
                    value={roleId}
                    onChange={(e) => setRoleId(e.target.value)}
                    aria-label="Filter by role"
                  >
                    <option value={ALL}>All roles</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>

            {people.length === 0 ? (
              <p className="p-6 text-center text-sm text-ink-faint">
                Nobody is rostered in this period{roleId === ALL ? "" : " for that role"}.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                      <th scope="col" className="px-4 py-2 font-semibold">Person</th>
                      <th scope="col" className="px-4 py-2 text-right font-semibold">Shifts</th>
                      <th scope="col" className="px-4 py-2 text-right font-semibold">Hours</th>
                      <th scope="col" className="px-4 py-2 text-right font-semibold">Rate</th>
                      <th scope="col" className="px-4 py-2 text-right font-semibold">Est. cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((p) => (
                      <tr key={p.userId} className="border-b border-line last:border-0">
                        <th scope="row" className="px-4 py-2.5 text-left font-medium text-ink">
                          {p.name}
                        </th>
                        <td className="nums px-4 py-2.5 text-right text-ink-soft">{p.shiftCount}</td>
                        <td className="nums px-4 py-2.5 text-right text-ink-soft">
                          {formatHours(p.hours)}
                        </td>
                        <td className="nums px-4 py-2.5 text-right text-ink-soft">
                          {formatMoney(p.rate, true)}
                          {p.rateVaries && (
                            <span className="ml-1 text-[11px] text-ink-faint" title="More than one rate was saved on this person's shifts">
                              avg
                            </span>
                          )}
                        </td>
                        <td className="nums px-4 py-2.5 text-right font-semibold text-ink">
                          {formatMoney(p.cost, true)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-line-strong bg-surface-2">
                      <th scope="row" className="px-4 py-2.5 text-left font-semibold text-ink">
                        Total
                      </th>
                      <td className="nums px-4 py-2.5 text-right text-ink-soft">
                        {peopleTotals.shiftCount}
                      </td>
                      <td className="nums px-4 py-2.5 text-right text-ink-soft">
                        {formatHours(peopleTotals.totalHours)}
                      </td>
                      <td className="nums px-4 py-2.5 text-right text-ink-soft">
                        {formatMoney(peopleTotals.averageHourlyRate, true)}
                      </td>
                      <td className="nums px-4 py-2.5 text-right font-semibold text-ink">
                        {formatMoney(peopleTotals.totalCost, true)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <Footnote />
          </Card>

          {/* ---- 3.4 / 3.5 Cost by role and by location ---- */}
          <div className="rise mt-5 grid gap-4 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <SectionHeading title="Cost by role" note="Where the money goes when you trim." />
              <ShareList
                rows={byRole.map((r) => ({
                  key: r.roleId,
                  label: roleName(r.roleId),
                  cost: r.cost,
                  hours: r.hours,
                  share: r.share,
                  unfilledCount: r.unfilledCount,
                }))}
                total={summary.totalCost}
              />
              <Footnote />
            </Card>

            <Card className="overflow-hidden">
              <SectionHeading
                title="Cost by location"
                note="A person's cost sits with the shift's location, not their home one."
              />
              <ShareList
                rows={byLocation.map((l) => ({
                  key: l.locationId,
                  label: locationName(l.locationId),
                  cost: l.cost,
                  hours: l.hours,
                  share: l.share,
                  unfilledCount: l.unfilledCount,
                }))}
                total={summary.totalCost}
              />
              <Footnote />
            </Card>
          </div>

          <p className="mt-5 text-[12px] leading-relaxed text-ink-faint">
            Figures are shown in {business?.currency ?? "AUD"} and organised by trading day in your
            business timezone. {COST_DISCLAIMER}
          </p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function SectionHeading({ title, note }: { title: string; note?: string }) {
  return (
    <div className="border-b border-line px-4 py-3">
      <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
      {note && <p className="mt-0.5 text-[12px] text-ink-soft">{note}</p>}
    </div>
  );
}

/** The disclaimer, repeated wherever a dollar figure is (M10 §0). */
function Footnote() {
  return (
    <p className="border-t border-line bg-surface-2 px-4 py-2 text-[11px] text-ink-faint">
      {COST_DISCLAIMER}
    </p>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card className="mt-5 p-10 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-herb-soft text-herb">
        <IconChart width={26} height={26} />
      </span>
      <h2 className="mt-4 font-display text-xl font-semibold text-ink">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-soft">{body}</p>
    </Card>
  );
}

interface DayRow {
  date: string;
  cost: number;
  hours: number;
  shiftCount: number;
  unfilledCount: number;
  unfilledHours: number;
}

/**
 * The cost-by-day bar chart (M10 §3.2). Plain CSS bars — no chart library.
 *
 * Accessibility: the bars are decorative (`aria-hidden`), and every number they
 * encode is present as ordinary text in the same row, so a screen reader reads
 * "Mon 3 Aug, $612, 20h" rather than an unlabelled graphic.
 */
function DayChart({
  days,
  total,
  totalHours,
}: {
  days: DayRow[];
  total: number;
  totalHours: number;
}) {
  const max = days.reduce((m, d) => Math.max(m, d.cost), 0);

  return (
    <>
      <ul className="divide-y divide-line">
        {days.map((d) => {
          const width = max > 0 ? (d.cost / max) * 100 : 0;
          return (
            <li key={d.date} className="flex items-center gap-3 px-4 py-2">
              <span className="w-24 shrink-0 text-[12px] font-medium text-ink">
                {formatDayLabel(d.date)}
              </span>
              <span
                aria-hidden="true"
                className="hidden h-4 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2 sm:block"
              >
                <span
                  className="block h-full rounded-full bg-ember"
                  style={{ width: `${width}%` }}
                />
              </span>
              <span className="nums w-24 shrink-0 text-right text-[13px] font-semibold text-ink">
                {formatMoney(d.cost)}
              </span>
              <span className="nums w-16 shrink-0 text-right text-[12px] text-ink-soft">
                {formatHours(d.hours)}
              </span>
              <span className="w-24 shrink-0 text-right text-[11px]">
                {d.unfilledCount > 0 ? (
                  <span className="text-clay">{d.unfilledCount} unfilled</span>
                ) : (
                  <span className="text-ink-faint">
                    {d.shiftCount} shift{d.shiftCount === 1 ? "" : "s"}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-3 border-t border-line-strong bg-surface-2 px-4 py-2.5">
        <span className="w-24 shrink-0 text-[12px] font-semibold text-ink">Total</span>
        <span aria-hidden="true" className="hidden min-w-0 flex-1 sm:block" />
        <span className="nums w-24 shrink-0 text-right text-[13px] font-semibold text-ink">
          {formatMoney(total)}
        </span>
        <span className="nums w-16 shrink-0 text-right text-[12px] text-ink-soft">
          {formatHours(totalHours)}
        </span>
        <span className="w-24 shrink-0" />
      </div>
    </>
  );
}

interface ShareRow {
  key: string;
  label: string;
  cost: number;
  hours: number;
  share: number;
  unfilledCount: number;
}

/** Cost and share of the total for a bucket (role or location) — M10 §3.4–3.5. */
function ShareList({ rows, total }: { rows: ShareRow[]; total: number }) {
  if (rows.length === 0) {
    return <p className="p-6 text-center text-sm text-ink-faint">Nothing rostered in this period.</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.key} className="px-4 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[13px] font-medium text-ink">{r.label}</span>
            <span className="nums shrink-0 text-[13px] font-semibold text-ink">
              {formatMoney(r.cost, true)}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-3">
            <span
              aria-hidden="true"
              className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2"
            >
              <span
                className="block h-full rounded-full bg-herb"
                style={{ width: `${Math.round(r.share * 100)}%` }}
              />
            </span>
            <span className="nums shrink-0 text-[11px] text-ink-soft">
              {Math.round(r.share * 100)}% · {formatHours(r.hours)}
              {r.unfilledCount > 0 && (
                <span className="text-clay"> · {r.unfilledCount} unfilled</span>
              )}
            </span>
          </div>
        </li>
      ))}
      <li className="flex items-baseline justify-between gap-3 border-t border-line-strong bg-surface-2 px-4 py-2.5">
        <span className="text-[13px] font-semibold text-ink">Total</span>
        <span className="nums text-[13px] font-semibold text-ink">{formatMoney(total, true)}</span>
      </li>
    </ul>
  );
}
