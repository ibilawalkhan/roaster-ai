"use client";

import { Card } from "@/components/ui";
import { IconCalendar } from "@/components/icons";

export default function MyShifts() {
  return (
    <div className="px-4 py-6">
      <Card className="p-8 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-ember-soft text-ember-deep">
          <IconCalendar width={26} height={26} />
        </span>
        <h1 className="mt-4 font-display text-xl font-semibold text-ink">No shifts yet</h1>
        <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-soft">
          Your manager hasn&rsquo;t published a roster yet. When they do, your next shift shows up
          right here. Meanwhile, keep your details up to date on the Profile tab.
        </p>
      </Card>
    </div>
  );
}
