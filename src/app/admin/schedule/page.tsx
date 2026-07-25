"use client";

import { Card } from "@/components/ui";
import { IconCalendar } from "@/components/icons";

export default function SchedulePage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      <Card className="p-10 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-ember-soft text-ember-deep">
          <IconCalendar width={26} height={26} />
        </span>
        <h1 className="mt-4 font-display text-2xl font-semibold text-ink">Roster &amp; scheduling</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-soft">
          The week template, auto-scheduler and draft review are being rebuilt (Modules 4–6). This
          screen returns with the OR-Tools-powered roster generator.
        </p>
      </Card>
    </div>
  );
}
