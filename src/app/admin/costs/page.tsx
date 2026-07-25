"use client";

import { Card } from "@/components/ui";
import { IconChart } from "@/components/icons";

export default function CostsPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      <Card className="p-10 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-herb-soft text-herb">
          <IconChart width={26} height={26} />
        </span>
        <h1 className="mt-4 font-display text-2xl font-semibold text-ink">Labour cost</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-soft">
          Cost reporting is derived from rostered shifts, so it returns with the roster module
          (M5/M10) — with the estimate-not-payroll disclaimer on every figure.
        </p>
      </Card>
    </div>
  );
}
