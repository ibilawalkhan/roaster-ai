"use client";

// Modules 5 + 6 — the roster screen: create, generate, review, edit, publish.
//
//   choose a period → seed concrete requirements from the template → pre-flight
//   → generate → review and adjust → publish.
//
// The rules this screen exists to hold (M6 §1, §3.2):
//
//   The algorithm proposes; the manager decides. The app never blocks a decision
//   the manager is entitled to make — it makes sure he makes it KNOWINGLY. So
//   physically-impossible edits are refused, policy breaches are allowed and
//   named, and an accepted breach is written to `roster_warning` where it stays
//   visible until it's genuinely gone.
//
//   Nothing is lost. A solver outage keeps the seeded roster (M5 §10); a failed
//   save rolls back visibly and re-reads the server (M6 §6) — a phantom
//   assignment is the worst bug this screen could have.
//
//   Draft versus published is never ambiguous.
//
// Notifications are Module 9: every edit writes a `roster_change_log` row with
// `notified` false, and nothing is sent from here.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { Badge, Button, Card } from "@/components/ui";
import { IconSparkle, IconTrash } from "@/components/icons";
import {
  fetchBusinessExceptions,
  fetchBusinessPatterns,
  fetchTradingHours,
  type ExceptionRow,
  type PatternRow,
  type TradingHoursRow,
} from "@/lib/supabase/availability";
import {
  ensureTemplate,
  fetchSchedulingRule,
  fetchSlots,
  type SchedulingRuleRow,
  type TemplateSlotRow,
} from "@/lib/supabase/template";
import {
  applyAssignments,
  createRoster,
  deleteRoster,
  fetchLatestRoster,
  fetchPositions,
  fetchRoster,
  fetchShifts,
  fetchSolveRuns,
  recordSolveRun,
  seedPositionsFromTemplate,
  toExpandedPosition,
  type RosterPositionRow,
  type RosterRow,
  type ShiftRow,
} from "@/lib/supabase/roster";
import {
  acknowledgeWarning,
  addPosition,
  assignShift,
  deletePosition,
  editShiftTimes,
  fetchChangeLog,
  fetchWarnings,
  publishRoster,
  reassignShift,
  removeAssignment,
  resolveWarning,
  syncShiftWarnings,
  toggleLock,
  unpublishRoster,
  type ChangeLogRow,
  type EditContext,
  type RosterWarningRow,
} from "@/lib/supabase/roster-edit";
import {
  buildSolveRequest,
  expandPositions,
  totalPositionHours,
  type AvailabilityInput,
  type ExpandedPosition,
  type MemberInput,
  type SlotInput,
  type SolvePair,
  type SolverRuleInput,
  type TradingHoursInput,
} from "@/lib/domain/solver-request";
import { runPreflight, type PreflightResult } from "@/lib/domain/preflight";
import {
  checkEligibility,
  seniorCoverageGaps,
  type EligibilityContext,
  type EligibilityIssue,
  type EligibilityShift,
} from "@/lib/domain/eligibility";
import {
  addDaysISO,
  dateRange,
  elapsedHours,
  minutesOfDay,
  wallTimeIn,
  zonedInstant,
} from "@/lib/domain/timezone";
import { roundMoney, shiftCost } from "@/lib/domain/cost";
import {
  requestSolve,
  solveResponseSchema,
  SolverUnavailableError,
  isRetryable,
  type SolveResponse,
} from "@/lib/solver/client";
import { type Level } from "@/lib/types";
import { formatRange, todayISO } from "@/lib/utils";
import {
  AcceptedExceptionsPanel,
  ChangeLogPanel,
  CreateRosterPanel,
  HealthPanel,
  PreflightPanel,
  SeededSummary,
  type ShiftWarningEntry,
  type UnfilledEntry,
} from "./panels";
import { RosterGrid } from "./grid";
import {
  AddPositionModal,
  PRIORITY_PRESETS,
  PublishModal,
  RegenerateModal,
  ShiftEditorModal,
  type NewPositionDraft,
  type PickerCandidate,
  type ShiftPatch,
} from "./modals";

const DEFAULT_TIMEZONE = "Australia/Sydney";
const hhmm = (t: string | null): string => (t ? t.slice(0, 5) : "");

// ---------------------------------------------------------------------------
// Row → domain adapters
// ---------------------------------------------------------------------------

function toRuleInput(r: SchedulingRuleRow | null): SolverRuleInput {
  return {
    maxHoursCasual: r?.max_hours_casual ?? 38,
    maxHoursPartTime: r?.max_hours_part_time ?? 30,
    maxHoursFullTime: r?.max_hours_full_time ?? 38,
    seniorCoverageEnabled: r?.senior_coverage_enabled ?? false,
    seniorMinCount: r?.senior_min_count ?? 1,
    seniorQualifyingLevels: (r?.senior_qualifying_levels as Level[] | undefined) ?? ["senior"],
    maxConsecutiveDays: r?.max_consecutive_days ?? 6,
    minRestHours: r?.min_rest_hours ?? 10,
    maxShiftHours: r?.max_shift_hours ?? 12,
    minShiftHours: r?.min_shift_hours ?? 3,
    oneShiftPerDay: r?.one_shift_per_day ?? true,
    softPriorityOrder: r?.soft_priority_order,
  };
}

