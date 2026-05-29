"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { Avatar, Card, StatCard } from "@/components/ui";
import { IconClock, IconReceipt, IconUsers, IconChart } from "@/components/icons";
import { LOCATIONS, type LocationName } from "@/lib/types";
import {
  dayTotals,
  employeeSummaries,
  fortnightDays,
  rangeTotals,
} from "@/lib/selectors";
import {
  addDays,
  dayName,
  dayNum,
  formatHours,
  formatMoney,
  formatRange,
  isToday,
} from "@/lib/utils";

export default function CostsPage() {
  const { data } = useStore();
  const schedule = data.schedules[0];
  const [location, setLocation] = useState<LocationName | "All">("All");
  const loc = location === "All" ? undefined : location;

  const totals = rangeTotals(data, schedule.startDate, schedule.endDate, loc);
  const days = useMemo(() => fortnightDays(schedule.startDate), [schedule.startDate]);
  const dayData = days.map((d) => dayTotals(data, d, loc));
  const maxDay = Math.max(1, ...dayData.map((d) => d.cost));

  const summaries = employeeSummaries(
    data,
    schedule.startDate,
    schedule.endDate,
    loc
  ).filter((s) => s.hours > 0);
  const maxEmp = Math.max(1, ...summaries.map((s) => s.cost));

  const week1 = rangeTotals(data, schedule.startDate, addDays(schedule.startDate, 6), loc);
  const week2 = rangeTotals(data, addDays(schedule.startDate, 7), schedule.endDate, loc);

  return (
    <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
            Labour cost
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            Fortnight of {formatRange(schedule.startDate, schedule.endDate)}
          </p>
        </div>
        <div className="inline-flex rounded-[11px] border border-line bg-surface p-1 shadow-soft">
          {(["All", ...LOCATIONS] as const).map((o) => (
            <button
              key={o}
              onClick={() => setLocation(o)}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
                location === o ? "bg-charcoal text-paper" : "text-ink-soft hover:text-ink"
              }`}
            >
              {o === "All" ? "All stores" : o}
            </button>
          ))}
        </div>
      </header>

      <div className="rise mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4" style={{ animationDelay: "60ms" }}>
        <StatCard
          label="Fortnight cost"
          value={formatMoney(totals.cost)}
          sub={`${totals.shifts} shifts`}
          accent="ember"
          icon={<IconReceipt width={18} height={18} />}
        />
        <StatCard
          label="Total hours"
          value={formatHours(totals.hours)}
          sub={`avg ${formatMoney(totals.hours ? totals.cost / totals.hours : 0)}/hr`}
          accent="herb"
          icon={<IconClock width={18} height={18} />}
        />
        <StatCard
          label="Week 1 vs 2"
          value={formatMoney(week1.cost)}
          sub={`then ${formatMoney(week2.cost)}`}
          accent="saffron"
          icon={<IconChart width={18} height={18} />}
        />
        <StatCard
          label="Rostered staff"
          value={summaries.length}
          sub="with shifts this fortnight"
          accent="clay"
          icon={<IconUsers width={18} height={18} />}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
        {/* Cost by day */}
        <Card className="rise p-5">
          <h2 className="font-display text-lg font-semibold text-ink">Cost by day</h2>
          <p className="text-[13px] text-ink-faint">Two weeks, Monday to Sunday</p>
          <div className="mt-5 flex items-end gap-1.5" style={{ height: 180 }}>
            {dayData.map((d, i) => {
              const h = d.cost === 0 ? 2 : Math.max(6, (d.cost / maxDay) * 160);
              const newWeek = i === 7;
              return (
                <div
                  key={d.date}
                  className={`group flex flex-1 flex-col items-center justify-end ${
                    newWeek ? "ml-2 border-l border-dashed border-line pl-2" : ""
                  }`}
                  title={`${dayName(d.date)} ${dayNum(d.date)} · ${formatMoney(d.cost)}`}
                >
                  <span className="nums mb-1 text-[10px] font-semibold text-ink-soft opacity-0 transition group-hover:opacity-100">
                    {formatMoney(d.cost)}
                  </span>
                  <div
                    className="w-full rounded-t-md transition-all"
                    style={{
                      height: h,
                      background: isToday(d.date)
                        ? "linear-gradient(180deg,#ee7a3c,#d75321)"
                        : "linear-gradient(180deg,#e7c0ab,#d99a7f)",
                    }}
                  />
                  <span className="nums mt-1.5 text-[10px] text-ink-faint">{dayNum(d.date)}</span>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Cost by employee */}
        <Card className="rise overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-display text-lg font-semibold text-ink">Cost by team member</h2>
            <p className="text-[13px] text-ink-faint">Highest to lowest this fortnight</p>
          </div>
          <ul className="divide-y divide-line">
            {summaries.map((s) => (
              <li key={s.employee.id} className="flex items-center gap-3 px-5 py-3">
                <Avatar name={s.employee.name} accent={s.employee.accent} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-ink">{s.employee.name}</p>
                    <p className="nums text-sm font-bold text-ink">{formatMoney(s.cost)}</p>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper-deep">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(s.cost / maxEmp) * 100}%`,
                        backgroundColor: "#d75321",
                      }}
                    />
                  </div>
                  <p className="nums mt-1 text-[12px] text-ink-faint">
                    {formatHours(s.hours)} · ${s.employee.hourlyRate}/hr · {s.shifts} shifts
                  </p>
                </div>
              </li>
            ))}
            {summaries.length === 0 && (
              <li className="px-5 py-10 text-center text-sm text-ink-faint">
                No shifts at this location yet.
              </li>
            )}
          </ul>
        </Card>
      </div>
    </div>
  );
}
