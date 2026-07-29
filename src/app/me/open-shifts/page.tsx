"use client";

// M8 §3.3 — "Shifts available to cover".
//
// The manager is the gate (M8 §1): nothing reaches this screen automatically. A
// shift only appears here after a manager has explicitly opened it to the team,
// and only for people who could VALIDLY take it (§4).
//
// The eligibility line, exactly as M8 §4 draws it:
//   BLOCK  (role not held, wrong location, already rostered then, deactivated)
//          → the shift is not shown at all. Physical impossibility hides it.
//   POLICY (over hours, short rest, too many days running, one-shift-per-day)
//          → the shift IS shown. Those surface to the MANAGER at approval, who
//            may allow them knowingly. Hard-hiding on hour limits would leave
//            shifts uncovered when someone is willing and the manager is happy.
// The check is the SHARED `checkEligibility` — the same function the roster
// screen uses. The day this screen and the roster screen disagree about who is
// eligible is the day the product stops being trustworthy.
//
// One tap claims. The claim itself is the `claim_shift` RPC, which is
// transactional and idempotent — a double-tap makes one claim, not two, and a
// shift filled a moment ago answers "Sorry, this shift has already been filled."
// (M8 §5). Nothing on this screen reports success before that call resolves.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { IconCalendar, IconPin } from "@/components/icons";
import { useStore } from "@/lib/store";
import { fetchMyUpcomingShifts } from "@/lib/supabase/my-shifts";
import {
  claimShift,
  fetchClaimsForShifts,
  fetchOpenShiftsForMe,
  type ShiftRow,
} from "@/lib/supabase/swaps";
import {
  checkEligibility,
  type EligibilityContext,
  type EligibilityShift,
} from "@/lib/domain/eligibility";
import type { MemberInput, SolverRuleInput } from "@/lib/domain/solver-request";
import { calendarLabel, formatDuration } from "@/lib/domain/my-roster";
import { elapsedHours, wallDateIn, wallTimeIn } from "@/lib/domain/timezone";
import { STILL_ROSTERED_NOTICE } from "@/lib/domain/swaps";
import { MANAGERS, notify } from "@/lib/notify";
import { shiftWhen } from "@/lib/notify/labels";

type LoadStatus = "loading" | "ready" | "error";

const errorText = (e: unknown, fallback: string): string =>
  e instanceof Error && e.message ? e.message : fallback;

/**
 * The rule values only the WARN checks read.
 *
 * Staff cannot read `scheduling_rule` or `trading_hours` — both are manager-only
 * under migration 0002, and rightly so. That is not a gap here: this screen
 * consults ONLY `result.blocked`, and every BLOCK rule (active, role, location,
 * overlap) is decided from data the staff member can legitimately see — their
 * own record and their own shifts. The policy rules these placeholders would
 * feed are the manager's call at approval time (§4), computed there with the
 * real settings.
 */
const WARN_ONLY_PLACEHOLDER_RULE: SolverRuleInput = {
  maxHoursCasual: 38,
  maxHoursPartTime: 30,
  maxHoursFullTime: 38,
  seniorCoverageEnabled: false,
  seniorMinCount: 1,
  seniorQualifyingLevels: ["senior"],
  maxConsecutiveDays: 6,
  minRestHours: 10,
  maxShiftHours: 12,
  minShiftHours: 3,
  oneShiftPerDay: true,
};