function toSlotInput(s: TemplateSlotRow): SlotInput {
  return {
    id: s.id,
    locationId: s.location_id,
    dayOfWeek: s.day_of_week,
    roleId: s.role_id,
    start: hhmm(s.start_time),
    end: hhmm(s.end_time),
    count: s.count,
    requiredLevel: s.required_level,
    label: s.label,
  };
}

function toTradingInput(t: TradingHoursRow): TradingHoursInput {
  return {
    locationId: t.location_id,
    dayOfWeek: t.day_of_week,
    isOpen: t.is_open,
    is24h: t.is_24h,
    opensAt: hhmm(t.opens_at) || null,
    closesAt: hhmm(t.closes_at) || null,
  };
}

function toAvailabilityInput(
  patterns: PatternRow[],
  exceptions: ExceptionRow[],
): AvailabilityInput {
  return {
    patterns: patterns.map((p) => ({
      userId: p.user_id,
      dayOfWeek: p.day_of_week,
      isAvailable: p.is_available,
      from: hhmm(p.from_time) || null,
      to: hhmm(p.to_time) || null,
    })),
    exceptions: exceptions.map((e) => ({
      userId: e.user_id,
      date: e.date,
      isAvailable: e.is_available,
      from: hhmm(e.from_time) || null,
      to: hhmm(e.to_time) || null,
    })),
  };
}

/** The next roster period start on or after today, per the business week start. */
function nextPeriodStart(weekStartDay: number): string {
  const today = todayISO();
  const [y, m, d] = today.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDaysISO(today, (weekStartDay - dow + 7) % 7);
}

interface EditorTarget {
  position: RosterPositionRow;
  shift: ShiftRow | null;
}

// ---------------------------------------------------------------------------

