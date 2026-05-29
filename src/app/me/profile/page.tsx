"use client";

import { useStore } from "@/lib/store";
import { Avatar, Badge, Card } from "@/components/ui";
import { IconMail, IconPhone, IconPin } from "@/components/icons";
import { employeeById, hoursInRange, shiftsForEmployee } from "@/lib/selectors";
import { formatHours, formatMoney } from "@/lib/utils";

export default function MyProfile() {
  const { data, session } = useStore();
  const me = employeeById(data, session.employeeId);
  const schedule = data.schedules[0];

  if (!me) return null;

  const hours = hoursInRange(data, me.id, schedule.startDate, schedule.endDate);
  const shiftCount = shiftsForEmployee(data, me.id).filter(
    (s) => s.date >= schedule.startDate && s.date <= schedule.endDate
  ).length;

  return (
    <div className="px-4 py-5">
      <Card className="rise overflow-hidden">
        <div className="flex flex-col items-center px-6 py-7 text-center">
          <Avatar name={me.name} accent={me.accent} size={76} />
          <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-ink">
            {me.name}
          </h1>
          <div className="mt-2 flex items-center gap-2">
            <Badge tone="ember">{me.role}</Badge>
            <span className="text-[13px] capitalize text-ink-soft">
              {me.employmentType}
            </span>
          </div>
        </div>

        {/* Pay rate */}
        <div className="mx-6 mb-5 flex items-center justify-between rounded-xl bg-charcoal px-5 py-4 text-paper">
          <div>
            <p className="text-[12px] uppercase tracking-wider text-paper/55">Your pay rate</p>
            <p className="nums font-display text-2xl font-semibold">
              {formatMoney(me.hourlyRate, true)}
              <span className="text-base font-normal text-paper/60"> / hour</span>
            </p>
          </div>
          <span className="grid h-12 w-12 place-items-center rounded-full bg-ember/20 text-ember-glow font-display text-xl font-semibold">
            ${me.hourlyRate}
          </span>
        </div>
      </Card>

      {/* Fortnight summary */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <MiniStat label="Hours" value={formatHours(hours)} />
        <MiniStat label="Shifts" value={String(shiftCount)} />
        <MiniStat label="Est. pay" value={formatMoney(hours * me.hourlyRate)} />
      </div>

      {/* Contact */}
      <Card className="mt-4 p-1">
        <ContactRow icon={<IconPhone width={18} height={18} />} label="Phone" value={me.phone || "—"} />
        <ContactRow icon={<IconMail width={18} height={18} />} label="Email" value={me.email || "—"} />
        <ContactRow icon={<IconPin width={18} height={18} />} label="Home store" value={me.location} last />
      </Card>

      <p className="mt-5 px-2 text-center text-[12px] text-ink-faint">
        Need a change to your details? Speak to your manager.
      </p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3 text-center shadow-soft">
      <p className="nums font-display text-xl font-semibold text-ink">{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</p>
    </div>
  );
}

function ContactRow({
  icon,
  label,
  value,
  last,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3.5 ${last ? "" : "border-b border-line"}`}
    >
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-2 text-ink-soft">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] uppercase tracking-wide text-ink-faint">{label}</p>
        <p className="truncate text-sm font-medium text-ink">{value}</p>
      </div>
    </div>
  );
}
