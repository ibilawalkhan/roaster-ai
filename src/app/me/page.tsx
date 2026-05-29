"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Card, Modal } from "@/components/ui";
import { IconCalendar, IconCheck, IconClock, IconPin } from "@/components/icons";
import type { Shift } from "@/lib/types";
import { employeeById, hoursInRange, upcomingShifts } from "@/lib/selectors";
import {
  accentOf,
  dayName,
  dayNum,
  formatDayLong,
  formatHours,
  formatMoney,
  formatTime,
  isToday,
  monthShort,
  shiftHours,
} from "@/lib/utils";

export default function MySchedule() {
  const { data, session } = useStore();
  const me = employeeById(data, session.employeeId);
  const schedule = data.schedules[0];
  const [detail, setDetail] = useState<Shift | null>(null);

  if (!me) return null;

  const hours = hoursInRange(data, me.id, schedule.startDate, schedule.endDate);
  const pay = hours * me.hourlyRate;
  const upcoming = upcomingShifts(data, me.id).filter((s) => s.date <= schedule.endDate);
  const [next, ...rest] = upcoming;
  const a = accentOf(me.accent);
  const published = schedule.status === "published";

  return (
    <div className="px-4 py-5">
      {/* Status banner */}
      <div
        className={`mb-4 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-[13px] font-medium ${
          published
            ? "bg-herb-soft text-herb"
            : "bg-saffron-soft text-[#8a6212]"
        }`}
      >
        <IconCheck width={16} height={16} />
        {published
          ? "Your roster is published and confirmed."
          : "Draft roster — times may still change."}
      </div>

      {/* Fortnight summary */}
      <Card className="rise mb-5 overflow-hidden p-5">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
          This fortnight
        </p>
        <div className="mt-2 flex items-end justify-between">
          <div>
            <p className="nums font-display text-4xl font-semibold leading-none text-ink">
              {formatHours(hours)}
            </p>
            <p className="mt-1 text-sm text-ink-soft">{upcoming.length} shifts ahead</p>
          </div>
          <div className="text-right">
            <p className="nums font-display text-2xl font-semibold text-ember">
              {formatMoney(pay)}
            </p>
            <p className="text-[12px] text-ink-faint">est. at ${me.hourlyRate}/hr</p>
          </div>
        </div>
      </Card>

      {/* Next shift hero */}
      {next ? (
        <>
          <SectionLabel>Next shift</SectionLabel>
          <button
            onClick={() => setDetail(next)}
            className="rise mb-6 block w-full overflow-hidden rounded-card text-left shadow-soft"
            style={{ backgroundColor: a.bg, border: `1px solid ${a.border}` }}
          >
            <div className="flex items-stretch">
              <div
                className="flex w-20 shrink-0 flex-col items-center justify-center py-5"
                style={{ backgroundColor: a.dot, color: "#fff" }}
              >
                <span className="text-[12px] font-semibold uppercase tracking-wide opacity-90">
                  {dayName(next.date)}
                </span>
                <span className="nums font-display text-3xl font-semibold leading-none">
                  {dayNum(next.date)}
                </span>
                <span className="text-[12px] opacity-90">{monthShort(next.date)}</span>
              </div>
              <div className="flex-1 px-4 py-4" style={{ color: a.text }}>
                {isToday(next.date) && (
                  <span className="mb-1.5 inline-block rounded-full bg-white/60 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide">
                    Today
                  </span>
                )}
                <p className="nums font-display text-xl font-semibold leading-tight">
                  {formatTime(next.startTime)} – {formatTime(next.endTime)}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-sm font-medium opacity-80">
                  {next.role}
                  <span>·</span>
                  <IconPin width={14} height={14} />
                  {next.location}
                </p>
                <p className="mt-1 text-[13px] font-medium opacity-70">
                  {formatHours(shiftHours(next))} paid
                </p>
              </div>
            </div>
          </button>
        </>
      ) : (
        <Card className="mb-6 p-8 text-center">
          <IconCalendar width={28} height={28} className="mx-auto text-ink-faint" />
          <p className="mt-2 text-sm text-ink-soft">No upcoming shifts scheduled.</p>
        </Card>
      )}

      {/* Rest of upcoming */}
      {rest.length > 0 && (
        <>
          <SectionLabel>Coming up</SectionLabel>
          <ul className="space-y-2.5">
            {rest.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => setDetail(s)}
                  className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-3 text-left shadow-soft transition hover:border-line-strong"
                >
                  <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-surface-2">
                    <span className="text-[10px] font-semibold uppercase text-ink-faint">
                      {dayName(s.date)}
                    </span>
                    <span className="nums text-lg font-bold leading-none text-ink">
                      {dayNum(s.date)}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="nums text-sm font-semibold text-ink">
                      {formatTime(s.startTime)} – {formatTime(s.endTime)}
                    </p>
                    <p className="flex items-center gap-1 text-[13px] text-ink-soft">
                      {s.role} <span className="text-line-strong">·</span> {s.location}
                    </p>
                  </div>
                  <span className="nums text-[13px] font-semibold text-ink-faint">
                    {formatHours(shiftHours(s))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Shift detail */}
      {detail && (
        <Modal
          open
          onClose={() => setDetail(null)}
          title={formatDayLong(detail.date)}
          subtitle={`${formatTime(detail.startTime)} – ${formatTime(detail.endTime)}`}
        >
          <div className="space-y-3">
            <DetailRow icon={<IconClock width={18} height={18} />} label="Paid hours" value={formatHours(shiftHours(detail))} />
            <DetailRow icon={<IconCalendar width={18} height={18} />} label="Role" value={detail.role} />
            <DetailRow icon={<IconPin width={18} height={18} />} label="Location" value={detail.location} />
            <DetailRow
              icon={<IconClock width={18} height={18} />}
              label="Unpaid break"
              value={detail.breakMinutes ? `${detail.breakMinutes} min` : "None"}
            />
            {detail.notes && (
              <div className="rounded-xl bg-surface-2 p-3 text-sm text-ink-soft">
                <span className="font-medium text-ink">Note: </span>
                {detail.notes}
              </div>
            )}
            <div className="flex items-center justify-between rounded-xl bg-ember-soft px-3.5 py-3">
              <span className="text-sm font-medium text-ember-deep">Estimated pay</span>
              <span className="nums font-display text-lg font-semibold text-ember-deep">
                {formatMoney(shiftHours(detail) * me.hourlyRate)}
              </span>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2.5 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
      {children}
    </p>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-line pb-3">
      <span className="flex items-center gap-2.5 text-sm text-ink-soft">
        <span className="text-ink-faint">{icon}</span>
        {label}
      </span>
      <span className="text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}