export default function SchedulePage() {
  const { business, locations, roles, team, session, updateMember } = useStore();
  const timezone = business?.timezone ?? DEFAULT_TIMEZONE;
  const days = business?.rosterPeriod === "fortnight" ? 14 : 7;

  // Reference data
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [slots, setSlots] = useState<TemplateSlotRow[]>([]);
  const [trading, setTrading] = useState<TradingHoursRow[]>([]);
  const [ruleRow, setRuleRow] = useState<SchedulingRuleRow | null>(null);
  const [patterns, setPatterns] = useState<PatternRow[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);

  // The roster being worked on
  const [roster, setRoster] = useState<RosterRow | null>(null);
  const [positions, setPositions] = useState<RosterPositionRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [warningRows, setWarningRows] = useState<RosterWarningRow[]>([]);
  const [changeLog, setChangeLog] = useState<ChangeLogRow[]>([]);
  const [response, setResponse] = useState<SolveResponse | null>(null);

  // Screen state
  const [startDateOverride, setStartDateOverride] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [solverMessage, setSolverMessage] = useState<string | null>(null);
  const [solverRetryable, setSolverRetryable] = useState(false);
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [addingPosition, setAddingPosition] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [presetId, setPresetId] = useState("fairness");
  const [exclusions, setExclusions] = useState<SolvePair[]>([]);
  const [focusedCell, setFocusedCell] = useState<string | null>(null);

  // ---- loading ----
  const load = useCallback(async () => {
    if (!session.businessId) return;
    setError(null);
    try {
      const template = await ensureTemplate(session.businessId);
      const existing = await fetchLatestRoster();
      // Exceptions are fetched for the roster's own dates; with no roster yet,
      // cover generously — the manager can start the period up to a week out.
      const windowStart = existing?.start_date ?? todayISO();
      const windowEnd = existing
        ? addDaysISO(windowStart, existing.days)
        : addDaysISO(windowStart, days + 21);

      const [slotRows, tradingRows, rule, patternRows, exceptionRows] = await Promise.all([
        fetchSlots(template.id),
        fetchTradingHours(),
        fetchSchedulingRule(),
        fetchBusinessPatterns(),
        fetchBusinessExceptions(windowStart, windowEnd),
      ]);

      setTemplateId(template.id);
      setSlots(slotRows);
      setTrading(tradingRows);
      setRuleRow(rule);
      setPatterns(patternRows);
      setExceptions(exceptionRows);
      setRoster(existing);

      if (existing) {
        const [pos, sh, wr, log, runs] = await Promise.all([
          fetchPositions(existing.id),
          fetchShifts(existing.id),
          fetchWarnings(existing.id),
          fetchChangeLog(existing.id, 30),
          fetchSolveRuns(existing.id),
        ]);
        setPositions(pos);
        setShifts(sh);
        setWarningRows(wr);
        setChangeLog(log);
        // Restore the last solve's reasons so a reload never turns "3 unfilled,
        // here's why" into a bare count (M6 §2.2).
        const lastOk = runs.find((r) => r.status !== "failed" && r.response_json !== null);
        const parsed = lastOk ? solveResponseSchema.safeParse(lastOk.response_json) : null;
        setResponse(parsed?.success ? parsed.data : null);
      } else {
        setPositions([]);
        setShifts([]);
        setWarningRows([]);
        setChangeLog([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your rosters.");
    } finally {
      setLoading(false);
    }
  }, [session.businessId, days]);

  useEffect(() => {
    // Fetch-on-mount: setState runs after the await, never during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /** Re-read everything about the roster from the server — the source of truth. */
  const refreshRoster = useCallback(async (id: string) => {
    const [r, pos, sh, wr, log] = await Promise.all([
      fetchRoster(id),
      fetchPositions(id),
      fetchShifts(id),
      fetchWarnings(id),
      fetchChangeLog(id, 30),
    ]);
    if (r) setRoster(r);
    setPositions(pos);
    setShifts(sh);
    setWarningRows(wr);
    setChangeLog(log);
  }, []);

  // ---- derived inputs ----
  const weekStartDay = business?.weekStartDay ?? 1;
  const defaultStart = useMemo(() => nextPeriodStart(weekStartDay), [weekStartDay]);
  const startDate = startDateOverride ?? defaultStart;

  const ruleInput = useMemo(() => toRuleInput(ruleRow), [ruleRow]);
  const slotInputs = useMemo(() => slots.map(toSlotInput), [slots]);
  const tradingInputs = useMemo(() => trading.map(toTradingInput), [trading]);
  const availabilityInput = useMemo(
    () => toAvailabilityInput(patterns, exceptions),
    [patterns, exceptions],
  );
  const memberInputs = useMemo<MemberInput[]>(
    () =>
      team.map((m) => ({
        id: m.id,
        name: m.name,
        active: m.active,
        level: m.level,
        employmentType: m.employmentType,
        roleIds: m.roleIds,
        homeLocationId: m.homeLocationId,
        canWorkOtherLocations: m.canWorkOtherLocations,
        payRate: m.payRate,
        maxHoursWeek: m.maxHoursWeek,
        minHoursWeek: m.minHoursWeek,
        maxShiftsWeek: m.maxShiftsWeek,
        preferredDays: m.preferredDays,
        preferredTimeOfDay: m.preferredTimeOfDay,
      })),
    [team],
  );
  const roleOptions = useMemo(
    () => roles.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name })),
    [roles],
  );
  const roleNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of roles) m[r.id] = r.name;
    return m;
  }, [roles]);
  const roleName = useCallback((id: string) => roleNames[id] ?? "Unknown role", [roleNames]);
  const personName = useCallback(
    (id: string | null) => (id ? (team.find((m) => m.id === id)?.name ?? "Someone") : "System"),
    [team],
  );

  /**
   * The demand being reasoned about: the seeded positions once a roster exists,
   * otherwise a preview expansion of the template for the chosen start date.
   * A roster NEVER re-reads the template — that is what makes a template edit
   * safe after generation.
   */
  const previewPositions = useMemo<ExpandedPosition[]>(
    () =>
      expandPositions({
        rosterStart: startDate,
        days,
        timezone,
        slots: slotInputs,
        tradingHours: tradingInputs,
      }),
    [startDate, days, timezone, slotInputs, tradingInputs],
  );

  const seededPositions = useMemo<ExpandedPosition[]>(
    () => positions.map((p) => toExpandedPosition(p, timezone)),
    [positions, timezone],
  );

  const activePositions = roster ? seededPositions : previewPositions;
  const rosterStart = roster?.start_date ?? startDate;
  const rosterDays = roster?.days ?? days;
  const dates = useMemo(() => dateRange(rosterStart, rosterDays), [rosterStart, rosterDays]);
  const published = roster?.status === "published";

  const preflight = useMemo<PreflightResult>(
    () =>
      runPreflight({
        positions: activePositions,
        members: memberInputs,
        roles: roleOptions,
        availability: availabilityInput,
        tradingHours: tradingInputs,
        rule: ruleInput,
        rosterStart,
        days: rosterDays,
      }),
    [
      activePositions,
      memberInputs,
      roleOptions,
      availabilityInput,
      tradingInputs,
      ruleInput,
      rosterStart,
      rosterDays,
    ],
  );

  // ---- live rule re-check (M6 §3.2) ----
  const eligibilityShifts = useMemo<EligibilityShift[]>(
    () =>
      shifts.map((s) => ({
        id: s.id,
        assignedUserId: s.assigned_user_id,
        date: s.date,
        startUtc: s.start_at,
        endUtc: s.end_at,
        breakMinutes: s.break_minutes,
      })),
    [shifts],
  );

  const eligibilityContext = useMemo<EligibilityContext>(
    () => ({
      timezone,
      rosterStart,
      rule: ruleInput,
      availability: availabilityInput,
      tradingHours: tradingInputs,
      shifts: eligibilityShifts,
      roleNames,
    }),
    [
      timezone,
      rosterStart,
      ruleInput,
      availabilityInput,
      tradingInputs,
      eligibilityShifts,
      roleNames,
    ],
  );

  /** Recomputed whenever the roster changes — so the panel is never stale. */
  const issuesByShift = useMemo(() => {
    const m = new Map<string, EligibilityIssue[]>();
    for (const s of shifts) {
      const member = memberInputs.find((x) => x.id === s.assigned_user_id);
      if (!member) continue;
      const result = checkEligibility(
        member,
        {
          date: s.date,
          startUtc: s.start_at,
          endUtc: s.end_at,
          roleId: s.role_id,
          breakMinutes: s.break_minutes,
          shiftId: s.id,
        },
        eligibilityContext,
      );
      if (result.issues.length) m.set(s.id, result.issues);
    }
    return m;
  }, [shifts, memberInputs, eligibilityContext]);

  const coverageGaps = useMemo(
    () =>
      seniorCoverageGaps({
        dates,
        locationIds: Array.from(new Set(positions.map((p) => p.location_id))),
        shifts: eligibilityShifts,
        members: memberInputs,
        rule: ruleInput,
        tradingHours: tradingInputs,
        timezone,
      }),
    [dates, positions, eligibilityShifts, memberInputs, ruleInput, tradingInputs, timezone],
  );

  // ---- totals ----
  const filledPositionIds = useMemo(
    () => new Set(shifts.flatMap((s) => (s.roster_position_id ? [s.roster_position_id] : []))),
    [shifts],
  );

  const totals = useMemo(() => {
    let hours = 0;
    let cost = 0;
    for (const s of shifts) {
      const h = elapsedHours(s.start_at, s.end_at, s.break_minutes);
      hours += h;
      cost += shiftCost(h, Number(s.pay_rate_snapshot ?? 0));
    }
    return {
      hours,
      cost,
      total: positions.length,
      filled: filledPositionIds.size,
      unfilled: positions.length - filledPositionIds.size,
      staff: new Set(shifts.flatMap((s) => (s.assigned_user_id ? [s.assigned_user_id] : []))).size,
    };
  }, [shifts, positions, filledPositionIds]);

  const seededHours = useMemo(() => totalPositionHours(activePositions), [activePositions]);

  const unfilledDetail = useMemo(() => {
    const m = new Map<string, { reason: string; detail: string }>();
    for (const u of response?.unfilled ?? []) {
      m.set(u.position_id, { reason: u.reason, detail: u.detail });
    }
    return m;
  }, [response]);

  const unfilledEntries = useMemo<UnfilledEntry[]>(
    () =>
      positions
        .filter((p) => !filledPositionIds.has(p.id))
        .map((p) => ({
          positionId: p.id,
          date: p.date,
          roleName: roleName(p.role_id),
          from: wallTimeIn(p.start_at, timezone),
          to: wallTimeIn(p.end_at, timezone),
          detail: unfilledDetail.get(p.id)?.detail ?? null,
        })),
    [positions, filledPositionIds, roleName, timezone, unfilledDetail],
  );

  const shiftWarnings = useMemo<ShiftWarningEntry[]>(() => {
    const out: ShiftWarningEntry[] = [];
    for (const s of shifts) {
      for (const issue of issuesByShift.get(s.id) ?? []) {
        out.push({ shiftId: s.id, personName: personName(s.assigned_user_id), date: s.date, issue });
      }
    }
    return out;
  }, [shifts, issuesByShift, personName]);

  const generated = shifts.length > 0 || response !== null;

  // ---- editing plumbing ----
  const editCtx: EditContext | null =
    roster && session.businessId
      ? { businessId: session.businessId, rosterId: roster.id, actorId: session.appUserId }
      : null;

  const clearSolverMessage = () => {
    setSolverMessage(null);
    setSolverRetryable(false);
  };

  /**
   * Run one edit with a visible optimistic update and a visible roll-back.
   * On failure the snapshot is restored FIRST (so the phantom disappears
   * immediately) and then the server is re-read, which is also what handles a
   * second manager having changed the roster underneath (M6 §6).
   */
  const mutate = async (
    optimistic: (() => void) | null,
    work: (ctx: EditContext) => Promise<void>,
    failMessage: string,
  ) => {
    if (!editCtx) return;
    const snapshot = { positions, shifts, roster, warningRows };
    setError(null);
    setBusy(true);
    optimistic?.();
    try {
      await work(editCtx);
      await refreshRoster(editCtx.rosterId);
    } catch (e) {
      setPositions(snapshot.positions);
      setShifts(snapshot.shifts);
      setRoster(snapshot.roster);
      setWarningRows(snapshot.warningRows);
      setError(`${failMessage} Nothing was saved.${e instanceof Error ? ` (${e.message})` : ""}`);
      await refreshRoster(editCtx.rosterId).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  // ---- create / discard ----
  const onCreate = async () => {
    if (!session.businessId) return;
    setError(null);
    clearSolverMessage();
    setCreating(true);
    try {
      const created = await createRoster({
        businessId: session.businessId,
        startDate,
        days,
        templateId,
        createdBy: session.appUserId,
      });
      await seedPositionsFromTemplate(created.id, {
        businessId: session.businessId,
        rosterStart: startDate,
        days,
        timezone,
        slots: slotInputs,
        tradingHours: tradingInputs,
      });
      // Narrow the availability exceptions to this roster's own dates, so the
      // pre-flight and the solve request see exactly the right leave/one-offs.
      setExceptions(await fetchBusinessExceptions(startDate, addDaysISO(startDate, days)));
      setRoster(created);
      setResponse(null);
      await refreshRoster(created.id);
    } catch (e) {
      setError(
        e instanceof Error
          ? `Couldn't create that roster. ${e.message}`
          : "Couldn't create that roster. Nothing was saved — try again.",
      );
    } finally {
      setCreating(false);
    }
  };

  const onDiscard = async () => {
    if (!roster) return;
    setError(null);
    clearSolverMessage();
    setBusy(true);
    try {
      await deleteRoster(roster.id);
      setRoster(null);
      setPositions([]);
      setShifts([]);
      setWarningRows([]);
      setChangeLog([]);
      setResponse(null);
      setConfirmDiscard(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't discard that draft. Try again.");
    } finally {
      setBusy(false);
    }
  };

  // ---- generate / regenerate (M5 §7) ----
  const lockedPairs = useMemo<SolvePair[]>(
    () =>
      shifts.flatMap((s) =>
        s.locked && s.roster_position_id && s.assigned_user_id
          ? [{ position_id: s.roster_position_id, user_id: s.assigned_user_id }]
          : [],
      ),
    [shifts],
  );
  const manualUnlockedCount = useMemo(
    () => shifts.filter((s) => s.origin === "manual" && !s.locked).length,
    [shifts],
  );

  const runGenerate = async () => {
    if (!roster || !session.businessId) return;
    setError(null);
    clearSolverMessage();
    setRegenerateOpen(false);
    setGenerating(true);

    const preset = PRIORITY_PRESETS.find((p) => p.id === presetId);
    const request = buildSolveRequest({
      rosterStart: roster.start_date,
      days: roster.days,
      timezone,
      // Built from the SEEDED positions, so `position_id` is a real row id and
      // the answers can be written straight back.
      positions: seededPositions,
      tradingHours: tradingInputs,
      members: memberInputs,
      availability: availabilityInput,
      rule: ruleInput,
      locked: lockedPairs,
      excluded: exclusions,
      objectivePriority: preset?.order,
    });

    try {
      const result = await requestSolve(request);
      await applyAssignments(
        roster.id,
        result.assignments.map((a) => ({ positionId: a.position_id, userId: a.user_id })),
      );
      // Best-effort audit trail: a failed write here must not discard the roster
      // the manager can now see (M5 §8 is about replay, not correctness).
      await recordSolveRun({
        businessId: session.businessId,
        rosterId: roster.id,
        request,
        response: result,
        seed: request.seed,
        timeLimit: request.time_limit_seconds,
        solveSeconds: result.stats.solve_seconds,
        status: result.status,
        createdBy: session.appUserId,
      }).catch(() => {});
      setResponse(result);
      await refreshRoster(roster.id);
    } catch (e) {
      if (e instanceof SolverUnavailableError) {
        // The seeded roster is untouched — degradation, not failure (M5 §10).
        setSolverMessage(e.message);
        setSolverRetryable(isRetryable(e));
        await recordSolveRun({
          businessId: session.businessId,
          rosterId: roster.id,
          request,
          response: { error: e.kind },
          seed: request.seed,
          timeLimit: request.time_limit_seconds,
          solveSeconds: null,
          status: "failed",
          createdBy: session.appUserId,
        }).catch(() => {});
      } else {
        setError(
          e instanceof Error
            ? `Couldn't save the generated roster. Your roster is unchanged. (${e.message})`
            : "Couldn't save the generated roster. Your roster is unchanged — try again.",
        );
      }
    } finally {
      setGenerating(false);
    }
  };

  const onLockManualEdits = () =>
    void mutate(
      null,
      async (ctx) => {
        for (const s of shifts.filter((x) => x.origin === "manual" && !x.locked)) {
          await toggleLock(ctx, s, true);
        }
      },
      "Couldn't pin your edits.",
    );

  // ---- manual editing (M6 §3.1) ----
  const candidatesFor = (target: EditorTarget): PickerCandidate[] => {
    const source = target.shift ?? target.position;
    return memberInputs
      .filter((m) => m.active || m.id === target.shift?.assigned_user_id)
      .map((member) => ({
        member,
        result: checkEligibility(
          member,
          {
            date: target.position.date,
            startUtc: source.start_at,
            endUtc: source.end_at,
            roleId: source.role_id,
            breakMinutes: target.shift?.break_minutes ?? 0,
            shiftId: target.shift?.id ?? null,
          },
          eligibilityContext,
        ),
      }))
      .sort((a, b) => {
        const rank = (c: PickerCandidate) => (c.result.blocked ? 2 : c.result.eligible ? 0 : 1);
        return rank(a) - rank(b) || a.member.name.localeCompare(b.member.name);
      });
  };

  const onChoosePerson = (userId: string, warnings: EligibilityIssue[]) => {
    const target = editor;
    if (!target) return;
    setEditor(null);
    void mutate(
      null,
      async (ctx) => {
        const saved = target.shift
          ? await reassignShift(ctx, { shift: target.shift, userId })
          : await assignShift(ctx, { position: target.position, userId });
        // The manager saved through these warnings, so they become visible flags
        // on the roster rather than a toast that fades (M6 §3.2).
        await syncShiftWarnings(ctx, saved.id, warnings);
      },
      target.shift ? "Couldn't move that shift." : "Couldn't assign that shift.",
    );
  };

  const onGrantRole = (userId: string, roleId: string) => {
    const member = team.find((m) => m.id === userId);
    if (!member || member.roleIds.includes(roleId)) return;
    setBusy(true);
    setError(null);
    void updateMember(userId, { roleIds: [...member.roleIds, roleId] })
      .catch((e: unknown) =>
        setError(
          e instanceof Error
            ? `Couldn't add that role. ${e.message}`
            : "Couldn't add that role. Try again.",
        ),
      )
      .finally(() => setBusy(false));
  };

  const onRemovePerson = () => {
    const shift = editor?.shift;
    if (!shift) return;
    setEditor(null);
    void mutate(
      () => setShifts((prev) => prev.filter((s) => s.id !== shift.id)), // optimistic
      (ctx) => removeAssignment(ctx, shift),
      "Couldn't take that person off.",
    );
  };

  const onDeletePosition = () => {
    const position = editor?.position;
    if (!position) return;
    setEditor(null);
    void mutate(
      () => {
        setPositions((prev) => prev.filter((p) => p.id !== position.id));
        setShifts((prev) => prev.filter((s) => s.roster_position_id !== position.id));
      },
      (ctx) => deletePosition(ctx, position),
      "Couldn't delete that position.",
    );
  };

  const onEditTimes = (patch: ShiftPatch) => {
    const shift = editor?.shift;
    if (!shift) return;
    setEditor(null);
    void mutate(
      null,
      async (ctx) => {
        const saved = await editShiftTimes(ctx, shift, patch);
        const member = memberInputs.find((m) => m.id === saved.assigned_user_id);
        if (!member) return;
        const result = checkEligibility(
          member,
          {
            date: saved.date,
            startUtc: saved.start_at,
            endUtc: saved.end_at,
            roleId: saved.role_id,
            breakMinutes: saved.break_minutes,
            shiftId: saved.id,
          },
          eligibilityContext,
        );
        await syncShiftWarnings(ctx, saved.id, result.warnings);
      },
      "Couldn't save those changes.",
    );
  };

  const onToggleLock = (locked: boolean) => {
    const shift = editor?.shift;
    if (!shift) return;
    setEditor(null);
    void mutate(null, (ctx) => toggleLock(ctx, shift, locked).then(() => undefined), "Couldn't pin that shift.");
  };

  const onExclude = (userId: string) => {
    const target = editor;
    const shift = target?.shift;
    if (!target || !shift) return;
    setEditor(null);
    setExclusions((prev) =>
      prev.some((x) => x.position_id === target.position.id && x.user_id === userId)
        ? prev
        : [...prev, { position_id: target.position.id, user_id: userId }],
    );
    void mutate(
      () => setShifts((prev) => prev.filter((s) => s.id !== shift.id)),
      (ctx) => removeAssignment(ctx, shift),
      "Couldn't take that person off.",
    );
  };

  const onAddPosition = (draft: NewPositionDraft) => {
    setAddingPosition(false);
    const startMin = minutesOfDay(draft.start);
    const rawEnd = minutesOfDay(draft.end);
    const endMin = rawEnd <= startMin ? rawEnd + 1440 : rawEnd;
    void mutate(
      null,
      (ctx) =>
        addPosition(ctx, {
          locationId: draft.locationId,
          date: draft.date,
          roleId: draft.roleId,
          startAt: zonedInstant(draft.date, startMin, timezone).toISOString(),
          endAt: zonedInstant(draft.date, endMin, timezone).toISOString(),
          requiredLevel: draft.requiredLevel,
          label: draft.label,
        }).then(() => undefined),
      "Couldn't add that position.",
    );
  };

  // ---- publish (M6 §4) ----
  const onPublish = () => {
    if (!roster) return;
    setPublishOpen(false);
    void mutate(
      null,
      (ctx) => publishRoster(ctx, roster).then(() => undefined),
      "Couldn't publish this roster.",
    );
  };

  const onUnpublish = () => {
    if (!roster) return;
    setConfirmUnpublish(false);
    void mutate(
      null,
      (ctx) => unpublishRoster(ctx, roster).then(() => undefined),
      "Couldn't withdraw this roster.",
    );
  };

  const onResolveWarning = (id: string) =>
    void mutate(
      () => setWarningRows((prev) => prev.filter((w) => w.id !== id)),
      async () => {
        await acknowledgeWarning(id, session.appUserId);
        await resolveWarning(id);
      },
      "Couldn't clear that exception.",
    );

  const focusCell = (cellId: string) => {
    setFocusedCell(cellId);
    document.getElementById(`cell-${cellId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };

  // ---- render ----
  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8">
        <Card className="p-8 text-center text-sm text-ink-faint">Loading rosters…</Card>
      </div>
    );
  }

  const periodLabel = business?.rosterPeriod === "fortnight" ? "Fortnight" : "Week";
  const rangeLabel = roster
    ? formatRange(roster.start_date, addDaysISO(roster.start_date, roster.days - 1))
    : "";

  return (
    <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Roster</h1>
            {roster && (
              <Badge tone={published ? "herb" : "saffron"}>
                {published ? "Published" : "Draft"}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            {roster
              ? `${periodLabel} of ${rangeLabel} — ${
                  published
                    ? "staff can see their own shifts."
                    : "only you can see this until you publish it."
                }`
              : "Create a roster period, then let the scheduler fill it from your week template."}
          </p>
        </div>

        {roster && (
          <div className="flex flex-wrap items-center gap-2">
            {!published && (
              <Button
                variant="ghost"
                className="min-h-11"
                onClick={() => setConfirmDiscard((v) => !v)}
                disabled={busy || generating}
              >
                <IconTrash width={15} height={15} /> Discard draft
              </Button>
            )}
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => (generated ? setRegenerateOpen(true) : void runGenerate())}
              disabled={generating || busy || !preflight.canGenerate}
            >
              <IconSparkle width={16} height={16} />
              {generating ? "Generating…" : generated ? "Generate again" : "Generate roster"}
            </Button>
            {published ? (
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => setConfirmUnpublish((v) => !v)}
                disabled={busy}
              >
                Withdraw
              </Button>
            ) : (
              <Button
                className="min-h-11"
                onClick={() => setPublishOpen(true)}
                disabled={busy || generating || totals.total === 0}
              >
                Publish
              </Button>
            )}
          </div>
        )}
      </header>

      {/* Draft vs published must never be ambiguous (M6 §4.2). */}
      {roster && (
        <div
          className={`rise mt-4 rounded-xl border px-4 py-2.5 text-[13px] ${
            published
              ? "border-herb/40 bg-herb-soft/60 text-herb"
              : "border-line-strong bg-surface-2 text-ink-soft"
          }`}
        >
          {published ? (
            <>
              <span className="font-semibold">Published.</span> Staff can see their own shifts for{" "}
              {rangeLabel}. Every change from here is recorded, and will notify the person affected
              once notifications go live.
            </>
          ) : (
            <>
              <span className="font-semibold">Draft.</span> Nobody but you can see this roster yet.
            </>
          )}
        </div>
      )}

      {error && (
        <div className="rise mt-4 flex items-center justify-between gap-3 rounded-xl border border-clay/30 bg-clay/5 px-4 py-3 text-[13px] text-clay">
          <span>{error}</span>
          <button
            onClick={() => void load()}
            className="min-h-11 shrink-0 px-2 font-semibold underline"
          >
            Refresh
          </button>
        </div>
      )}

      {solverMessage && (
        <div className="rise mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-saffron/40 bg-saffron-soft/50 px-4 py-3 text-[13px] text-[#8a6212]">
          <span>{solverMessage}</span>
          <div className="flex items-center gap-2">
            {solverRetryable && (
              <Button
                size="sm"
                variant="outline"
                className="min-h-11"
                onClick={() => void runGenerate()}
                disabled={generating}
              >
                Try again
              </Button>
            )}
            <button onClick={clearSolverMessage} className="min-h-11 px-2 font-semibold underline">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {confirmDiscard && roster && (
        <ConfirmBar
          text="Discard this draft and everything in it? Your week template isn't affected."
          cancelLabel="Keep it"
          confirmLabel={busy ? "Discarding…" : "Discard"}
          busy={busy}
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={() => void onDiscard()}
        />
      )}

      {confirmUnpublish && roster && (
        <ConfirmBar
          text="Withdraw this roster? Staff will lose sight of their shifts until you publish again."
          cancelLabel="Leave it published"
          confirmLabel={busy ? "Withdrawing…" : "Withdraw"}
          busy={busy}
          onCancel={() => setConfirmUnpublish(false)}
          onConfirm={onUnpublish}
        />
      )}

      {!roster ? (
        <CreateRosterPanel
          startDate={startDate}
          onStartDateChange={setStartDateOverride}
          periodLabel={periodLabel}
          days={days}
          positionCount={previewPositions.length}
          hours={seededHours}
          creating={creating}
          canCreate={preflight.canGenerate && previewPositions.length > 0}
          onCreate={() => void onCreate()}
        />
      ) : (
        <SeededSummary
          days={roster.days}
          positionCount={totals.total}
          hours={seededHours}
          filled={totals.filled}
          hasRun={generated}
        />
      )}

      <PreflightPanel result={preflight} />

      {roster && (
        <>
          <HealthPanel
            generated={generated}
            total={totals.total}
            filled={totals.filled}
            hours={totals.hours}
            cost={roundMoney(totals.cost)}
            staffCount={totals.staff}
            unfilled={unfilledEntries}
            coverageGaps={coverageGaps}
            shiftWarnings={shiftWarnings}
            timeLimitHit={response?.diagnostics.time_limit_hit ?? false}
            onFocus={focusCell}
          />

          <AcceptedExceptionsPanel
            warnings={warningRows}
            busy={busy}
            onFocus={focusCell}
            onResolve={onResolveWarning}
          />

          <RosterGrid
            dates={dates}
            timezone={timezone}
            positions={positions}
            shifts={shifts}
            team={team.map((m) => ({ id: m.id, name: m.name, active: m.active }))}
            roleName={roleName}
            issuesByShift={issuesByShift}
            unfilledDetail={unfilledDetail}
            focusedCell={focusedCell}
            busy={busy || generating}
            onOpenShift={(shift, position) => setEditor(position ? { position, shift } : null)}
            onOpenPosition={(position) => setEditor({ position, shift: null })}
            onAddPosition={() => setAddingPosition(true)}
          />

          <ChangeLogPanel entries={changeLog} timezone={timezone} personName={personName} />
        </>
      )}

      {editor && (
        <ShiftEditorModal
          // Remount per target so the time/role fields re-initialise.
          key={editor.shift?.id ?? editor.position.id}
          position={editor.position}
          shift={editor.shift}
          timezone={timezone}
          roles={roleOptions}
          candidates={candidatesFor(editor)}
          busy={busy}
          published={published}
          onClose={() => setEditor(null)}
          onChoose={onChoosePerson}
          onGrantRole={onGrantRole}
          onRemove={onRemovePerson}
          onDeletePosition={onDeletePosition}
          onEditTimes={onEditTimes}
          onToggleLock={onToggleLock}
          onExclude={onExclude}
        />
      )}

      {addingPosition && (
        <AddPositionModal
          dates={dates}
          roles={roleOptions}
          locations={locations.filter((l) => l.active).map((l) => ({ id: l.id, name: l.name }))}
          busy={busy}
          onClose={() => setAddingPosition(false)}
          onAdd={onAddPosition}
        />
      )}

      {regenerateOpen && (
        <RegenerateModal
          presetId={presetId}
          onPreset={setPresetId}
          manualUnlocked={manualUnlockedCount}
          lockedCount={lockedPairs.length}
          exclusions={exclusions}
          memberName={personName}
          busy={busy || generating}
          onClearExclusion={(positionId, userId) =>
            setExclusions((prev) =>
              prev.filter((x) => !(x.position_id === positionId && x.user_id === userId)),
            )
          }
          onLockManualEdits={onLockManualEdits}
          onClose={() => setRegenerateOpen(false)}
          onRegenerate={() => void runGenerate()}
        />
      )}

      {publishOpen && roster && (
        <PublishModal
          periodLabel={`${periodLabel.toLowerCase()} ${rangeLabel}`}
          filled={totals.filled}
          total={totals.total}
          unfilled={totals.unfilled}
          coverageGaps={coverageGaps.length}
          staffCount={totals.staff}
          cost={roundMoney(totals.cost)}
          hours={totals.hours}
          busy={busy}
          onClose={() => setPublishOpen(false)}
          onPublish={onPublish}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ConfirmBar({
  text,
  cancelLabel,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  text: string;
  cancelLabel: string;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="rise mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-clay/30 bg-clay/5 px-4 py-3 text-[13px] text-clay">
      <span>{text}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" className="min-h-11" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button size="sm" variant="danger" className="min-h-11" onClick={onConfirm} disabled={busy}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
