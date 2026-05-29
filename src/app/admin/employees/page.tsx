"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { EmployeeModal } from "@/components/EmployeeModal";
import { Avatar, Badge, Button, Card } from "@/components/ui";
import { IconEdit, IconMail, IconPhone, IconPlus } from "@/components/icons";
import { LOCATIONS, type Employee, type LocationName } from "@/lib/types";
import { hoursInRange } from "@/lib/selectors";
import { formatHours, formatMoney } from "@/lib/utils";

export default function EmployeesPage() {
  const { data, setEmployeeActive } = useStore();
  const schedule = data.schedules[0];

  const [filter, setFilter] = useState<LocationName | "All">("All");
  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal] = useState<{ employee?: Employee } | null>(null);

  const list = useMemo(
    () =>
      data.employees
        .filter((e) => (showInactive ? true : e.isActive))
        .filter((e) => filter === "All" || e.location === filter)
        .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name)),
    [data.employees, filter, showInactive]
  );

  const activeCount = data.employees.filter((e) => e.isActive).length;

  return (
    <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Team</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {activeCount} active across {LOCATIONS.length} locations
          </p>
        </div>
        <Button onClick={() => setModal({})}>
          <IconPlus width={16} height={16} /> Add member
        </Button>
      </header>

      <div className="rise mt-5 flex flex-wrap items-center gap-2" style={{ animationDelay: "60ms" }}>
        <div className="inline-flex rounded-[11px] border border-line bg-surface p-1 shadow-soft">
          {(["All", ...LOCATIONS] as const).map((o) => (
            <button
              key={o}
              onClick={() => setFilter(o)}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
                filter === o ? "bg-charcoal text-paper" : "text-ink-soft hover:text-ink"
              }`}
            >
              {o === "All" ? "All stores" : o}
            </button>
          ))}
        </div>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-ember)]"
          />
          Show inactive
        </label>
      </div>

      <div className="rise mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3" style={{ animationDelay: "100ms" }}>
        {list.map((emp) => {
          const hours = hoursInRange(data, emp.id, schedule.startDate, schedule.endDate);
          const cost = hours * emp.hourlyRate;
          return (
            <Card
              key={emp.id}
              className={`p-5 transition ${emp.isActive ? "" : "opacity-60"}`}
            >
              <div className="flex items-start gap-3">
                <Avatar name={emp.name} accent={emp.accent} size={48} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-lg font-semibold leading-tight text-ink">
                    {emp.name}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone="neutral">{emp.role}</Badge>
                    <span className="text-[12px] capitalize text-ink-faint">
                      {emp.employmentType}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setModal({ employee: emp })}
                  className="grid h-8 w-8 place-items-center rounded-lg text-ink-faint transition hover:bg-paper-deep hover:text-ink"
                  aria-label="Edit"
                >
                  <IconEdit width={17} height={17} />
                </button>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-surface-2 p-3 text-center">
                <Metric label="Rate" value={`$${emp.hourlyRate}`} />
                <Metric label="Fortnight" value={formatHours(hours)} />
                <Metric label="Est. pay" value={formatMoney(cost)} />
              </div>

              <div className="mt-3 space-y-1 text-[13px] text-ink-soft">
                <p className="flex items-center gap-2">
                  <IconPhone width={14} height={14} className="text-ink-faint" />
                  {emp.phone || "—"}
                </p>
                <p className="flex items-center gap-2 truncate">
                  <IconMail width={14} height={14} className="text-ink-faint" />
                  <span className="truncate">{emp.email || "—"}</span>
                </p>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                <span className="text-[12px] font-medium text-ink-faint">{emp.location}</span>
                {emp.isActive ? (
                  <button
                    onClick={() => setEmployeeActive(emp.id, false)}
                    className="text-[13px] font-medium text-clay hover:underline"
                  >
                    Deactivate
                  </button>
                ) : (
                  <button
                    onClick={() => setEmployeeActive(emp.id, true)}
                    className="text-[13px] font-medium text-herb hover:underline"
                  >
                    Reactivate
                  </button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {list.length === 0 && (
        <p className="mt-10 text-center text-sm text-ink-faint">No team members to show.</p>
      )}

      {modal && (
        <EmployeeModal open onClose={() => setModal(null)} employee={modal.employee} />
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="nums text-sm font-bold text-ink">{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</p>
    </div>
  );
}
