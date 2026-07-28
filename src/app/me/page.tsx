"use client";

// M7 §3.1 — "My shifts", the staff home screen.
//
// This screen exists to answer ONE question instantly: "when am I working next?"
// Everything else on it is secondary and sits below the fold. Design rules that
// drove the layout (M7 §1): phone-first and one-handed (tap targets ≥ 44px),
// limited English (short concrete labels, no jargon), bad connectivity (renders
// from cache first, then refreshes and says how old the data is), zero learning
// curve (no settings, no onboarding).
//
// Times render in the BUSINESS timezone, never the phone's (M7 §7).

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";
import { IconCalendar, IconChevronRight, IconClock, IconPin } from "@/components/icons";
import { useStore } from "@/lib/store";
import {
  fetchMyPastShifts,
  fetchMyUpcomingShifts,
  readCachedShifts,
  writeCachedShifts,
} from "@/lib/supabase/my-shifts";
import {
  calendarLabel,
  describeShiftDays,
  describeUpdatedAgo,
  formatDuration,
  groupUpcomingByWeek,
  nextShift,
  periodTotals,
  relativeDayLabel,
  shiftPaidHours,
  STAFF_PAY_DISCLAIMER,
  upcomingShifts,
  type MyShift,
} from "@/lib/domain/my-roster";
import { addDaysISO, wallDateIn } from "@/lib/domain/timezone";
import { formatMoney } from "@/lib/utils";

type LoadStatus = "loading" | "ready" | "error";

const errorText = (e: unknown, fallback: string): string =>
  e instanceof Error && e.message ? e.message : fallback;

