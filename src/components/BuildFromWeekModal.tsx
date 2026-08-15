"use client";

// M4 §4.4 — "Create template from a past week".
//
// A restaurant with existing rosters should never face a blank template screen.
// Their real week already IS the answer: read it back into slots and the setup
// becomes an edit task rather than a design task. The spec calls this the
// single highest-value onboarding shortcut in the product, and it is the reason
// Al Tazah can be live in an afternoon instead of an evening.
//
// The destructive part is stated before it happens: this REPLACES the template,
// because silently blending old slots into derived ones produces a template
// that matches neither week.

import { useCallback, useEffect, useState } from "react";
import { Button, Modal, Select } from "@/components/ui";
import {
  deriveSlotsFromWeek,
  type ConversionSummary,
} from "@/lib/domain/template-from-week";
import {
  fetchPastWeeks,
  fetchWeekShifts,
  type PastWeekOption,
} from "@/lib/supabase/template";
import { formatRange } from "@/lib/utils";
import { addDaysISO } from "@/lib/domain/timezone";

const DOW_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function BuildFromWeekModal({
  existingSlotCount,
  roleName,
  onClose,
  onApply,
}: {
  existingSlotCount: number;
  roleName: (id: string) => string;
  onClose: () => void;
  onApply: (summary: ConversionSummary) => Promise<void>;
}) {
  const [weeks, setWeeks] = useState<PastWeekOption[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [preview, setPreview] = useState<ConversionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await fetchPastWeeks();
      setWeeks(list);
      setSelected(list[0]?.rosterId ?? "");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your past rosters.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState runs after the await, never during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const buildPreview = useCallback(async (rosterId: string) => {
    if (!rosterId) return;
    setPreviewing(true);
    setError(null);
    try {
      const shifts = await fetchWeekShifts(rosterId);
      setPreview(deriveSlotsFromWeek(shifts));
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "Couldn't read that week.");
    } finally {
      setPreviewing(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void buildPreview(selected);
  }, [selected, buildPreview]);

  const apply = async () => {
    if (!preview || preview.slots.length === 0) return;
    setApplying(true);
    setError(null);
    try {
      await onApply(preview);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't build the template. Nothing was changed.");
      setApplying(false);
    }
  };

  const derived = preview?.slots ?? [];
  const byDay = new Map<number, typeof derived>();
  for (const slot of derived) {
    byDay.set(slot.dayOfWeek, [...(byDay.get(slot.dayOfWeek) ?? []), slot]);
  }
  // Monday-first, matching the grid.
  const orderedDays = [...byDay.keys()].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));

  return (
    <Modal
      open
      onClose={onClose}
      title="Build from a past week"
      subtitle="Turn a week you actually worked into your staffing template"
      maxWidth={620}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={applying}>
            Cancel
          </Button>
          <Button
            onClick={() => void apply()}
            disabled={applying || previewing || !preview || preview.slots.length === 0}
          >
            {applying ? "Building…" : "Use this week"}
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="py-8 text-center text-sm text-ink-faint">Loading your past rosters…</p>
      ) : weeks.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm text-ink-soft">
            No published rosters yet, so there&rsquo;s nothing to copy from.
          </p>
          <p className="mx-auto mt-2 max-w-sm text-[13px] text-ink-faint">
            Build the week by hand instead — add a slot to one day, then use{" "}
            <span className="font-medium text-ink-soft">Copy</span> to repeat it across the others.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label
              htmlFor="past-week"
              className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-ink-soft"
            >
              Which week?
            </label>
            <Select
              id="past-week"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={applying}
            >
              {weeks.map((w) => (
                <option key={w.rosterId} value={w.rosterId}>
                  {formatRange(w.startDate, addDaysISO(w.startDate, w.days - 1))} ·{" "}
                  {w.shiftCount} shift{w.shiftCount === 1 ? "" : "s"}
                </option>
              ))}
            </Select>
            <p className="mt-1.5 text-[12px] text-ink-faint">
              Pick a typical week — a quiet one will under-staff your template.
            </p>
          </div>

          {previewing ? (
            <p className="py-4 text-center text-sm text-ink-faint">Reading that week…</p>
          ) : preview && preview.slots.length > 0 ? (
            <>
              <div className="rounded-xl bg-surface-2 px-3.5 py-3 text-[13px] text-ink-soft">
                <span className="nums font-semibold text-ink">{preview.shiftsRead}</span> shifts
                become{" "}
                <span className="nums font-semibold text-ink">{preview.slots.length}</span> slots
                across{" "}
                <span className="nums font-semibold text-ink">{preview.daysCovered}</span> day
                {preview.daysCovered === 1 ? "" : "s"} —{" "}
                <span className="nums font-semibold text-ink">{preview.totalPositions}</span> people
                a week. People rostered the same role and hours are grouped into one slot.
              </div>

              <div className="max-h-64 space-y-3 overflow-y-auto">
                {orderedDays.map((dow) => (
                  <div key={dow}>
                    <p className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                      {DOW_LABEL[dow]}
                    </p>
                    <ul className="space-y-1">
                      {(byDay.get(dow) ?? []).map((s, i) => (
                        <li
                          key={`${dow}-${i}`}
                          className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-[13px]"
                        >
                          <span className="text-ink">
                            {roleName(s.roleId)}{" "}
                            <span className="nums text-ink-soft">
                              {s.start}–{s.end}
                            </span>
                          </span>
                          <span className="nums font-semibold text-ink">×{s.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {existingSlotCount > 0 && (
                <p className="rounded-lg border border-saffron/40 bg-saffron-soft px-3 py-2.5 text-[13px] leading-snug text-[#8a6212]">
                  This replaces the {existingSlotCount} slot
                  {existingSlotCount === 1 ? "" : "s"} already in your template. You can edit
                  everything afterwards.
                </p>
              )}
            </>
          ) : (
            <p className="py-4 text-center text-sm text-ink-faint">
              Nobody was rostered that week, so there&rsquo;s nothing to copy.
            </p>
          )}

          {error && (
            <p className="rounded-lg border border-clay/30 bg-clay/5 px-3 py-2 text-[13px] text-clay">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
