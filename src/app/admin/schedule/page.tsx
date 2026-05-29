"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { ShiftModal } from "@/components/ShiftModal";
import { Badge, Button } from "@/components/ui";
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconPlus,
  IconSend,
} from "@/components/icons";
import { LOCATIONS, type Employee, type LocationName, type Role, type Shift } from "@/lib/types";
import {
  activeEmployees,
  dayTotals,
  shiftFor,
  weekDays,
} from "@/lib/selectors";
import {
  accentOf,
  addDays,
  dayName,
  dayNum,
  formatHours,
  formatMoney,
  formatRange,
  formatTimeShort,
  isToday,
  monthShort,
  shiftHours,
} from "@/lib/utils";

const ROLE_ABBR: Record<Role, string> = {
  Kitchen: "KIT",
  "Front of House": "FOH",
  Cashier: "CSH",
  Driver: "DRV",
  Manager: "MGR",
};

type Editing = { employee: Employee; date: string; shift?: Shift };

export default function SchedulePage() {
  const { data, copyShifts, removeShift, setScheduleStatus } = useStore();
  const schedule = data.schedules[0];

  const [weekIndex, setWeekIndex] = useState(0);
  const [location, setLocation] = useState<LocationName | "All">("All");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const weekStart = addDays(schedule.startDate, weekIndex * 7);
  const days = useMemo(() => weekDays(weekStart), [weekStart]);

  const employees = useMemo(
    () =>
      activeEmployees(data)
        .filter((e) => location === "All" || e.location === location)
        .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name)),
    [data, location]
  );

  const loc = location === "All" ? undefined : location;
  const dayCols = days.map((d) => dayTotals(data, d, loc));
  const weekHours = dayCols.reduce((s, d) => s + d.hours, 0);
  const weekCost = dayCols.reduce((s, d) => s + d.cost, 0);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const handleCopy = () => {
    const src = schedule.startDate; // week 1
    const dst = addDays(schedule.startDate, 7); // week 2
    // Clear existing week-2 shifts (within current location filter) first.
    const dstDays = weekDays(dst);
    data.shifts
      .filter(
        (s) => dstDays.includes(s.date) && (!loc || s.location === loc)
      )
      .forEach((s) => removeShift(s.id));
    // Copy week-1 shifts forward 7 days.
    const srcDays = weekDays(src);
    const toCopy = data.shifts
      .filter((s) => srcDays.includes(s.date) && (!loc || s.location === loc))
      .map((s) => ({
        employeeId: s.employeeId,
        date: addDays(s.date, 7),
        startTime: s.startTime,
        endTime: s.endTime,
        role: s.role,
        location: s.location,
        breakMinutes: s.breakMinutes,
        notes: s.notes,
      }));
    copyShifts(toCopy);
    setWeekIndex(1);
    flash(`Copied ${toCopy.length} shifts into Week 2`);
  };

  const togglePublish = () => {
    const next = schedule.status === "published" ? "draft" : "published";
    setScheduleStatus(schedule.id, next);
    flash(next === "published" ? "Schedule published — team can see it" : "Moved back to draft");
  };

  // Grid template: name | 7 days | total
  const gridCols = "150px repeat(7, minmax(94px, 1fr)) 104px";

  return (
    <div className="px-4 py-6 sm:px-8">
      {/* Toolbar */}
      <header className="rise mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
              Schedule
            </h1>
            <Badge tone={schedule.status === "published" ? "herb" : "saffron"}>
              {schedule.status}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            Fortnight of {formatRange(schedule.startDate, schedule.endDate)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <LocationTabs value={location} onChange={setLocation} />
          <Button variant="outline" size="sm" onClick={handleCopy}>
            <IconCopy width={15} height={15} /> Copy wk 1 → 2
          </Button>
          <Button
            size="sm"
            variant={schedule.status === "published" ? "secondary" : "primary"}
            onClick={togglePublish}
          >
            {schedule.status === "published" ? (
              <>
                <IconCheck width={15} height={15} /> Published
              </>
            ) : (
              <>
                <IconSend width={15} height={15} /> Publish
              </>
            )}
          </Button>
        </div>
      </header>

      {/* Week switcher */}
      <div className="rise mb-3 flex items-center justify-between" style={{ animationDelay: "60ms" }}>
        <div className="inline-flex rounded-[11px] border border-line bg-surface p-1 shadow-soft">
          {[0, 1].map((w) => (
            <button
              key={w}
              onClick={() => setWeekIndex(w)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                weekIndex === w ? "bg-ember text-white" : "text-ink-soft hover:text-ink"
              }`}
            >
              Week {w + 1}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setWeekIndex((w) => Math.max(0, w - 1))}
            disabled={weekIndex === 0}
            className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface text-ink-soft transition hover:text-ink disabled:opacity-40"
          >
            <IconChevronLeft width={18} height={18} />
          </button>
          <span className="px-2 text-sm font-medium text-ink">
            {formatRange(weekStart, addDays(weekStart, 6))}
          </span>
          <button
            onClick={() => setWeekIndex((w) => Math.min(1, w + 1))}
            disabled={weekIndex === 1}
            className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface text-ink-soft transition hover:text-ink disabled:opacity-40"
          >
            <IconChevronRight width={18} height={18} />
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="rise overflow-x-auto rounded-card border border-line bg-surface shadow-soft" style={{ animationDelay: "100ms" }}>
        <div className="min-w-[760px]">
          {/* Header */}
          <div className="grid border-b border-line bg-surface-2" style={{ gridTemplateColumns: gridCols }}>
            <div className="sticky left-0 z-10 bg-surface-2 px-4 py-3 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
              Team
            </div>
            {days.map((d) => (
              <div
                key={d}
                className={`border-l border-line px-2 py-2.5 text-center ${
                  isToday(d) ? "bg-ember-soft/60" : ""
                }`}
              >
                <p className={`text-[12px] font-semibold uppercase tracking-wide ${isToday(d) ? "text-ember-deep" : "text-ink-faint"}`}>
                  {dayName(d)}
                </p>
                <p className={`nums text-sm font-semibold ${isToday(d) ? "text-ember-deep" : "text-ink"}`}>
                  {dayNum(d)} {monthShort(d)}
                </p>
              </div>
            ))}
            <div className="border-l border-line px-2 py-2.5 text-center text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
              Total
            </div>
          </div>

          {/* Employee rows */}
          {employees.map((emp) => {
            let empHours = 0;
            const cells = days.map((d) => {
              const shift = shiftFor(data, emp.id, d);
              if (shift && (!loc || shift.location === loc)) empHours += shiftHours(shift);
              return { d, shift: shift && (!loc || shift.location === loc) ? shift : undefined };
            });
            const a = accentOf(emp.accent);
            return (
              <div
                key={emp.id}
                className="grid border-b border-line last:border-0 hover:bg-surface-2/40"
                style={{ gridTemplateColumns: gridCols }}
              >
                <div className="sticky left-0 z-10 flex items-center gap-2 bg-surface px-3 py-2.5">
                  <span
                    className="h-7 w-1 shrink-0 rounded-full"
                    style={{ backgroundColor: a.dot }}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-ink">{emp.name}</p>
                    <p className="truncate text-[11px] text-ink-faint">
                      {ROLE_ABBR[emp.role]} · ${emp.hourlyRate}/hr
                    </p>
                  </div>
                </div>
                {cells.map(({ d, shift }) => (
                  <button
                    key={d}
                    onClick={() => setEditing({ employee: emp, date: d, shift })}
                    className={`group relative min-h-[58px] border-l border-line px-1.5 py-1.5 text-left transition ${
                      isToday(d) ? "bg-ember-soft/20" : ""
                    } hover:bg-paper-deep/50`}
                  >
                    {shift ? (
                      <span
                        className="block h-full rounded-lg px-2 py-1.5"
                        style={{ backgroundColor: a.bg, border: `1px solid ${a.border}` }}
                      >
                        <span className="nums block text-[12px] font-bold leading-tight" style={{ color: a.text }}>
                          {formatTimeShort(shift.startTime)}–{formatTimeShort(shift.endTime)}
                        </span>
                        <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide opacity-70" style={{ color: a.text }}>
                          {ROLE_ABBR[shift.role]}
                        </span>
                      </span>
                    ) : (
                      <span className="flex h-full min-h-[40px] items-center justify-center text-line-strong opacity-0 transition group-hover:opacity-100">
                        <IconPlus width={16} height={16} />
                      </span>
                    )}
                  </button>
                ))}
                <div className="flex flex-col items-center justify-center border-l border-line px-1 py-2">
                  <span className="nums text-sm font-bold text-ink">{formatHours(empHours)}</span>
                  <span className="nums text-[11px] text-ink-faint">
                    {formatMoney(empHours * emp.hourlyRate)}
                  </span>
                </div>
              </div>
            );
          })}

          {employees.length === 0 && (
            <div className="px-4 py-12 text-center text-sm text-ink-faint">
              No team members at this location.
            </div>
          )}

          {/* Footer totals */}
          <div className="grid border-t-2 border-line-strong bg-surface-2" style={{ gridTemplateColumns: gridCols }}>
            <div className="sticky left-0 z-10 bg-surface-2 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wider text-ink-soft">
              Daily total
            </div>
            {dayCols.map((d) => (
              <div key={d.date} className="border-l border-line px-1 py-2 text-center">
                <p className="nums text-[13px] font-bold text-ink">{formatHours(d.hours)}</p>
                <p className="nums text-[11px] text-ink-faint">{formatMoney(d.cost)}</p>
              </div>
            ))}
            <div className="border-l border-line px-1 py-2 text-center">
              <p className="nums text-sm font-bold text-ember-deep">{formatHours(weekHours)}</p>
              <p className="nums text-[11px] font-semibold text-ink-soft">{formatMoney(weekCost)}</p>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-3 text-center text-[13px] text-ink-faint">
        Tap any cell to add or edit a shift · Week {weekIndex + 1} total{" "}
        <span className="font-semibold text-ink-soft">
          {formatHours(weekHours)} · {formatMoney(weekCost)}
        </span>
      </p>

      {editing && (
        <ShiftModal
          open
          onClose={() => setEditing(null)}
          employee={editing.employee}
          date={editing.date}
          shift={editing.shift}
        />
      )}

      {toast && (
        <div className="pop-in fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-charcoal px-5 py-2.5 text-sm font-medium text-paper shadow-pop">
          {toast}
        </div>
      )}
    </div>
  );
}

function LocationTabs({
  value,
  onChange,
}: {
  value: LocationName | "All";
  onChange: (v: LocationName | "All") => void;
}) {
  const opts: (LocationName | "All")[] = ["All", ...LOCATIONS];
  return (
    <div className="inline-flex rounded-[11px] border border-line bg-surface p-1 shadow-soft">
      {opts.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
            value === o ? "bg-charcoal text-paper" : "text-ink-soft hover:text-ink"
          }`}
        >
          {o === "All" ? "All stores" : o}
        </button>
      ))}
    </div>
  );
}
