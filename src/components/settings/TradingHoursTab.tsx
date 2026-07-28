"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { Button, Input, Select, cx } from "@/components/ui";
import {
  ErrorPanel,
  IssueList,
  LoadingPanel,
  SavedNote,
  SectionCard,
  Toggle,
  WriteError,
} from "./shared";
import {
  DAY_NAMES,
  hasErrors,
  isOvernightWindow,
  validateTradingHours,
  type SettingsIssue,
  type TradingHoursDay,
} from "@/lib/domain/settings-validation";
import {
  fetchTradingHours,
  upsertTradingHours,
  type TradingHoursRow,
} from "@/lib/supabase/settings";

// Display order runs Monday-first, which is how a roster week reads; the stored
// day_of_week is still 0=Sunday to match Postgres and JS getDay().
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const DEFAULT_DAY = (dayOfWeek: number): TradingHoursDay => ({
  dayOfWeek,
  isOpen: true,
  is24h: false,
  opensAt: "10:00",
  closesAt: "22:00",
});

const hhmm = (t: string | null): string | null => (t ? t.slice(0, 5) : null);

function rowToDay(row: TradingHoursRow): TradingHoursDay {
  return {
    dayOfWeek: row.day_of_week,
    isOpen: row.is_open,
    is24h: row.is_24h,
    opensAt: hhmm(row.opens_at) ?? "10:00",
    closesAt: hhmm(row.closes_at) ?? "22:00",
  };
}

