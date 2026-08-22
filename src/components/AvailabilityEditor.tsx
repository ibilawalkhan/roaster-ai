"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Label, Select } from "@/components/ui";
import { IconTrash } from "@/components/icons";
import {
  deleteException,
  fetchExceptions,
  fetchPatterns,
  upsertException,
  upsertPattern,
  type ExceptionRow,
} from "@/lib/supabase/availability";
import { formatDayLong, todayISO } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { fetchMyShiftsOnDate } from "@/lib/supabase/my-shifts";
import { MANAGERS, notify } from "@/lib/notify";
import { shiftWhen } from "@/lib/notify/labels";

// Display order Mon–Sun; stored day_of_week is 0=Sun..6=Sat.
const DAYS: { dow: number; label: string }[] = [
  { dow: 1, label: "Monday" },
  { dow: 2, label: "Tuesday" },
  { dow: 3, label: "Wednesday" },
  { dow: 4, label: "Thursday" },
  { dow: 5, label: "Friday" },
  { dow: 6, label: "Saturday" },
  { dow: 0, label: "Sunday" },
];

interface DayState {
  isAvailable: boolean;
  from: string;
  to: string;
  set: boolean;
}

const hhmm = (t: string | null): string => (t ? t.slice(0, 5) : "");

export function AvailabilityEditor({
  userId,
  businessId,
  editorId,
}: {
  userId: string;
  businessId: string;
  editorId: string;
}) {
  const { team, business } = useStore();
  const timezone = business?.timezone ?? "Australia/Sydney";

  const [days, setDays] = useState<Record<number, DayState>>({});
  /** Shown when they block a date they are already rostered on (M3 §5). */
  const [rosteredWarning, setRosteredWarning] = useState<string | null>(null);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  // exception form
  const [exDate, setExDate] = useState("");
  const [exAvailable, setExAvailable] = useState(false);
  const [exReason, setExReason] = useState("");

  const load = useCallback(async () => {
    try {
      const [patterns, excs] = await Promise.all([
        fetchPatterns(userId),
        fetchExceptions(userId, todayISO()),
      ]);
      const next: Record<number, DayState> = {};
      for (const { dow } of DAYS) {
        const p = patterns.find((r) => r.day_of_week === dow);
        next[dow] = p
          ? { isAvailable: p.is_available, from: hhmm(p.from_time), to: hhmm(p.to_time), set: true }
          : { isAvailable: true, from: "", to: "", set: false };
      }
      setDays(next);
      setExceptions(excs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load availability.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    // Fetch-on-mount: setState runs after the await, never during render, so
    // this can't cause a render loop (what the rule guards against).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const setDay = (dow: number, patch: Partial<DayState>) =>
    setDays((d) => ({ ...d, [dow]: { ...d[dow], ...patch } }));

  /**
   * "Available all week" — the common case, and previously seven taps plus a
   * save. Most people ARE available most days; asking them to say so one day at
   * a time is exactly the friction that stops availability being maintained
   * (M3 §1: it must be almost free to keep up to date).
   *
   * Blank times mean "any time the shop is open", which is what shows as ✓ on
   * the manager's grid.
   */
  const setAllDays = (isAvailable: boolean) => {
    setDays((d) => {
      const next: Record<number, DayState> = {};
      for (const { dow } of DAYS) {
        next[dow] = { ...d[dow], isAvailable, from: "", to: "" };
      }
      return next;
    });
    setSavedNote(null);
  };

  const savePattern = async () => {
    setSaving(true);
    setError(null);
    setSavedNote(null);
    try {
      for (const { dow } of DAYS) {
        const d = days[dow];
        const hasWindow = d.isAvailable && d.from && d.to;
        await upsertPattern({
          businessId,
          userId,
          dayOfWeek: dow,
          isAvailable: d.isAvailable,
          from: hasWindow ? d.from : null,
          to: hasWindow ? d.to : null,
          updatedBy: editorId,
        });
      }
      setSavedNote("Availability saved. Your manager sees this when building the roster.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const addException = async () => {
    if (!exDate) return;
    setError(null);
    try {
      await upsertException({
        businessId,
        userId,
        date: exDate,
        isAvailable: exAvailable,
        from: null,
        to: null,
        reason: exReason.trim() || null,
        source: userId === editorId ? "staff" : "manager",
        createdBy: editorId,
      });
      // M3 §5 / M9 E14 — marking yourself unavailable NEVER removes a shift you
      // already hold. Availability and dropping a shift are different actions
      // and must not be conflated. So if they're rostered that day, the shift
      // stands and the MANAGER is told, rather than the roster silently
      // developing a hole nobody notices until service.
      if (!exAvailable) {
        await alertManagerIfRostered(exDate);
      }

      setExDate("");
      setExReason("");
      setExAvailable(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that date.");
    }
  };

  /** Tell the manager when this person is rostered on a date they've just blocked. */
  const alertManagerIfRostered = async (date: string) => {
    try {
      const clashes = await fetchMyShiftsOnDate(userId, date);
      if (clashes.length === 0) return;

      const staffName = team.find((m) => m.id === userId)?.name ?? "A team member";
      for (const clash of clashes) {
        void notify({
          event: "E14",
          businessId,
          timezone,
          recipients: MANAGERS,
          payload: {
            shiftId: clash.id,
            staffUserId: userId,
            staffName,
            when: shiftWhen(clash.start_at, timezone),
          },
        });
      }
      setRosteredWarning(
        clashes.length === 1
          ? "You're rostered that day. Your shift stands until your manager confirms — use “I can't make this shift” if you need cover."
          : `You're rostered on ${clashes.length} shifts that day. They stand until your manager confirms.`,
      );
    } catch {
      // Never let the alert break the availability save: the person's own
      // record is the thing that must land.
    }
  };

  const removeException = async (id: string) => {
    setError(null);
    try {
      await deleteException(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove that date.");
    }
  };

  if (loading) {
    return <Card className="p-8 text-center text-sm text-ink-faint">Loading availability…</Card>;
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-lg border border-clay/30 bg-clay/5 px-3 py-2 text-[13px] text-clay">
          {error}
        </p>
      )}

      {/* M3 §5 — blocking a date you're rostered on does NOT drop the shift.
          Saying so plainly prevents the most damaging misunderstanding here:
          someone assuming they're off, and not turning up. */}
      {rosteredWarning && (
        <div className="flex items-start gap-3 rounded-lg border border-saffron/40 bg-saffron-soft px-3 py-2.5">
          <p className="flex-1 text-[13px] leading-snug text-[#8a6212]">{rosteredWarning}</p>
          <button
            onClick={() => setRosteredWarning(null)}
            className="min-h-11 shrink-0 px-1 text-[13px] font-semibold text-[#8a6212] underline"
          >
            Got it
          </button>
        </div>
      )}

      {/* Weekly pattern */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h2 className="font-display text-base font-semibold text-ink">Usual week</h2>
            <p className="text-[12px] text-ink-faint">Tap a day off, or set the hours you can work.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAllDays(true)}
              className="min-h-11 rounded-lg border border-herb/40 bg-herb-soft px-3 text-[13px] font-medium text-herb"
            >
              Available all week
            </button>
            <button
              type="button"
              onClick={() => setAllDays(false)}
              className="min-h-11 rounded-lg border border-line px-3 text-[13px] font-medium text-ink-soft"
            >
              Clear all
            </button>
          </div>
        </div>
        <div className="divide-y divide-line">
          {DAYS.map(({ dow, label }) => {
            const d = days[dow];
            if (!d) return null;
            return (
              <div key={dow} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setDay(dow, { isAvailable: !d.isAvailable })}
                  className={`min-w-24 rounded-full border px-3 py-1.5 text-[13px] font-medium transition ${
                    d.isAvailable
                      ? "border-herb/40 bg-herb-soft text-herb"
                      : "border-line bg-surface-2 text-ink-faint"
                  }`}
                >
                  {d.isAvailable ? "Available" : "Not available"}
                </button>
                <span className="w-24 text-sm font-medium text-ink">{label}</span>
                {d.isAvailable && (
                  <div className="flex items-center gap-1.5 text-[13px] text-ink-soft">
                    <Input
                      type="time"
                      value={d.from}
                      onChange={(e) => setDay(dow, { from: e.target.value })}
                      className="nums h-9 w-28"
                      aria-label={`${label} from`}
                    />
                    <span>–</span>
                    <Input
                      type="time"
                      value={d.to}
                      onChange={(e) => setDay(dow, { to: e.target.value })}
                      className="nums h-9 w-28"
                      aria-label={`${label} to`}
                    />
                    <span className="text-ink-faint">{!d.from && !d.to ? "any open time" : ""}</span>
                  </div>
                )}
                {!d.set && (
                  <span className="rounded-full bg-saffron-soft px-2 py-0.5 text-[11px] font-semibold text-[#8a6212]">
                    not set
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line bg-surface-2 px-4 py-3">
          <span className="text-[12px] text-ink-faint">{savedNote}</span>
          <Button size="sm" onClick={savePattern} disabled={saving}>
            {saving ? "Saving…" : "Save week"}
          </Button>
        </div>
      </Card>

      {/* Exceptions */}
      <Card className="overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-display text-base font-semibold text-ink">Specific dates</h2>
          <p className="text-[12px] text-ink-faint">A one-off day you can&rsquo;t (or can) work.</p>
        </div>

        <div className="space-y-3 px-4 py-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="exdate">Date</Label>
              <Input
                id="exdate"
                type="date"
                min={todayISO()}
                value={exDate}
                onChange={(e) => setExDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="exkind">This date I&rsquo;m…</Label>
              <Select
                id="exkind"
                value={exAvailable ? "available" : "unavailable"}
                onChange={(e) => setExAvailable(e.target.value === "available")}
              >
                <option value="unavailable">Not available</option>
                <option value="available">Available</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="exreason">Reason (optional)</Label>
            <Input
              id="exreason"
              value={exReason}
              onChange={(e) => setExReason(e.target.value)}
              placeholder="e.g. wedding, exam"
            />
          </div>
          <Button size="sm" variant="outline" onClick={addException} disabled={!exDate}>
            Add date
          </Button>
        </div>

        {exceptions.length > 0 && (
          <ul className="divide-y divide-line border-t border-line">
            {exceptions.map((ex) => (
              <li key={ex.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${ex.is_available ? "bg-herb" : "bg-clay"}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{formatDayLong(ex.date)}</p>
                  <p className="text-[12px] text-ink-faint">
                    {ex.is_available ? "Available" : "Not available"}
                    {ex.reason ? ` · ${ex.reason}` : ""}
                    {ex.source === "manager" ? " · set by manager" : ""}
                  </p>
                </div>
                <button
                  onClick={() => removeException(ex.id)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-ink-faint transition hover:bg-paper-deep hover:text-clay"
                  aria-label="Remove"
                >
                  <IconTrash width={16} height={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
