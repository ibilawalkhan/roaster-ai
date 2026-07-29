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
import { Avatar, Badge, Button, Card, Textarea } from "@/components/ui";
import { IconChevronLeft, IconPin, IconUsers } from "@/components/icons";
import { useStore } from "@/lib/store";
import {
  fetchColleaguesOnShift,
  fetchShiftById,
  type ColleagueOnShift,
} from "@/lib/supabase/my-shifts";
import { requestDrop } from "@/lib/supabase/swaps";
import { MANAGERS, notify } from "@/lib/notify";
import { shiftWhen } from "@/lib/notify/labels";
import {
  dropWindow,
  staffStatusHeadline,
  STILL_ROSTERED_NOTICE,
  type DropWindow,
} from "@/lib/domain/swaps";
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

  const { me, business, roles, locations, session } = useStore();
  const timezone = business?.timezone ?? "Australia/Sydney";

  const [shift, setShift] = useState<MyShift | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  const [colleagues, setColleagues] = useState<ColleagueOnShift[] | null>(null);
  const [colleaguesError, setColleaguesError] = useState<string | null>(null);

  // ---- M8 §3.1: "I can't make this shift" ----
  const [dropOpen, setDropOpen] = useState(false);
  const [dropReason, setDropReason] = useState("");
  const [dropping, setDropping] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  // A slow tick keeps the 4-hour cutoff honest on a phone left open in a pocket:
  // a screen opened at 5 hours out must not still offer the button at 3.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

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

  /**
   * Ask the manager for cover (M8 §3.1). The transition itself is the
   * `request_drop` RPC — status, audit event and "the dropper stays responsible"
   * all live in the database. Success is reported ONLY after the call resolves
   * and the shift has been re-read, so this screen can never show "cover
   * requested" for a request the server never took.
   */
  const submitDrop = async () => {
    if (!shift) return;
    setDropping(true);
    setDropError(null);
    try {
      await requestDrop(shift.id, dropReason);

      // M9 E6 — MANAGER ONLY. Never broadcast to the team: the manager is the
      // gate (M8 §1), and nobody else learns this shift is in trouble until the
      // manager chooses to open it. `MANAGERS` is resolved server-side because
      // staff cannot (and must not) read the team list.
      //
      // Enqueued AFTER the RPC has confirmed, and `void`-ed: notify() cannot
      // throw, so a notification failure can never undo the request the person
      // has just been told went through (CLAUDE.md rule 7).
      if (session.businessId) {
        void notify({
          event: "E6",
          businessId: session.businessId,
          timezone,
          recipients: MANAGERS,
          payload: {
            shiftId: shift.id,
            when: shiftWhen(shift.startAt, timezone),
            staffName: me?.name ?? "A staff member",
            reason: dropReason.trim() ? dropReason.trim() : null,
          },
        });
      }

      const fresh = await fetchShiftById(shift.id);
      if (fresh) setShift(fresh);
      setDropOpen(false);
      setDropReason("");
    } catch (e) {
      // SwapError already carries the sentence to show (M8 §5).
      setDropError(errorText(e, "Couldn't send that request. Nothing was sent — try again."));
    } finally {
      setDropping(false);
    }
  };

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

      {/* ---- primary action: ask for cover (M8 §3.1) ---- */}
      <DropSection
        status={shift.status}
        window={dropWindow(shift.startAt, now)}
        open={dropOpen}
        reason={dropReason}
        busy={dropping}
        error={dropError}
        onOpen={() => {
          setDropError(null);
          setDropOpen(true);
        }}
        onCancel={() => {
          setDropOpen(false);
          setDropError(null);
        }}
        onReason={setDropReason}
        onConfirm={() => void submitDrop()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drop / cover request (M8 §3.1)
//
// The state machine lives in the database; this only renders which of the four
// situations the staff member is in:
//   already requested → say so, and say they are STILL ROSTERED;
//   inside the cutoff → tell them to phone, don't offer a button that can't help;
//   confirming        → optional short reason, then confirm;
//   otherwise         → the button.
// ---------------------------------------------------------------------------

function DropSection({
  status,
  window: dropWin,
  open,
  reason,
  busy,
  error,
  onOpen,
  onCancel,
  onReason,
  onConfirm,
}: {
  status: MyShift["status"];
  window: DropWindow;
  open: boolean;
  reason: string;
  busy: boolean;
  error: string | null;
  onOpen: () => void;
  onCancel: () => void;
  onReason: (value: string) => void;
  onConfirm: () => void;
}) {
  const headline = staffStatusHeadline(status);

  // ---- a request is already in flight ----
  if (headline) {
    return (
      <section className="mt-6">
        <Card className="border-saffron/40 bg-saffron-soft/50 p-5">
          <p className="text-[15px] font-semibold text-[#8a6212]">{headline}</p>
          {/* The sentence that prevents the most damaging misunderstanding
              available in this product (M8 §3.1). */}
          <p className="mt-2 text-[14px] font-medium leading-relaxed text-ink">
            {STILL_ROSTERED_NOTICE}
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
            Turn up as rostered unless your manager tells you otherwise. If anything changes,
            you&rsquo;ll see it here.
          </p>
        </Card>
      </section>
    );
  }

  // ---- too close to service to be an app problem (M8 §3.1) ----
  if (!dropWin.canRequest) {
    return (
      <section className="mt-6">
        <Card className="p-5">
          <p className="text-[15px] font-semibold text-ink">Can&rsquo;t make this shift?</p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{dropWin.reason}</p>
          <p className="mt-2 text-[13px] font-medium leading-relaxed text-ink">
            {STILL_ROSTERED_NOTICE}
          </p>
        </Card>
      </section>
    );
  }

  // ---- the confirm sheet ----
  if (open) {
    return (
      <section className="mt-6">
        <Card className="p-5">
          <h2 className="font-display text-lg font-semibold text-ink">Ask for cover</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
            This tells your manager only. Nobody else is asked unless your manager decides to open
            the shift to the team.
          </p>

          <label
            htmlFor="drop-reason"
            className="mt-4 block text-[12px] font-semibold uppercase tracking-wider text-ink-soft"
          >
            Reason (optional)
          </label>
          <Textarea
            id="drop-reason"
            value={reason}
            maxLength={200}
            disabled={busy}
            onChange={(e) => onReason(e.target.value)}
            placeholder="e.g. family commitment"
            className="mt-1.5"
          />

          <p className="mt-3 rounded-lg border border-saffron/40 bg-saffron-soft/50 px-3 py-2 text-[13px] font-medium leading-snug text-[#8a6212]">
            {STILL_ROSTERED_NOTICE}
          </p>

          {error && (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-clay/30 bg-clay/5 px-3 py-2 text-[13px] leading-snug text-clay"
            >
              {error}
            </p>
          )}

          <div className="mt-4 flex flex-col gap-2">
            <Button size="lg" className="w-full" disabled={busy} onClick={onConfirm}>
              {busy ? "Sending…" : "Send to my manager"}
            </Button>
            <Button size="lg" variant="ghost" className="w-full" disabled={busy} onClick={onCancel}>
              Not now
            </Button>
          </div>
        </Card>
      </section>
    );
  }

  // ---- the button ----
  return (
    <section className="mt-6">
      <Button size="lg" variant="outline" className="w-full" onClick={onOpen}>
        I can&rsquo;t make this shift
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-center text-[13px] text-clay">
          {error}
        </p>
      )}
      <p className="mt-2 text-center text-[12px] leading-snug text-ink-faint">
        Your manager is told, and decides who covers it.
      </p>
    </section>
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
