"use client";

// M7 §3.2 — shift detail.
//
// Deep-linkable by design: an SMS from M9 links straight here, so this screen
// loads a single shift by id on its own and never assumes the user came via the
// home screen. Everything it shows is either the staff member's own data or a
// colleague's NAME AND JOB ROLE — never anyone's pay, hours or contact details
// (M7 §4, enforced by RLS in migrations 0002/0006, not by this file).

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Avatar, Badge, Button, Card } from "@/components/ui";
import { IconChevronLeft, IconPin, IconUsers } from "@/components/icons";
import { useStore } from "@/lib/store";
import {
  fetchColleaguesOnShift,
  fetchShiftById,
  type ColleagueOnShift,
} from "@/lib/supabase/my-shifts";
import {
  calendarLabel,
  describeShiftDays,
  formatDuration,
  relativeDayLabel,
  shiftEstimatedPay,
  shiftPaidHours,
  STAFF_PAY_DISCLAIMER,
  type MyShift,
} from "@/lib/domain/my-roster";
import { wallDateIn } from "@/lib/domain/timezone";
import { formatMoney } from "@/lib/utils";

type LoadStatus = "loading" | "ready" | "missing" | "error";

const errorText = (e: unknown, fallback: string): string =>
  e instanceof Error && e.message ? e.message : fallback;