export default function MyShiftsHome() {
  const { me, business, roles, locations, session } = useStore();
  const userId = session.appUserId;
  const timezone = business?.timezone ?? "Australia/Sydney";
  const weekStartDay = business?.weekStartDay ?? 1;

  const [shifts, setShifts] = useState<MyShift[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  /** Set when the network failed but cached shifts are on screen — never a blank page. */
  const [staleWarning, setStaleWarning] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [withdrawn, setWithdrawn] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // A slow tick keeps "Today", "Tomorrow" and "Updated 2 hours ago" honest on a
  // phone left open in a pocket all evening.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    const cached = readCachedShifts(userId);
    if (cached) {
      // Render the last-known roster immediately — with no signal this is the
      // whole product (M7 §5).
      setShifts(cached.shifts);
      setCachedAt(cached.cachedAt);
      setStatus("ready");
    }
    setRefreshing(true);
    try {
      const fresh = await fetchMyUpcomingShifts(new Date().toISOString(), userId);
      setShifts(fresh);
      setCachedAt(writeCachedShifts(userId, fresh));
      setStaleWarning(null);
      setError(null);
      setStatus("ready");
      // Roster withdrawn after they saw it (M6 §4.4, M7 §7): shifts we had are
      // now gone. Say so plainly rather than showing a bare empty screen.
      setWithdrawn(Boolean(cached && cached.shifts.length > 0 && fresh.length === 0));
    } catch (e) {
      const message = errorText(e, "Couldn't reach the roster. Check your signal.");
      if (cached) {
        setStaleWarning(message);
      } else {
        setError(message);
        setStatus("error");
      }
    } finally {
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    // Fetch-on-mount: every setState above runs after an await, never during
    // render, so this cannot loop (what the rule guards against).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const roleName = (id: string): string => roles.find((r) => r.id === id)?.name ?? "Shift";
  const locationName = (id: string): string => locations.find((l) => l.id === id)?.name ?? "";

  const today = wallDateIn(now.toISOString(), timezone);
  const upcoming = upcomingShifts(shifts, now);
  const hero = nextShift(shifts, now);
  const later = hero ? upcoming.filter((s) => s.id !== hero.id) : [];
  const weeks = groupUpcomingByWeek(later, weekStartDay);

  // The summary window: the business's roster period, counted from today. It is
  // computed from the shifts already loaded, so it still works offline.
  const periodDays = business?.rosterPeriod === "week" ? 7 : 14;
  const periodEnd = addDaysISO(today, periodDays - 1);
  const periodShifts = upcoming.filter((s) => s.date >= today && s.date <= periodEnd);
  const totals = periodTotals(periodShifts, me?.payRate ?? 0);
  const updatedAgo = cachedAt ? describeUpdatedAgo(cachedAt, now) : null;

  // ---- loading (nothing cached yet) ----
  if (status === "loading") {
    return (
      <div className="space-y-3 px-4 py-6" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading your shifts…</span>
        <div className="h-40 animate-pulse rounded-card bg-surface-2" />
        <div className="h-16 animate-pulse rounded-card bg-surface-2" />
        <div className="h-16 animate-pulse rounded-card bg-surface-2" />
      </div>
    );
  }

  // ---- hard error (no cached roster to fall back on) ----
  if (status === "error") {
    return (
      <div className="px-4 py-6">
        <Card className="p-6 text-center">
          <h1 className="font-display text-lg font-semibold text-ink">Can&rsquo;t load your shifts</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-soft">
            {error ?? "Something went wrong."}
          </p>
          <Button size="lg" className="mt-5 w-full" onClick={() => void load()} disabled={refreshing}>
            {refreshing ? "Trying…" : "Try again"}
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="px-4 py-5">
      {staleWarning && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-saffron/40 bg-saffron-soft px-3 py-2.5">
          <p className="flex-1 text-[13px] leading-snug text-[#8a6212]">
            Showing your last update. Couldn&rsquo;t reach the roster just now.
          </p>
          <button
            onClick={() => void load()}
            disabled={refreshing}
            className="min-h-11 shrink-0 rounded-lg px-3 text-[13px] font-semibold text-[#8a6212] underline disabled:opacity-50"
          >
            {refreshing ? "Trying…" : "Retry"}
          </button>
        </div>
      )}

      {withdrawn && (
        <div className="mb-4 rounded-xl border border-clay/30 bg-clay/5 px-3 py-3">
          <p className="text-[13px] leading-snug text-clay">
            Your manager has withdrawn this roster. A new one is coming.
          </p>
        </div>
      )}

      {/* ---- the hero: when am I working next? ---- */}
      {hero ? (
        <NextShiftHero
          shift={hero}
          timezone={timezone}
          today={today}
          roleName={roleName(hero.roleId)}
          locationName={locationName(hero.locationId)}
        />
      ) : (
        <Card className="p-8 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-ember-soft text-ember-deep">
            <IconCalendar width={26} height={26} />
          </span>
          <h1 className="mt-4 font-display text-xl font-semibold text-ink">No shifts scheduled</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-soft">
            Your manager publishes the next roster soon. Keep your availability up to date so
            you&rsquo;re only rostered when you can work.
          </p>
          <Link
            href="/me/availability"
            className="mt-5 inline-flex min-h-12 items-center justify-center rounded-xl border border-line-strong bg-surface px-5 text-sm font-medium text-ink"
          >
            Update my availability
          </Link>
        </Card>
      )}

      {updatedAgo && (
        <p className="mt-2 text-center text-[12px] text-ink-faint">
          Updated {updatedAgo}
          {refreshing ? " · checking…" : ""}
        </p>
      )}

      {/* ---- the rest of the upcoming shifts, by week ---- */}
      {weeks.map((week) => (
        <section key={week.weekStart} className="mt-6">
          <h2 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
            {weekHeading(week.weekStart, today)}
          </h2>
          <Card className="divide-y divide-line overflow-hidden">
            {week.shifts.map((s) => (
              <ShiftRow
                key={s.id}
                shift={s}
                timezone={timezone}
                today={today}
                roleName={roleName(s.roleId)}
                locationName={locationName(s.locationId)}
              />
            ))}
          </Card>
        </section>
      ))}

      {/* ---- fortnight summary (estimate, never payroll) ---- */}
      <section className="mt-6">
        <h2 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
          Next {periodDays} days
        </h2>
        <Card className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[12px] uppercase tracking-wide text-ink-faint">Rostered hours</p>
              <p className="nums font-display text-3xl font-semibold leading-none text-ink">
                {formatDuration(totals.hours)}
              </p>
              <p className="mt-1 text-[13px] text-ink-soft">
                {totals.shiftCount} {totals.shiftCount === 1 ? "shift" : "shifts"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[12px] uppercase tracking-wide text-ink-faint">Estimated pay</p>
              <p className="nums font-display text-3xl font-semibold leading-none text-ink">
                {formatMoney(totals.estimatedPay)}
              </p>
            </div>
          </div>
          <p className="mt-4 border-t border-line pt-3 text-[12px] leading-snug text-ink-faint">
            {STAFF_PAY_DISCLAIMER}
          </p>
        </Card>
      </section>

      <PreviousShifts
        userId={userId}
        timezone={timezone}
        today={today}
        roleName={roleName}
        locationName={locationName}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero — deliberately the biggest thing on the screen (M7 §3.1)
// ---------------------------------------------------------------------------

function NextShiftHero({
  shift,
  timezone,
  today,
  roleName,
  locationName,
}: {
  shift: MyShift;
  timezone: string;
  today: string;
  roleName: string;
  locationName: string;
}) {
  const days = describeShiftDays(shift, timezone);
  const relative = relativeDayLabel(days.startDate, today);
  const isToday = relative === "Today";
  const hours = shiftPaidHours(shift);

  return (
    <Link
      href={`/me/shifts/${shift.id}`}
      className="block rounded-card bg-charcoal p-5 text-paper shadow-soft"
    >
      <div className="flex items-center gap-2">
        {relative && (
          <span
            className={`rounded-full px-2.5 py-1 text-[12px] font-semibold uppercase tracking-wide ${
              isToday ? "bg-ember text-white" : "bg-paper/15 text-paper"
            }`}
          >
            {relative}
          </span>
        )}
        <span className="text-[13px] text-paper/70">{calendarLabel(days.startDate)}</span>
      </div>

      <p
        className={`nums mt-3 font-display font-semibold leading-none ${
          isToday ? "text-4xl" : "text-[32px]"
        }`}
      >
        {days.label}
      </p>

      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-paper/85">
        <span className="font-medium">{roleName}</span>
        {locationName && (
          <>
            <span className="text-paper/40">·</span>
            <span className="inline-flex items-center gap-1">
              <IconPin width={14} height={14} />
              {locationName}
            </span>
          </>
        )}
      </p>

      <p className="mt-2 text-[13px] text-paper/60">
        {formatDuration(hours)} paid
        {shift.breakMinutes > 0 ? ` · ${shift.breakMinutes} min break` : " · no break"}
      </p>

      <span className="mt-4 inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-ember-glow">
        Shift details
        <IconChevronRight width={16} height={16} />
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// One row in the upcoming list. The whole row is the tap target (≥ 44px).
// ---------------------------------------------------------------------------

function ShiftRow({
  shift,
  timezone,
  today,
  roleName,
  locationName,
}: {
  shift: MyShift;
  timezone: string;
  today: string;
  roleName: string;
  locationName: string;
}) {
  const days = describeShiftDays(shift, timezone);
  const relative = relativeDayLabel(days.startDate, today);

  return (
    <Link
      href={`/me/shifts/${shift.id}`}
      className="flex min-h-16 items-center gap-3 px-4 py-3.5 transition active:bg-surface-2"
    >
      <div className="w-14 shrink-0">
        <p className="text-[13px] font-semibold text-ink">{calendarLabel(days.startDate)}</p>
        {relative && <p className="text-[11px] font-medium text-ember">{relative}</p>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="nums text-[15px] font-semibold text-ink">{days.label}</p>
        <p className="truncate text-[13px] text-ink-soft">
          {roleName}
          {locationName ? ` · ${locationName}` : ""}
        </p>
      </div>
      <span className="shrink-0 text-ink-faint">
        <IconChevronRight width={18} height={18} />
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Previous shifts — collapsed by default (M7 §3.1: "a link is enough"), loaded
// only when asked so the home screen stays fast on a mid-range phone over 4G.
// ---------------------------------------------------------------------------

function PreviousShifts({
  userId,
  timezone,
  today,
  roleName,
  locationName,
}: {
  userId: string | null;
  timezone: string;
  today: string;
  roleName: (id: string) => string;
  locationName: (id: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [shifts, setShifts] = useState<MyShift[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPast = async () => {
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      setShifts(await fetchMyPastShifts(new Date().toISOString(), userId, 20));
    } catch (e) {
      setError(errorText(e, "Couldn't load your previous shifts."));
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && shifts === null && !busy) void loadPast();
  };

  return (
    <section className="mt-6">
      <button
        onClick={toggle}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center justify-between rounded-xl border border-line bg-surface px-4 text-sm font-medium text-ink-soft"
      >
        <span className="inline-flex items-center gap-2">
          <IconClock width={16} height={16} />
          Previous shifts
        </span>
        <span className="text-ink-faint">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="mt-2">
          {busy && (
            <Card className="p-5 text-center text-sm text-ink-faint">Loading previous shifts…</Card>
          )}
          {!busy && error && (
            <Card className="p-5 text-center">
              <p className="text-sm text-clay">{error}</p>
              <Button size="lg" variant="outline" className="mt-3 w-full" onClick={() => void loadPast()}>
                Try again
              </Button>
            </Card>
          )}
          {!busy && !error && shifts?.length === 0 && (
            <Card className="p-5 text-center text-sm text-ink-soft">
              No past shifts on record yet.
            </Card>
          )}
          {!busy && !error && shifts && shifts.length > 0 && (
            <Card className="divide-y divide-line overflow-hidden opacity-80">
              {shifts.map((s) => (
                <ShiftRow
                  key={s.id}
                  shift={s}
                  timezone={timezone}
                  today={today}
                  roleName={roleName(s.roleId)}
                  locationName={locationName(s.locationId)}
                />
              ))}
            </Card>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

/** "This week" / "Next week" / "Week of Mon 17 Aug" — plain words, no jargon. */
function weekHeading(weekStart: string, today: string): string {
  if (today >= weekStart && today <= addDaysISO(weekStart, 6)) return "This week";
  if (today >= addDaysISO(weekStart, -7) && today < weekStart) return "Next week";
  return `Week of ${calendarLabel(weekStart)}`;
}
