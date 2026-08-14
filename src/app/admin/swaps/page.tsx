"use client";

// Module 8 — the manager's cover queue (drop → claim → approve).
//
// THE MANAGER IS THE GATE (M8 §1). A drop reaches this screen and nowhere else;
// nothing is broadcast to the team until the manager presses "Open to team".
// The four choices in M8 §3.2 — decline, reassign directly, open to team, leave
// for now — are all on the card, because a manager mid-service should not have
// to go looking for the one he wants.
//
// The invariant that matters most (CLAUDE.md rule 4): a shift is never owned by
// two people, and never quietly owned by nobody. Every state on this screen has
// a named owner — while a request is open the DROPPER is still the assignee, and
// the card says so.
//
// Approval is THE critical section and is NOT implemented here: it is the
// `approve_claim` RPC (supabase/migrations/0007_swaps.sql), one transaction that
// re-checks the shift under a row lock. Two managers approving at once produce
// exactly one winner; the loser sees "Sorry, this shift has already been filled."
// and the queue re-reads itself. This screen's job before that call is M8 §4 and
// §5: show the manager who the claimants are, what rules approving them would
// break, and — using the SAME shared eligibility logic as the roster screen —
// warn (never block) when it would leave no senior on.
//
// NOTIFICATIONS (M9). This screen ENQUEUES; it never sends. Three of the four
// decisions below tell somebody something, and each one is a catalogued event:
//   "Open to team"  → E8 to ELIGIBLE STAFF ONLY (M8 §4) — never the whole team;
//   "Approve"       → E10 to the chosen claimant (time-critical, breaks quiet
//                     hours), E11 to the claimants who missed out, and E12 to
//                     the dropper so the loop is closed with certainty.
// Every one is a `void notify(...)` placed AFTER the server has confirmed the
// action. notify() cannot throw, so a Twilio outage or an RLS refusal can never
// undo an approval the manager has already been shown (CLAUDE.md rule 7).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Modal } from "@/components/ui";
import { IconCalendar, IconPin } from "@/components/icons";
import { useStore } from "@/lib/store";
import {
  fetchBusinessExceptions,
  fetchBusinessPatterns,
  fetchTradingHours,
  type ExceptionRow,
  type PatternRow,
  type TradingHoursRow,
} from "@/lib/supabase/availability";
import { fetchSchedulingRule, type SchedulingRuleRow } from "@/lib/supabase/template";
import {
  approveClaim,
  reassignDirectly,
  cancelOpenShift,
  declineDrop,
  fetchClaimsForShifts,
  fetchDropRequests,
  fetchShiftsInWindow,
  openShiftToTeam,
  type ShiftClaimRow,
  type ShiftRow,
} from "@/lib/supabase/swaps";
import {
  checkEligibility,
  seniorCoverageGaps,
  type EligibilityContext,
  type EligibilityIssue,
  type EligibilityShift,
} from "@/lib/domain/eligibility";
import type {
  AvailabilityInput,
  MemberInput,
  SolverRuleInput,
  TradingHoursInput,
} from "@/lib/domain/solver-request";
import {
  isUncoveredSoon,
  managerStatusLabel,
  type SwapStatus,
} from "@/lib/domain/swaps";
import { notify } from "@/lib/notify";
import { shiftWhen } from "@/lib/notify/labels";
import { recipientsFor } from "@/lib/notify/recipients";
import { startOfWeekISO } from "@/lib/domain/my-roster";
import { addDaysISO, elapsedHours, wallDateIn, wallTimeIn } from "@/lib/domain/timezone";
import { LEVEL_LABEL, type Level } from "@/lib/types";
import { formatDayLabel, formatHours } from "@/lib/utils";
import { PersonPicker, type PickerCandidate } from "../schedule/modals";

const DEFAULT_TIMEZONE = "Australia/Sydney";
const hhmm = (t: string | null): string => (t ? t.slice(0, 5) : "");

const errorText = (e: unknown, fallback: string): string =>
  e instanceof Error && e.message ? e.message : fallback;

// ---------------------------------------------------------------------------
// Row → domain adapters (the same shapes the roster screen builds, so the two
// screens can never reach different answers about the same person)
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

