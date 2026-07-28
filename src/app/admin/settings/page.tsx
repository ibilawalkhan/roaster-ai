"use client";

import { useState } from "react";
import { cx } from "@/components/ui";
import { BusinessTab } from "@/components/settings/BusinessTab";
import { LocationsTab } from "@/components/settings/LocationsTab";
import { TradingHoursTab } from "@/components/settings/TradingHoursTab";
import { RolesTab } from "@/components/settings/RolesTab";
import { RulesTab } from "@/components/settings/RulesTab";
import { BreaksTab } from "@/components/settings/BreaksTab";

/**
 * Module 1 §4.2 — the ongoing Settings screens.
 *
 * The first-run setup wizard (§4.1) is a separate, later screen. The seam is
 * deliberate: every tab below is a self-contained component that loads its own
 * data and validates through src/lib/domain/settings-validation.ts, so the
 * wizard can render the same components in sequence without any of this logic
 * being copied. Nothing here assumes it is the only way in.
 */

const TABS = [
  { key: "business", label: "Business", blurb: "Name, week start and roster period" },
  { key: "locations", label: "Locations", blurb: "The sites you roster" },
  { key: "trading", label: "Trading hours", blurb: "When you're open" },
  { key: "roles", label: "Roles", blurb: "The jobs your team does" },
  { key: "rules", label: "Rules", blurb: "What every roster must obey" },
  { key: "breaks", label: "Breaks", blurb: "Unpaid break by shift length" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function SettingsPage() {
  const [tab, setTab] = useState<TabKey>("business");
  const current = TABS.find((t) => t.key === tab) ?? TABS[0];

  return (
    <div className="mx-auto max-w-5xl px-5 py-7 sm:px-8">
      <header className="rise">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Settings</h1>
        <p className="mt-1 text-sm text-ink-soft">
          How your restaurant runs. Everything here feeds the roster — set it once, adjust when
          things change.
        </p>
      </header>

      <div
        className="rise mt-5 overflow-x-auto"
        style={{ animationDelay: "60ms" }}
      >
        <div
          role="tablist"
          aria-label="Settings sections"
          className="inline-flex min-w-full gap-1 rounded-[13px] border border-line bg-surface p-1 shadow-soft sm:min-w-0"
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls={`panel-${t.key}`}
              onClick={() => setTab(t.key)}
              className={cx(
                "min-h-11 whitespace-nowrap rounded-lg px-4 text-[13px] font-medium transition",
                tab === t.key
                  ? "bg-charcoal text-paper"
                  : "text-ink-soft hover:bg-paper-deep hover:text-ink",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-3 text-[13px] text-ink-faint">{current.blurb}</p>

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className="rise mt-4"
        style={{ animationDelay: "100ms" }}
      >
        {tab === "business" && <BusinessTab />}
        {tab === "locations" && <LocationsTab />}
        {tab === "trading" && <TradingHoursTab />}
        {tab === "roles" && <RolesTab />}
        {tab === "rules" && <RulesTab />}
        {tab === "breaks" && <BreaksTab />}
      </div>
    </div>
  );
}