export default function ShiftDetail() {
  const params = useParams();
  const raw = params?.id;
  const shiftId = typeof raw === "string" ? raw : Array.isArray(raw) ? (raw[0] ?? "") : "";

  const { me, business, roles, locations } = useStore();
  const timezone = business?.timezone ?? "Australia/Sydney";

  const [shift, setShift] = useState<MyShift | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  const [colleagues, setColleagues] = useState<ColleagueOnShift[] | null>(null);
  const [colleaguesError, setColleaguesError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!shiftId) {
      setStatus("missing");
      return;
    }
    setStatus("loading");
    setError(null);
    setColleaguesError(null);
    try {
      const found = await fetchShiftById(shiftId);
      if (!found) {
        // Withdrawn roster, reassigned shift, or simply not theirs — all of which
        // RLS reports identically, and all of which mean the same thing here.
        setShift(null);
        setStatus("missing");
        return;
      }
      setShift(found);
      setStatus("ready");
    } catch (e) {
      setError(errorText(e, "Couldn't load this shift. Check your signal."));
      setStatus("error");
      return;
    }
    // Colleagues are a nice-to-have: a failure here must never take down the
    // shift detail itself, so it is loaded and reported separately.
    try {
      setColleagues(await fetchColleaguesOnShift(shiftId));
    } catch (e) {
      setColleaguesError(errorText(e, "Couldn't load who else is on."));
    }
  }, [shiftId]);

  useEffect(() => {
    // setState only ever runs after an await — no render loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const back = (
    <Link
      href="/me"
      className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-ink-soft"
    >
      <IconChevronLeft width={18} height={18} />
      My shifts
    </Link>
  );

  if (status === "loading") {
    return (
      <div className="px-4 py-5" aria-busy="true" aria-live="polite">
        {back}
        <span className="sr-only">Loading this shift…</span>
        <div className="h-44 animate-pulse rounded-card bg-surface-2" />
        <div className="mt-3 h-28 animate-pulse rounded-card bg-surface-2" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="px-4 py-5">
        {back}
        <Card className="p-6 text-center">
          <h1 className="font-display text-lg font-semibold text-ink">Can&rsquo;t load this shift</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-soft">{error}</p>
          <Button size="lg" className="mt-5 w-full" onClick={() => void load()}>
            Try again
          </Button>
        </Card>
      </div>
    );
  }

  if (status === "missing" || !shift) {
    return (
      <div className="px-4 py-5">
        {back}
        <Card className="p-6 text-center">
          <h1 className="font-display text-lg font-semibold text-ink">This shift isn&rsquo;t yours</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-soft">
            It may have been changed, or your manager may have withdrawn the roster. Check My shifts
            for the current one.
          </p>
          <Link
            href="/me"
            className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-ember px-5 text-sm font-semibold text-white"
          >
            Back to my shifts
          </Link>
        </Card>
      </div>
    );
  }

  const days = describeShiftDays(shift, timezone);
  const today = wallDateIn(new Date().toISOString(), timezone);
  const relative = relativeDayLabel(days.startDate, today);
  const role = roles.find((r) => r.id === shift.roleId);
  const location = locations.find((l) => l.id === shift.locationId);
  const hours = shiftPaidHours(shift);
  const pay = shiftEstimatedPay(shift, me?.payRate ?? 0);
  const roleNameOf = (id: string): string => roles.find((r) => r.id === id)?.name ?? "Shift";

  return (
    <div className="px-4 py-5">
      {back}

      {/* ---- when ---- */}
      <Card className="bg-charcoal p-5 text-paper">
        <div className="flex items-center gap-2">
          {relative && (
            <span
              className={`rounded-full px-2.5 py-1 text-[12px] font-semibold uppercase tracking-wide ${
                relative === "Today" ? "bg-ember text-white" : "bg-paper/15 text-paper"
              }`}
            >
              {relative}
            </span>
          )}
          <span className="text-[13px] text-paper/70">{calendarLabel(days.startDate)}</span>
        </div>
        <h1 className="nums mt-3 font-display text-[32px] font-semibold leading-none">
          {days.label}
        </h1>
        {days.crossesMidnight && (
          <p className="mt-2 text-[13px] text-paper/60">
            Finishes on {calendarLabel(days.endDate)} — this shift runs overnight.
          </p>
        )}
      </Card>

      {/* ---- where and what ---- */}
      <Card className="mt-3 divide-y divide-line overflow-hidden">
        <DetailRow label="Job" value={role?.name ?? "Shift"} />
        <DetailRow
          label="Location"
          value={location?.name ?? "—"}
          sub={location?.address ?? undefined}
          icon={<IconPin width={16} height={16} />}
        />
        <DetailRow
          label="Unpaid break"
          value={shift.breakMinutes > 0 ? `${shift.breakMinutes} minutes` : "None"}
        />
        <DetailRow label="Paid hours" value={formatDuration(hours)} />
      </Card>

      {/* ---- your estimate (never payroll — CLAUDE.md rule 5) ---- */}
      <Card className="mt-3 p-5">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-[12px] uppercase tracking-wide text-ink-faint">Estimated pay</p>
          <p className="nums font-display text-2xl font-semibold text-ink">{formatMoney(pay, true)}</p>
        </div>
        <p className="mt-3 border-t border-line pt-3 text-[12px] leading-snug text-ink-faint">
          {STAFF_PAY_DISCLAIMER}
        </p>
      </Card>

      {/* ---- manager's note, when there is one ---- */}
      {shift.note && (
        <Card className="mt-3 p-5">
          <p className="text-[12px] uppercase tracking-wide text-ink-faint">Note from your manager</p>
          <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-ink">{shift.note}</p>
        </Card>
      )}

      {/* ---- who else is on: names and job roles ONLY (M7 §4) ---- */}
      <section className="mt-6">
        <h2 className="mb-2 flex items-center gap-2 px-1 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
          <IconUsers width={14} height={14} />
          Who else is on
        </h2>
        <Card className="overflow-hidden">
          {colleaguesError ? (
            <div className="p-5 text-center">
              <p className="text-sm text-ink-soft">{colleaguesError}</p>
              <Button size="lg" variant="outline" className="mt-3 w-full" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          ) : colleagues === null ? (
            <p className="p-5 text-center text-sm text-ink-faint">Checking who else is on…</p>
          ) : colleagues.length === 0 ? (
            <p className="p-5 text-center text-sm leading-relaxed text-ink-soft">
              Nobody else is listed for this time. Your manager can confirm who else is on.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {colleagues.map((c) => (
                <li key={c.userId} className="flex min-h-16 items-center gap-3 px-4 py-3">
                  <Avatar name={c.name} accent="ember" size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium text-ink">{c.name}</p>
                  </div>
                  <Badge tone="neutral">{roleNameOf(c.roleId)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/*
        ---- primary action: drop this shift ----
        SEAM FOR M8 (shift swaps). The whole drop/claim workflow — the
        `request_drop` RPC, the state machine and the manager approval critical
        section — belongs to Module 8 and is being built separately. This button
        is present so the screen's shape is final, and DISABLED so it can never
        report a success the server did not confirm (M7 §5). To wire it up:
        replace the disabled button with a confirm sheet that calls
        supabase.rpc("request_drop", { p_shift_id: shift.id }) and only tells the
        user it worked once that call resolves.
      */}
      <section className="mt-6">
        <Button size="lg" variant="outline" className="w-full" disabled aria-describedby="drop-soon">
          I can&rsquo;t make this shift
        </Button>
        <p id="drop-soon" className="mt-2 text-center text-[12px] text-ink-faint">
          Coming soon. For now, tell your manager directly.
        </p>
      </section>
    </div>
  );
}

function DetailRow({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-16 items-center gap-3 px-4 py-3.5">
      {icon && (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-soft">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[12px] uppercase tracking-wide text-ink-faint">{label}</p>
        <p className="text-[15px] font-medium text-ink">{value}</p>
        {sub && <p className="mt-0.5 text-[13px] leading-snug text-ink-soft">{sub}</p>}
      </div>
    </div>
  );
}