export default function OpenShiftsPage() {
  const { me, business, roles, locations, session } = useStore();
  const userId = session.appUserId;
  const timezone = business?.timezone ?? "Australia/Sydney";

  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [myShifts, setMyShifts] = useState<EligibilityShift[]>([]);
  const [claimedShiftIds, setClaimedShiftIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<{ shiftId: string; message: string } | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setError(null);
    try {
      const nowISO = new Date().toISOString();
      const [open, mine] = await Promise.all([
        fetchOpenShiftsForMe(nowISO, userId),
        // My own roster, for the overlap block — nobody is in two places at once.
        fetchMyUpcomingShifts(nowISO, userId),
      ]);
      setShifts(open);
      setMyShifts(
        mine.map((s) => ({
          id: s.id,
          assignedUserId: userId,
          date: s.date,
          startUtc: s.startAt,
          endUtc: s.endAt,
          breakMinutes: s.breakMinutes,
        })),
      );
      // Which of these have I already offered to cover? Read from the server so
      // a reload (or a second phone) shows the same answer. RLS limits this to
      // the caller's own claims.
      const claims = await fetchClaimsForShifts(open.map((s) => s.id));
      setClaimedShiftIds(
        new Set(
          claims
            .filter((c) => c.claimant_user_id === userId && c.outcome === "pending")
            .map((c) => c.shift_id),
        ),
      );
      setStatus("ready");
    } catch (e) {
      setError(errorText(e, "Couldn't load available shifts. Check your signal."));
      setStatus("error");
    }
  }, [userId]);

  useEffect(() => {
    // setState only ever runs after an await — no render loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const roleName = useCallback(
    (id: string): string => roles.find((r) => r.id === id)?.name ?? "Shift",
    [roles],
  );
  const locationName = useCallback(
    (id: string): string => locations.find((l) => l.id === id)?.name ?? "",
    [locations],
  );

  const member = useMemo<MemberInput | null>(
    () =>
      me
        ? {
            id: me.id,
            name: me.name,
            active: me.active,
            level: me.level,
            employmentType: me.employmentType,
            roleIds: me.roleIds,
            homeLocationId: me.homeLocationId,
            canWorkOtherLocations: me.canWorkOtherLocations,
            payRate: me.payRate,
            maxHoursWeek: me.maxHoursWeek,
            minHoursWeek: me.minHoursWeek,
            maxShiftsWeek: me.maxShiftsWeek,
            preferredDays: me.preferredDays,
            preferredTimeOfDay: me.preferredTimeOfDay,
          }
        : null,
    [me],
  );

  const eligibilityContext = useMemo<EligibilityContext>(() => {
    const roleNames: Record<string, string> = {};
    for (const r of roles) roleNames[r.id] = r.name;
    const locationNames: Record<string, string> = {};
    for (const l of locations) locationNames[l.id] = l.name;
    return {
      timezone,
      // Only the weekly-hours WARN cuts weeks from this, and warnings are not
      // read here; the earliest date on screen keeps it deterministic anyway.
      rosterStart: shifts[0]?.date ?? wallDateIn(new Date().toISOString(), timezone),
      rule: WARN_ONLY_PLACEHOLDER_RULE,
      availability: { patterns: [], exceptions: [] },
      tradingHours: [],
      shifts: myShifts,
      roleNames,
      locationNames,
    };
  }, [timezone, shifts, myShifts, roles, locations]);

  /** Only shifts this person could VALIDLY take (M8 §4 — blocks hide, policy doesn't). */
  const offered = useMemo(() => {
    if (!member) return [];
    return shifts.filter(
      (s) =>
        !checkEligibility(
          member,
          {
            date: s.date,
            startUtc: s.start_at,
            endUtc: s.end_at,
            roleId: s.role_id,
            locationId: s.location_id,
            breakMinutes: s.break_minutes,
          },
          eligibilityContext,
        ).blocked,
    );
  }, [shifts, member, eligibilityContext]);

  const onClaim = async (shift: ShiftRow) => {
    setClaimingId(shift.id);
    setClaimError(null);
    try {
      await claimShift(shift.id);
      // True only now. The RPC is idempotent, so a retry after a flaky network
      // is safe and still ends with exactly one claim.
      setClaimedShiftIds((prev) => new Set(prev).add(shift.id));

      // M9 E9 — the manager, in-app only (M9 §2: not urgent enough for a text).
      // Several offers on one shift collapse under 'claims:shift_<id>' inside a
      // 10-minute window, so a popular shift is one message, not five (M9 §4).
      // `MANAGERS` is resolved server-side; staff cannot read the team list.
      if (session.businessId) {
        void notify({
          event: "E9",
          businessId: session.businessId,
          timezone,
          recipients: MANAGERS,
          payload: {
            shiftId: shift.id,
            when: shiftWhen(shift.start_at, timezone),
            claimantName: me?.name ?? "Someone",
            // The manager's screen counts the claims for real; this is the copy
            // for a single offer, which the batch window then collapses.
            claimCount: 1,
          },
        });
      }
    } catch (e) {
      const message = errorText(e, "Couldn't send that. Nothing was sent — try again.");
      setClaimError({ shiftId: shift.id, message });
      // "Already filled" means this list is stale — re-read rather than leaving
      // a shift on screen that no longer exists (M8 §5).
      await load().catch(() => {});
    } finally {
      setClaimingId(null);
    }
  };

  // ---- loading ----
  if (status === "loading") {
    return (
      <div className="space-y-3 px-4 py-6" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading shifts available to cover…</span>
        <div className="h-8 w-56 animate-pulse rounded-lg bg-surface-2" />
        <div className="h-24 animate-pulse rounded-card bg-surface-2" />
        <div className="h-24 animate-pulse rounded-card bg-surface-2" />
      </div>
    );
  }

  // ---- error ----
  if (status === "error") {
    return (
      <div className="px-4 py-6">
        <Card className="p-6 text-center">
          <h1 className="font-display text-lg font-semibold text-ink">
            Can&rsquo;t load available shifts
          </h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-soft">
            {error ?? "Something went wrong."}
          </p>
          <Button size="lg" className="mt-5 w-full" onClick={() => void load()}>
            Try again
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="px-4 py-5">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
        Shifts available to cover
      </h1>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
        Your manager opened these to the team. Offering to cover doesn&rsquo;t put you on the shift
        — your manager decides who gets it.
      </p>

      {/* ---- empty: honest about what we actually know ---- */}
      {offered.length === 0 ? (
        <Card className="mt-5 p-8 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-ember-soft text-ember-deep">
            <IconCalendar width={26} height={26} />
          </span>
          <h2 className="mt-4 font-display text-lg font-semibold text-ink">
            No shifts are listed right now
          </h2>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-soft">
            {shifts.length > 0
              ? "The shifts going at the moment need a job role, a location or a time you're not free for."
              : "When someone can't make a shift and your manager opens it to the team, it shows up here."}
          </p>
          <Button size="lg" variant="outline" className="mt-5 w-full" onClick={() => void load()}>
            Check again
          </Button>
        </Card>
      ) : (
        <ul className="mt-5 space-y-3">
          {offered.map((s) => (
            <li key={s.id}>
              <OpenShiftCard
                shift={s}
                timezone={timezone}
                roleName={roleName(s.role_id)}
                locationName={locationName(s.location_id)}
                claimed={claimedShiftIds.has(s.id)}
                busy={claimingId === s.id}
                error={claimError?.shiftId === s.id ? claimError.message : null}
                onClaim={() => void onClaim(s)}
              />
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 px-1 text-center text-[12px] leading-snug text-ink-faint">
        Dropped one of your own shifts? {STILL_ROSTERED_NOTICE}{" "}
        <Link href="/me" className="font-semibold underline">
          My shifts
        </Link>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One offered shift. The whole card is comfortably above 44px and the single
// action is the only tap target — M7 §1's one-handed, zero-learning-curve rule.
// ---------------------------------------------------------------------------

function OpenShiftCard({
  shift,
  timezone,
  roleName,
  locationName,
  claimed,
  busy,
  error,
  onClaim,
}: {
  shift: ShiftRow;
  timezone: string;
  roleName: string;
  locationName: string;
  claimed: boolean;
  busy: boolean;
  error: string | null;
  onClaim: () => void;
}) {
  const startDate = wallDateIn(shift.start_at, timezone);
  const endDate = wallDateIn(shift.end_at, timezone);
  const from = wallTimeIn(shift.start_at, timezone);
  const to = wallTimeIn(shift.end_at, timezone);
  const overnight = endDate !== startDate;
  const hours = elapsedHours(shift.start_at, shift.end_at, shift.break_minutes);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-ember">{calendarLabel(startDate)}</p>
          <p className="nums mt-0.5 font-display text-xl font-semibold leading-tight text-ink">
            {from} – {to}
          </p>
          {overnight && (
            <p className="mt-0.5 text-[12px] text-ink-soft">
              Finishes {calendarLabel(endDate)} — runs overnight.
            </p>
          )}
        </div>
        <Badge tone="neutral">{roleName}</Badge>
      </div>

      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-soft">
        {locationName && (
          <span className="inline-flex items-center gap-1">
            <IconPin width={14} height={14} />
            {locationName}
          </span>
        )}
        <span className="text-ink-faint">·</span>
        <span>{formatDuration(hours)} paid</span>
      </p>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-clay/30 bg-clay/5 px-3 py-2 text-[13px] leading-snug text-clay"
        >
          {error}
        </p>
      )}

      {claimed ? (
        <p className="mt-3 rounded-lg border border-herb/40 bg-herb-soft/60 px-3 py-2.5 text-[13px] font-medium leading-snug text-herb">
          Requested — waiting for manager.
        </p>
      ) : (
        <Button size="lg" className="mt-3 w-full" disabled={busy} onClick={onClaim}>
          {busy ? "Sending…" : "I can cover this"}
        </Button>
      )}
    </Card>
  );
}