/** What the approval panel needs to say about one claimant (M8 §3.4). */
interface Claimant {
  claim: ShiftClaimRow;
  member: MemberInput | null;
  /** Hours already rostered in the fortnight this shift falls in. */
  fortnightHours: number;
  /** Policy breaches approving would create — shown, never used to block (§4). */
  warnings: EligibilityIssue[];
  /** Physically impossible (overlap, role, location). The DB refuses these too. */
  blocks: EligibilityIssue[];
  /** "Approving Bilal leaves no Senior on 16:00–23:00 Friday", or null (§4). */
  coverageWarning: string | null;
}

interface PendingApproval {
  shift: ShiftRow;
  claimant: Claimant;
}

// ---------------------------------------------------------------------------

export default function SwapsPage() {
  const { business, roles, locations, team, session } = useStore();
  const timezone = business?.timezone ?? DEFAULT_TIMEZONE;
  const weekStartDay = business?.weekStartDay ?? 1;

  const [requests, setRequests] = useState<ShiftRow[]>([]);
  const [claims, setClaims] = useState<ShiftClaimRow[]>([]);
  const [allShifts, setAllShifts] = useState<ShiftRow[]>([]);
  const [trading, setTrading] = useState<TradingHoursRow[]>([]);
  const [ruleRow, setRuleRow] = useState<SchedulingRuleRow | null>(null);
  const [patterns, setPatterns] = useState<PatternRow[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reassignTarget, setReassignTarget] = useState<ShiftRow | null>(null);
  const [confirming, setConfirming] = useState<PendingApproval | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Keeps "starts in 9 hours — still uncovered" honest on a screen left open.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const nowISO = new Date().toISOString();
      const queue = await fetchDropRequests(nowISO);

      // The window the rules are reasoned over: every request, plus a fortnight
      // either side so weekly hours, rest and consecutive days are complete.
      const dates = queue.map((s) => s.date).sort();
      const today = wallDateIn(nowISO, timezone);
      const from = addDaysISO(dates[0] ?? today, -14);
      const to = addDaysISO(dates[dates.length - 1] ?? today, 14);

      const [claimRows, shiftRows, tradingRows, rule, patternRows, exceptionRows] =
        await Promise.all([
          fetchClaimsForShifts(queue.map((s) => s.id)),
          fetchShiftsInWindow(from, to),
          fetchTradingHours(),
          fetchSchedulingRule(),
          fetchBusinessPatterns(),
          fetchBusinessExceptions(from, to),
        ]);

      setRequests(queue);
      setClaims(claimRows);
      setAllShifts(shiftRows);
      setTrading(tradingRows);
      setRuleRow(rule);
      setPatterns(patternRows);
      setExceptions(exceptionRows);
    } catch (e) {
      setError(errorText(e, "Couldn't load cover requests. Try again."));
    } finally {
      setLoading(false);
    }
  }, [timezone]);

  useEffect(() => {
    // setState only ever runs after an await — no render loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // ---- derived reference data ----
  const ruleInput = useMemo(() => toRuleInput(ruleRow), [ruleRow]);
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
  const roleNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of roles) m[r.id] = r.name;
    return m;
  }, [roles]);
  const locationNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const l of locations) m[l.id] = l.name;
    return m;
  }, [locations]);
  const roleOptions = useMemo(
    () => roles.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name })),
    [roles],
  );
  const personName = useCallback(
    (id: string | null) => (id ? (team.find((m) => m.id === id)?.name ?? "Someone") : "Someone"),
    [team],
  );

  const eligibilityShifts = useMemo<EligibilityShift[]>(
    () =>
      allShifts.map((s) => ({
        id: s.id,
        assignedUserId: s.assigned_user_id,
        date: s.date,
        startUtc: s.start_at,
        endUtc: s.end_at,
        breakMinutes: s.break_minutes,
      })),
    [allShifts],
  );

  /**
   * The eligibility context for a given shift. `rosterStart` is the week start
   * containing the shift, so the weekly hour ceilings are cut from the same
   * boundary the business uses everywhere else.
   */
  const contextFor = useCallback(
    (shift: ShiftRow): EligibilityContext => ({
      timezone,
      rosterStart: startOfWeekISO(shift.date, weekStartDay),
      rule: ruleInput,
      availability: availabilityInput,
      tradingHours: tradingInputs,
      shifts: eligibilityShifts,
      roleNames,
      locationNames,
    }),
    [
      timezone,
      weekStartDay,
      ruleInput,
      availabilityInput,
      tradingInputs,
      eligibilityShifts,
      roleNames,
      locationNames,
    ],
  );

  const fortnightHours = useCallback(
    (userId: string, date: string): number => {
      const start = startOfWeekISO(date, weekStartDay);
      const end = addDaysISO(start, 13);
      return allShifts
        .filter((s) => s.assigned_user_id === userId && s.date >= start && s.date <= end)
        .reduce((sum, s) => sum + elapsedHours(s.start_at, s.end_at, s.break_minutes), 0);
    },
    [allShifts, weekStartDay],
  );

  /**
   * Would approving this claimant leave a senior-coverage hole (M8 §4)?
   *
   * Computed by running the SHARED `seniorCoverageGaps` twice — as things stand,
   * and with the proposed assignment applied — and reporting only gaps the swap
   * would CREATE. A window that was already short is the manager's existing
   * problem, not a reason to shout at him for fixing a different one.
   */
  const coverageWarningFor = useCallback(
    (shift: ShiftRow, claimantId: string): string | null => {
      if (!ruleInput.seniorCoverageEnabled) return null;
      const base = {
        dates: [shift.date],
        locationIds: [shift.location_id],
        members: memberInputs,
        rule: ruleInput,
        tradingHours: tradingInputs,
        timezone,
      };
      const before = seniorCoverageGaps({ ...base, shifts: eligibilityShifts });
      const after = seniorCoverageGaps({
        ...base,
        shifts: eligibilityShifts.map((s) =>
          s.id === shift.id ? { ...s, assignedUserId: claimantId } : s,
        ),
      });
      const created = after.filter(
        (g) => !before.some((b) => b.date === g.date && b.from === g.from && b.to === g.to),
      );
      return created[0]?.detail ?? null;
    },
    [ruleInput, memberInputs, tradingInputs, timezone, eligibilityShifts],
  );

  const claimantsFor = useCallback(
    (shift: ShiftRow): Claimant[] =>
      claims
        .filter((c) => c.shift_id === shift.id && c.outcome === "pending")
        .map((claim) => {
          const member = memberInputs.find((m) => m.id === claim.claimant_user_id) ?? null;
          const result = member
            ? checkEligibility(
                member,
                {
                  date: shift.date,
                  startUtc: shift.start_at,
                  endUtc: shift.end_at,
                  roleId: shift.role_id,
                  locationId: shift.location_id,
                  breakMinutes: shift.break_minutes,
                  // The shift being covered is excluded from the maths: it is
                  // about to become theirs, not an extra shift on top.
                  shiftId: shift.id,
                },
                contextFor(shift),
              )
            : null;
          return {
            claim,
            member,
            fortnightHours: fortnightHours(claim.claimant_user_id, shift.date),
            warnings: result?.warnings ?? [],
            blocks: result?.blocks ?? [],
            coverageWarning: coverageWarningFor(shift, claim.claimant_user_id),
          };
        }),
    [claims, memberInputs, contextFor, fortnightHours, coverageWarningFor],
  );

  const candidatesFor = useCallback(
    (shift: ShiftRow): PickerCandidate[] =>
      memberInputs
        .filter((m) => m.active || m.id === shift.assigned_user_id)
        .map((member) => ({
          member,
          result: checkEligibility(
            member,
            {
              date: shift.date,
              startUtc: shift.start_at,
              endUtc: shift.end_at,
              roleId: shift.role_id,
              locationId: shift.location_id,
              breakMinutes: shift.break_minutes,
              shiftId: shift.id,
            },
            contextFor(shift),
          ),
        }))
        .sort((a, b) => {
          const rank = (c: PickerCandidate) => (c.result.blocked ? 2 : c.result.eligible ? 0 : 1);
          return rank(a) - rank(b) || a.member.name.localeCompare(b.member.name);
        }),
    [memberInputs, contextFor],
  );

  // ---- mutations ----
  /**
   * Run one decision, then re-read the queue from the server.
   *
   * There is deliberately NO optimistic update: every path here changes who is
   * responsible for a shift, and a phantom "covered" that later disappears is
   * exactly the failure Module 8 exists to prevent. The screen shows what the
   * server says, once the server has said it.
   */
  const run = async (work: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await load();
    } catch (e) {
      setError(errorText(e, fallback));
      // The message may be "already filled" — whatever it was, the screen is now
      // suspect, so re-read rather than leave a stale decision on offer.
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const onDecline = (shift: ShiftRow) =>
    void run(async () => {
      // Capture the dropper BEFORE the RPC clears drop_requested_by.
      const dropperId = shift.drop_requested_by ?? shift.assigned_user_id;
      await declineDrop(shift.id);

      // M9 E7 — tell the dropper. In-app only by catalogue: disappointing, but
      // it isn't urgent, and they are still rostered either way. Saying nothing
      // would leave them believing cover is still being arranged.
      if (dropperId) {
        void notify({
          event: "E7",
          businessId: shift.business_id,
          timezone,
          recipients: recipientsFor(team, [dropperId]),
          payload: { shiftId: shift.id, when: shiftWhen(shift.start_at, timezone) },
        });
      }
    }, "Couldn't decline that request. Nothing was changed.");

  const onOpenToTeam = (shift: ShiftRow) =>
    void run(async () => {
      await openShiftToTeam(shift.id);
      // M9 E8 — ELIGIBLE STAFF ONLY (M8 §4, M9 §9). The audience is the SAME
      // shared eligibility check the open-shifts screen uses, so nobody is
      // texted about a shift they would not even be shown; the dropper is
      // excluded because you cannot cover your own drop.
      const eligible = candidatesFor(shift).filter(
        (c) => !c.result.blocked && c.member.active && c.member.id !== shift.assigned_user_id,
      );
      if (!session.businessId) return;
      void notify({
        event: "E8",
        businessId: session.businessId,
        timezone,
        recipients: recipientsFor(team, eligible.map((c) => c.member.id)),
        payload: {
          shiftId: shift.id,
          when: shiftWhen(shift.start_at, timezone),
          startAt: shift.start_at,
          roleName: roleNames[shift.role_id] ?? "Shift",
        },
      });
    }, "Couldn't open that shift to the team. Nothing was changed.");

  const onCancelOpen = (shift: ShiftRow) =>
    void run(
      () => cancelOpenShift(shift.id).then(() => undefined),
      "Couldn't cancel that. Nothing was changed.",
    );

  const onReassign = (userId: string) => {
    const shift = reassignTarget;
    if (!shift || !session.businessId) return;
    setReassignTarget(null);
    // Via the RPC (migration 0012): assignment + claim rejection + rate
    // snapshot + audit in one transaction, so no volunteer is left waiting on
    // a shift that has already been given to someone else (M8 §1).
    void run(
      () => reassignDirectly(shift.id, userId).then(() => undefined),
      "Couldn't reassign that shift. Nothing was changed.",
    );
  };

  const onApprove = (approval: PendingApproval) => {
    setConfirming(null);
    const { shift, claimant } = approval;
    // Captured BEFORE the approval: `approve_claim` rejects every other claim in
    // the same transaction, so afterwards there is nobody left to tell.
    const winnerId = claimant.claim.claimant_user_id;
    const losers = claimantsFor(shift)
      .map((c) => c.claim.claimant_user_id)
      .filter((id) => id !== winnerId);
    // While a request is in flight the DROPPER is still the assignee (M8 §7) —
    // that is who gets the "your shift is covered" certainty (E12).
    const dropperId = shift.assigned_user_id;

    void run(async () => {
      await approveClaim(shift.id, claimant.claim.id);
      if (!session.businessId) return;
      const when = shiftWhen(shift.start_at, timezone);
      const businessId = session.businessId;

      // E10 — "you're on". TIME-CRITICAL: this one breaks quiet hours, because
      // telling somebody at 7am about a 6am shift is worse than useless.
      void notify({
        event: "E10",
        businessId,
        timezone,
        recipients: recipientsFor(team, [winnerId]),
        payload: { shiftId: shift.id, when, startAt: shift.start_at },
      });

      // E11 — the people who missed out. In-app only; disappointing, not urgent.
      void notify({
        event: "E11",
        businessId,
        timezone,
        recipients: recipientsFor(team, losers),
        payload: { shiftId: shift.id, when },
      });

      // E12 — closes the loop for the dropper. They need certainty that they are
      // genuinely off it, which is the single most damaging thing to get wrong
      // (M8 §3.1). Skipped when the dropper is also the winner, which cannot
      // normally happen but must never produce a self-contradicting text.
      if (dropperId && dropperId !== winnerId) {
        void notify({
          event: "E12",
          businessId,
          timezone,
          recipients: recipientsFor(team, [dropperId]),
          payload: {
            shiftId: shift.id,
            rosterId: shift.roster_id,
            when,
            coveredByName: personName(winnerId),
          },
        });
      }
    }, "Couldn't approve that. Nothing was changed.");
  };

  /** Warnings gate the confirm step; a clean approval goes straight through. */
  const requestApproval = (shift: ShiftRow, claimant: Claimant) => {
    const needsConfirming =
      claimant.warnings.length > 0 || claimant.coverageWarning !== null;
    if (needsConfirming) setConfirming({ shift, claimant });
    else onApprove({ shift, claimant });
  };

  // ---- render ----
  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-7 sm:px-8">
        <Card className="p-8 text-center text-sm text-ink-faint" aria-busy="true">
          Loading cover requests…
        </Card>
      </div>
    );
  }

  const visible = requests.filter((s) => !dismissed.has(s.id));

  return (
    <div className="mx-auto max-w-4xl px-5 py-7 sm:px-8">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Cover</h1>
          <p className="mt-1 text-sm text-ink-soft">
            When someone can&rsquo;t make a shift, it comes here first. Nobody on your team is
            asked until you open it to them.
          </p>
        </div>
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => void load()}
          disabled={busy}
        >
          Refresh
        </Button>
      </header>

      {error && (
        <div
          role="alert"
          className="rise mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-clay/30 bg-clay/5 px-4 py-3 text-[13px] text-clay"
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="min-h-11 shrink-0 px-2 font-semibold underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        <Card className="mt-6 p-10 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-herb-soft text-herb">
            <IconCalendar width={26} height={26} />
          </span>
          <h2 className="mt-4 font-display text-lg font-semibold text-ink">
            {requests.length === 0 ? "No cover requests" : "Nothing left to look at"}
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
            {requests.length === 0
              ? "Everyone is on the shifts they were given. Requests to swap or drop a shift will appear here."
              : "You've set the rest aside for now. They're still flagged on the roster."}
          </p>
          {requests.length > 0 && (
            <Button
              variant="outline"
              className="mt-5 min-h-11"
              onClick={() => setDismissed(new Set())}
            >
              Show them again
            </Button>
          )}
        </Card>
      ) : (
        <div className="mt-6 space-y-4">
          {visible.map((shift) => (
            <RequestCard
              key={shift.id}
              shift={shift}
              now={now}
              timezone={timezone}
              roleName={roleNames[shift.role_id] ?? "Shift"}
              locationName={locationNames[shift.location_id] ?? ""}
              dropperName={personName(shift.drop_requested_by ?? shift.assigned_user_id)}
              claimants={claimantsFor(shift)}
              busy={busy}
              onDecline={() => onDecline(shift)}
              onOpenToTeam={() => onOpenToTeam(shift)}
              onCancelOpen={() => onCancelOpen(shift)}
              onReassign={() => setReassignTarget(shift)}
              onLeave={() => setDismissed((prev) => new Set(prev).add(shift.id))}
              onApprove={(claimant) => requestApproval(shift, claimant)}
            />
          ))}
        </div>
      )}

      {reassignTarget && (
        <Modal
          open
          onClose={() => setReassignTarget(null)}
          maxWidth={640}
          title="Reassign this shift"
          subtitle={`${roleNames[reassignTarget.role_id] ?? "Shift"} · ${formatDayLabel(
            reassignTarget.date,
          )} · ${wallTimeIn(reassignTarget.start_at, timezone)}–${wallTimeIn(
            reassignTarget.end_at,
            timezone,
          )} — nobody else is asked.`}
          footer={
            <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setReassignTarget(null)}>
              Close
            </Button>
          }
        >
          <PersonPicker
            candidates={candidatesFor(reassignTarget)}
            currentUserId={reassignTarget.assigned_user_id}
            roleName={roleNames[reassignTarget.role_id] ?? "this role"}
            busy={busy}
            onChoose={(userId) => onReassign(userId)}
            // Granting a role is the Team screen's job; from here the manager
            // picks someone who already holds it.
            onGrantRole={() => undefined}
          />
          <p className="mt-4 border-t border-line pt-3 text-[12px] leading-snug text-ink-faint">
            Reassigning here does not ask the team — the person you pick simply gets the shift, and
            the change is recorded in the roster change log.
          </p>
        </Modal>
      )}

      {confirming && (
        <ApproveConfirmModal
          approval={confirming}
          roleOptions={roleOptions}
          busy={busy}
          onClose={() => setConfirming(null)}
          onConfirm={() => onApprove(confirming)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One request in the queue
// ---------------------------------------------------------------------------

function RequestCard({
  shift,
  now,
  timezone,
  roleName,
  locationName,
  dropperName,
  claimants,
  busy,
  onDecline,
  onOpenToTeam,
  onCancelOpen,
  onReassign,
  onLeave,
  onApprove,
}: {
  shift: ShiftRow;
  now: Date;
  timezone: string;
  roleName: string;
  locationName: string;
  dropperName: string;
  claimants: Claimant[];
  busy: boolean;
  onDecline: () => void;
  onOpenToTeam: () => void;
  onCancelOpen: () => void;
  onReassign: () => void;
  onLeave: () => void;
  onApprove: (claimant: Claimant) => void;
}) {
  const status = shift.status as SwapStatus;
  const startDate = wallDateIn(shift.start_at, timezone);
  const endDate = wallDateIn(shift.end_at, timezone);
  const from = wallTimeIn(shift.start_at, timezone);
  const to = wallTimeIn(shift.end_at, timezone);
  const urgent = isUncoveredSoon(shift.start_at, now);
  const tone = status === "drop_requested" ? "saffron" : status === "open" ? "ember" : "herb";

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone}>{managerStatusLabel(status)}</Badge>
            {urgent && <Badge tone="clay">Starts soon</Badge>}
          </div>
          <p className="nums mt-2 font-display text-xl font-semibold leading-tight text-ink">
            {formatDayLabel(startDate)} · {from}–{to}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-soft">
            <span className="font-medium text-ink">{roleName}</span>
            {locationName && (
              <>
                <span className="text-ink-faint">·</span>
                <span className="inline-flex items-center gap-1">
                  <IconPin width={14} height={14} />
                  {locationName}
                </span>
              </>
            )}
            {endDate !== startDate && (
              <>
                <span className="text-ink-faint">·</span>
                <span>finishes {formatDayLabel(endDate)}</span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* ---- who asked, and who is still responsible ---- */}
      <div className="mt-3 rounded-xl border border-line bg-surface-2 px-3.5 py-3">
        <p className="text-[13px] text-ink">
          <span className="font-semibold">{dropperName}</span> asked for cover
          {shift.drop_requested_at
            ? ` on ${formatDayLabel(wallDateIn(shift.drop_requested_at, timezone))}`
            : ""}
          .
        </p>
        {shift.drop_reason && (
          <p className="mt-1 whitespace-pre-line text-[13px] leading-snug text-ink-soft">
            &ldquo;{shift.drop_reason}&rdquo;
          </p>
        )}
        <p className="mt-1.5 text-[12px] leading-snug text-ink-faint">
          Until you decide, this shift is still {dropperName}&rsquo;s.
        </p>
      </div>

      {/* ---- the four choices (M8 §3.2) ---- */}
      {status === "drop_requested" && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button className="min-h-11" disabled={busy} onClick={onOpenToTeam}>
            Open to team
          </Button>
          <Button variant="outline" className="min-h-11" disabled={busy} onClick={onReassign}>
            Reassign directly
          </Button>
          <Button variant="outline" className="min-h-11" disabled={busy} onClick={onDecline}>
            Decline
          </Button>
          <Button variant="ghost" className="min-h-11" disabled={busy} onClick={onLeave}>
            Leave for now
          </Button>
        </div>
      )}

      {/* ---- open / claimed ---- */}
      {(status === "open" || status === "claimed_pending") && (
        <div className="mt-4">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
            {claimants.length === 0
              ? "Offered to the team"
              : `${claimants.length} ${claimants.length === 1 ? "person has" : "people have"} offered to cover`}
          </p>

          {claimants.length === 0 ? (
            <p className="rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-[13px] leading-snug text-ink-soft">
              Nobody has offered yet. {dropperName} is still on this shift
              {urgent ? " and it starts soon — chase it up." : "."}
            </p>
          ) : (
            <ul className="space-y-2">
              {claimants.map((c) => (
                <li key={c.claim.id}>
                  <ClaimantRow claimant={c} busy={busy} onApprove={() => onApprove(c)} />
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" className="min-h-11" disabled={busy} onClick={onReassign}>
              Reassign directly
            </Button>
            <Button variant="outline" className="min-h-11" disabled={busy} onClick={onCancelOpen}>
              Cancel — {dropperName} keeps it
            </Button>
            <Button variant="ghost" className="min-h-11" disabled={busy} onClick={onLeave}>
              Leave for now
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// One claimant: name, role, level, fortnight hours, and every warning approving
// them would create (M8 §3.4). Blocks are physically impossible and the database
// refuses them too, so the button is disabled rather than merely discouraged.
// ---------------------------------------------------------------------------

function ClaimantRow({
  claimant,
  busy,
  onApprove,
}: {
  claimant: Claimant;
  busy: boolean;
  onApprove: () => void;
}) {
  const { member, warnings, blocks, coverageWarning, fortnightHours: hours } = claimant;
  const name = member?.name ?? "Someone";

  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-3 rounded-xl border px-3.5 py-3 ${
        blocks.length > 0 ? "border-line bg-surface-2 opacity-80" : "border-line-strong bg-surface"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-ink">{name}</p>
        <p className="nums mt-0.5 text-[12px] text-ink-soft">
          {member ? LEVEL_LABEL[member.level] : "—"} · {formatHours(hours)} this fortnight
        </p>

        {blocks.map((b, i) => (
          <p key={`b${i}`} className="mt-1 text-[12px] leading-snug text-clay">
            {b.message}
          </p>
        ))}
        {warnings.map((w, i) => (
          <p key={`w${i}`} className="mt-1 text-[12px] leading-snug text-[#8a6212]">
            {w.message}
          </p>
        ))}
        {coverageWarning && (
          <p className="mt-1 text-[12px] font-medium leading-snug text-[#8a6212]">
            {coverageWarning}
          </p>
        )}
      </div>

      <Button
        size="sm"
        variant={warnings.length > 0 || coverageWarning ? "outline" : "primary"}
        className="min-h-11 shrink-0"
        disabled={busy || blocks.length > 0 || !member}
        onClick={onApprove}
      >
        {blocks.length > 0 ? "Can't approve" : "Approve"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The explicit warning before confirming (M8 §4 — warn, don't block)
// ---------------------------------------------------------------------------

function ApproveConfirmModal({
  approval,
  roleOptions,
  busy,
  onClose,
  onConfirm,
}: {
  approval: PendingApproval;
  roleOptions: { id: string; name: string }[];
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { claimant } = approval;
  const name = claimant.member?.name ?? "this person";
  const roleName =
    roleOptions.find((r) => r.id === approval.shift.role_id)?.name ?? "this shift";

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth={520}
      title={`Put ${name} on ${roleName}?`}
      subtitle="You can go ahead — this is a heads-up, not a refusal."
      footer={
        <>
          <Button variant="ghost" size="sm" className="min-h-11" onClick={onClose}>
            Not yet
          </Button>
          <Button size="sm" className="min-h-11" disabled={busy} onClick={onConfirm}>
            {busy ? "Approving…" : "Approve anyway"}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        {claimant.coverageWarning && (
          <p className="rounded-lg border border-saffron/40 bg-saffron-soft/50 px-3 py-2 font-medium leading-snug text-[#8a6212]">
            {claimant.coverageWarning}
          </p>
        )}
        {claimant.warnings.map((w, i) => (
          <p
            key={i}
            className="rounded-lg border border-saffron/40 bg-saffron-soft/50 px-3 py-2 leading-snug text-[#8a6212]"
          >
            {w.message}
          </p>
        ))}
        <p className="text-ink-soft">
          Approving puts {name} on this shift and turns down anyone else who offered.
        </p>
      </div>
    </Modal>
  );
}