/** M1 §3.3 — the scheduler's clock. Without it, senior coverage has no meaning. */
export function TradingHoursTab() {
  const { locations, session } = useStore();
  const activeLocations = useMemo(() => locations.filter((l) => l.active), [locations]);

  const [locationId, setLocationId] = useState<string>("");
  const [allRows, setAllRows] = useState<TradingHoursRow[]>([]);
  const [week, setWeek] = useState<TradingHoursDay[]>([]);
  const [sameEveryDay, setSameEveryDay] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [issues, setIssues] = useState<SettingsIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setAllRows(await fetchTradingHours());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load your trading hours.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Pick a location once the store has them.
  useEffect(() => {
    if (!locationId && activeLocations.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocationId(activeLocations[0].id);
    }
  }, [activeLocations, locationId]);

  // Rebuild the editable week whenever the selected location or the fetched
  // rows change. Days with no row yet fall back to a sensible default.
  useEffect(() => {
    if (!locationId) return;
    const byDay = new Map<number, TradingHoursRow>();
    for (const r of allRows) if (r.location_id === locationId) byDay.set(r.day_of_week, r);
    const next = DISPLAY_ORDER.map((dow) => {
      const row = byDay.get(dow);
      return row ? rowToDay(row) : DEFAULT_DAY(dow);
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWeek(next);
    setIssues([]);
    setSaved(false);
  }, [locationId, allRows]);

  const patchDay = (dayOfWeek: number, patch: Partial<TradingHoursDay>) => {
    setSaved(false);
    setWeek((prev) =>
      prev.map((d) =>
        // "Same every day" mirrors the edit across the whole week (M1 §4.1 shortcut).
        sameEveryDay || d.dayOfWeek === dayOfWeek ? { ...d, ...patch, dayOfWeek: d.dayOfWeek } : d,
      ),
    );
  };

  const copyToAllDays = (source: TradingHoursDay) => {
    setSaved(false);
    setWeek((prev) =>
      prev.map((d) => ({
        dayOfWeek: d.dayOfWeek,
        isOpen: source.isOpen,
        is24h: source.is24h,
        opensAt: source.opensAt,
        closesAt: source.closesAt,
      })),
    );
  };

  const save = async () => {
    if (!session.businessId || !locationId || busy) return;
    const found = validateTradingHours(week);
    setIssues(found);
    if (hasErrors(found)) return;

    setBusy(true);
    setWriteError(null);
    setSaved(false);
    try {
      await upsertTradingHours(
        week.map((d) => ({
          businessId: session.businessId!,
          locationId,
          dayOfWeek: d.dayOfWeek,
          isOpen: d.isOpen,
          is24h: d.is24h,
          opensAt: d.opensAt,
          closesAt: d.closesAt,
        })),
      );
      await load();
      setSaved(true);
    } catch (e) {
      setWriteError(
        e instanceof Error ? e.message : "Couldn't save trading hours. Nothing was changed.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingPanel label="Loading trading hours…" />;
  if (loadError) return <ErrorPanel message={loadError} onRetry={() => void load()} />;

  if (activeLocations.length === 0) {
    return (
      <SectionCard title="Trading hours">
        <p className="text-sm text-ink-faint">
          Add an active location first — trading hours are set per location.
        </p>
      </SectionCard>
    );
  }

  const editable = sameEveryDay ? week.slice(0, 1) : week;

  return (
    <div className="space-y-5">
      <SectionCard
        title="Trading hours"
        description="When you're open. Rosterly won't roster anyone outside these hours, and the senior-on-site rule is measured against them."
        footer={
          <>
            <SavedNote show={saved} />
            <Button className="h-11" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save trading hours"}
            </Button>
          </>
        }
      >
        {writeError && <WriteError message={writeError} onRetry={save} />}
        <IssueList issues={issues} />

        <div className="flex flex-wrap items-center gap-4">
          {activeLocations.length > 1 && (
            <div className="min-w-[220px]">
              <label htmlFor="th-location" className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-ink-soft">
                Location
              </label>
              <Select
                id="th-location"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                {activeLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <label className="ml-auto flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-ink">
            <input
              type="checkbox"
              checked={sameEveryDay}
              onChange={(e) => {
                setSameEveryDay(e.target.checked);
                if (e.target.checked && week[0]) copyToAllDays(week[0]);
              }}
              className="h-5 w-5 accent-[var(--color-ember)]"
            />
            Same hours every day
          </label>
        </div>

        <div className="space-y-2">
          {editable.map((d) => (
            <DayRow
              key={d.dayOfWeek}
              day={d}
              label={sameEveryDay ? "Every day" : DAY_NAMES[d.dayOfWeek]}
              showCopy={!sameEveryDay}
              onChange={(patch) => patchDay(d.dayOfWeek, patch)}
              onCopyToAll={() => copyToAllDays(d)}
            />
          ))}
        </div>

        <p className="text-[13px] text-ink-soft">
          Closing earlier than you open means you trade past midnight — 18:00 to 02:00 is one
          continuous window ending the next morning, not an error.
        </p>
      </SectionCard>
    </div>
  );
}

function DayRow({
  day,
  label,
  showCopy,
  onChange,
  onCopyToAll,
}: {
  day: TradingHoursDay;
  label: string;
  showCopy: boolean;
  onChange: (patch: Partial<TradingHoursDay>) => void;
  onCopyToAll: () => void;
}) {
  const overnight = isOvernightWindow(day);
  const id = `day-${day.dayOfWeek}`;

  return (
    <div
      className={cx(
        "rounded-xl border px-4 py-3 transition",
        day.isOpen ? "border-line bg-surface" : "border-line bg-surface-2",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span className="w-24 shrink-0 text-sm font-semibold text-ink">{label}</span>

        <Toggle
          checked={day.isOpen}
          onChange={(isOpen) => onChange({ isOpen })}
          label={`${label} open`}
        />

        {day.isOpen ? (
          <>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[13px] text-ink-soft">
              <input
                type="checkbox"
                checked={day.is24h}
                onChange={(e) => onChange({ is24h: e.target.checked })}
                className="h-5 w-5 accent-[var(--color-ember)]"
              />
              24 hours
            </label>

            {!day.is24h && (
              <div className="flex items-center gap-2">
                <Input
                  id={`${id}-open`}
                  aria-label={`${label} opens at`}
                  type="time"
                  value={day.opensAt ?? ""}
                  onChange={(e) => onChange({ opensAt: e.target.value || null })}
                  className="nums w-32"
                />
                <span className="text-ink-faint">to</span>
                <Input
                  id={`${id}-close`}
                  aria-label={`${label} closes at`}
                  type="time"
                  value={day.closesAt ?? ""}
                  onChange={(e) => onChange({ closesAt: e.target.value || null })}
                  className="nums w-32"
                />
              </div>
            )}

            {overnight && (
              <span className="rounded-full bg-paper-deep px-2.5 py-1 text-[12px] font-medium text-ink-soft">
                closes {day.closesAt} next day
              </span>
            )}
            {day.is24h && (
              <span className="rounded-full bg-paper-deep px-2.5 py-1 text-[12px] font-medium text-ink-soft">
                open around the clock
              </span>
            )}
          </>
        ) : (
          <span className="text-[13px] text-ink-faint">Closed — nobody is rostered.</span>
        )}

        {showCopy && (
          <button
            type="button"
            onClick={onCopyToAll}
            className="ml-auto min-h-11 rounded-lg px-3 text-[13px] font-medium text-ember transition hover:bg-ember-soft"
          >
            Copy to every day
          </button>
        )}
      </div>
    </div>
  );
}
