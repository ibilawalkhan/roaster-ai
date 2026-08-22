"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Button, Input, Select } from "@/components/ui";
import { SavedNote, SectionCard, SettingRow, WriteError } from "./shared";
import { DAY_NAMES } from "@/lib/domain/settings-validation";
import { updateBusinessProfile } from "@/lib/supabase/settings";
import type { RosterPeriod } from "@/lib/types";

/** M1 §3.1 — the handful of facts every other screen reads. */
export function BusinessTab() {
  const { business, refresh } = useStore();

  const [name, setName] = useState(business?.name ?? "");
  const [weekStartDay, setWeekStartDay] = useState(business?.weekStartDay ?? 1);
  const [rosterPeriod, setRosterPeriod] = useState<RosterPeriod>(business?.rosterPeriod ?? "fortnight");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!business) {
    return (
      <SectionCard title="Business details">
        <p className="text-sm text-ink-faint">
          No business is loaded for your account. Sign out and back in, or contact support.
        </p>
      </SectionCard>
    );
  }

  const nameValid = name.trim().length > 1;
  const dirty =
    name.trim() !== business.name ||
    weekStartDay !== business.weekStartDay ||
    rosterPeriod !== business.rosterPeriod;

  const save = async () => {
    if (!nameValid || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateBusinessProfile(business.id, {
        name: name.trim(),
        weekStartDay,
        rosterPeriod,
      });
      // Pull the canonical row back so the header and every other screen agree.
      await refresh();
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your business details.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <SectionCard
        title="Business details"
        description="The basics every roster is built from. You can change these at any time."
        footer={
          <>
            <SavedNote show={saved && !dirty} />
            <Button className="h-11" onClick={save} disabled={!nameValid || !dirty || busy}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </>
        }
      >
        {error && <WriteError message={error} onRetry={save} />}

        <SettingRow
          label="Business name"
          help="Shown at the top of the app and on anything your team sees."
          htmlFor="business-name"
        >
          <Input
            id="business-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            placeholder="Your restaurant's name"
          />
        </SettingRow>

        <SettingRow
          label="Week starts on"
          help="Which day your roster grid and week template start on."
          htmlFor="week-start"
        >
          <Select
            id="week-start"
            value={String(weekStartDay)}
            onChange={(e) => {
              setWeekStartDay(Number(e.target.value));
              setSaved(false);
            }}
          >
            {DAY_NAMES.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </Select>
        </SettingRow>

        <SettingRow
          label="Roster period"
          help="How much time you plan at once — one week, or a fortnight at a time."
          htmlFor="roster-period"
        >
          <Select
            id="roster-period"
            value={rosterPeriod}
            onChange={(e) => {
              setRosterPeriod(e.target.value as RosterPeriod);
              setSaved(false);
            }}
          >
            <option value="week">One week</option>
            <option value="fortnight">Fortnight</option>
          </Select>
        </SettingRow>

        <SettingRow
          label="Timezone"
          help="Every time in Rosterly is shown in this timezone. Fixed for now — tell us if you need another."
          htmlFor="timezone"
        >
          <Input id="timezone" value={business.timezone} readOnly disabled />
        </SettingRow>

        <SettingRow
          label="Currency"
          help="Used when showing labour-cost estimates. Display only."
          htmlFor="currency"
        >
          <Input id="currency" value={business.currency} readOnly disabled />
        </SettingRow>
      </SectionCard>
    </div>
  );
}
