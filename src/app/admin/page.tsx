"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";
import { Avatar, Badge, Button, Card, StatCard } from "@/components/ui";
import {
  IconArrowRight,
  IconCalendar,
  IconClock,
  IconPin,
  IconReceipt,
  IconUsers,
} from "@/components/icons";
import {
  dayTotals,
  employeeById,
  rangeTotals,
  shiftsOn,
  weekDays,
} from "@/lib/selectors";
import {
  addDays,
  dayName,
  formatDayLong,
  formatHours,
  formatMoney,
  formatRange,
  formatTime,
  shiftHours,
  todayISO,
} from "@/lib/utils";

export default function AdminDashboard() {
  const { data } = useStore();
  const today = todayISO();
  const schedule = data.schedules[0];

  const td = dayTotals(data, today);
  const fortnight = rangeTotals(data, schedule.startDate, schedule.endDate);

  const todayShifts = shiftsOn(data, today).sort((a, b) =>
    a.startTime.localeCompare(b.startTime)
  );

  const week = weekDays(schedule.startDate <= today ? currentWeekStart(schedule.startDate, today) : schedule.startDate);
  const weekData = week.map((d) => dayTotals(data, d));
  const maxCost = Math.max(1, ...weekData.map((d) => d.cost));

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ember">{formatDayLong(today)}</p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink">
            {greeting}, Khaled
          </h1>
        </div>
        <Link href="/admin/schedule">
          <Button>
            Open schedule <IconArrowRight width={16} height={16} />
          </Button>
        </Link>
      </header>

      {/* Stats */}
      <div className="rise mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4" style={{ animationDelay: "60ms" }}>
        <StatCard
          label="On today"
          value={td.staff}
          sub={`${formatHours(td.hours)} scheduled`}
          accent="ember"
          icon={<IconUsers width={18} height={18} />}
        />
        <StatCard
          label="Today's cost"
          value={formatMoney(td.cost)}
          sub="across both stores"
          accent="clay"
          icon={<IconReceipt width={18} height={18} />}
        />
        <StatCard
          label="Fortnight cost"
          value={formatMoney(fortnight.cost)}
          sub={formatRange(schedule.startDate, schedule.endDate)}
          accent="herb"
          icon={<IconCalendar width={18} height={18} />}
        />
        <StatCard
          label="Fortnight hours"
          value={formatHours(fortnight.hours)}
          sub={`${fortnight.shifts} shifts`}
          accent="saffron"
          icon={<IconClock width={18} height={18} />}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Today's roster */}
        <Card className="rise overflow-hidden" >
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="font-display text-lg font-semibold text-ink">
              Today&rsquo;s roster
            </h2>
            <Badge tone="ember">{todayShifts.length} on shift</Badge>
          </div>
          {todayShifts.length === 0 ? (
            <Empty>No one is rostered today.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {todayShifts.map((s) => {
                const emp = employeeById(data, s.employeeId);
                if (!emp) return null;
                return (
                  <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                    <Avatar name={emp.name} accent={emp.accent} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{emp.name}</p>
                      <p className="flex items-center gap-1.5 text-[13px] text-ink-soft">
                        {s.role}
                        <span className="text-line-strong">·</span>
                        <IconPin width={13} height={13} className="text-ink-faint" />
                        {s.location}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="nums text-sm font-semibold text-ink">
                        {formatTime(s.startTime)} – {formatTime(s.endTime)}
                      </p>
                      <p className="nums text-[13px] text-ink-faint">
                        {formatHours(shiftHours(s))}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* This week cost bars */}
        <Card className="rise p-5" >
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-ink">This week</h2>
            <span className="text-[13px] text-ink-faint">labour cost / day</span>
          </div>
          <div className="mt-5 space-y-2.5">
            {weekData.map((d) => {
              const isToday = d.date === today;
              return (
                <div key={d.date} className="flex items-center gap-3">
                  <span
                    className={`w-9 text-[13px] font-medium ${isToday ? "text-ember" : "text-ink-soft"}`}
                  >
                    {dayShort(d.date)}
                  </span>
                  <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-paper-deep">
                    <div
                      className="absolute inset-y-0 left-0 rounded-lg transition-all"
                      style={{
                        width: `${(d.cost / maxCost) * 100}%`,
                        backgroundColor: isToday ? "#d75321" : "#e0a9883d",
                        backgroundImage: isToday
                          ? "none"
                          : "linear-gradient(90deg,#e7c0ab,#dba98f)",
                      }}
                    />
                    <span className="nums absolute right-2 top-1/2 -translate-y-1/2 text-[12px] font-semibold text-ink/80">
                      {formatMoney(d.cost)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <Link
            href="/admin/costs"
            className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-ember hover:gap-2.5 transition-all"
          >
            Full cost breakdown <IconArrowRight width={15} height={15} />
          </Link>
        </Card>
      </div>
    </div>
  );
}

function currentWeekStart(scheduleStart: string, today: string): string {
  // If today falls in week 2 of the fortnight, show week 2; else week 1.
  const wk2 = addDays(scheduleStart, 7);
  return today >= wk2 ? wk2 : scheduleStart;
}

function dayShort(iso: string): string {
  return dayName(iso);
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-5 py-12 text-center text-sm text-ink-faint">{children}</div>
  );
}
