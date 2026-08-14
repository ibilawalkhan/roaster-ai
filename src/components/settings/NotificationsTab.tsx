"use client";

// Settings → Notifications (M9 §4 throttling, §5 SMS cost control).
//
// SMS is the only part of Rosterly that costs money per use and interrupts a
// real person's evening, so both dials belong to the owner. The policy engine
// has enforced these rules since M9; until now there was nowhere to set them.
//
// Everything here is about SMS. In-app notifications are always on and are
// never rate-limited or deferred: they are free, silent, and the fallback that
// makes degrading SMS safe.

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Button, Input, Select } from "@/components/ui";
import {
  ErrorPanel,
  LoadingPanel,
  SavedNote,
  SectionCard,
  SettingRow,
  Toggle,
  WriteError,
} from "./shared";
import {
  budgetFraction,
  fetchNotificationSettings,
  fetchSmsBudget,
  updateNotificationSettings,
  type NotificationSettingRow,
} from "@/lib/supabase/notification-settings";
import type { BusinessSmsBudget } from "@/lib/notify/policy";

const hhmm = (t: string): string => t.slice(0, 5);

/** Half-hour options, so quiet hours can't be set to something unreadable. */
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  const m = i % 2 === 0 ? "00" : "30";
  return `${h}:${m}`;
});

export function NotificationsTab() {
  const { session } = useStore();
  const businessId = session.businessId;

  const [row, setRow] = useState<NotificationSettingRow | null>(null);
  const [budget, setBudget] = useState<BusinessSmsBudget | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    try {
      const settings = await fetchNotificationSettings();
      setRow(settings);
      if (settings) {
        setBudget(await fetchSmsBudget(businessId, settings.monthly_sms_budget));
      }
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load your notification settings.");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    // Fetch-on-mount: setState runs after the await, never during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const patch = (next: Partial<NotificationSettingRow>) => {
    setRow((r) => (r ? { ...r, ...next } : r));
    setSaved(false);
  };

  const save = async () => {
    if (!row || !businessId) return;
    setSaving(true);
    setWriteError(null);
    const snapshot = row;
    try {
      const updated = await updateNotificationSettings(businessId, {
        sms_enabled: row.sms_enabled,
        quiet_hours_start: row.quiet_hours_start,
        quiet_hours_end: row.quiet_hours_end,
        daily_sms_cap: row.daily_sms_cap,
        monthly_sms_budget: row.monthly_sms_budget,
      });
      setRow(updated);
      setBudget(await fetchSmsBudget(businessId, updated.monthly_sms_budget));
      setSaved(true);
    } catch (e) {
      // Visible rollback — a setting that looks saved but isn't is worse than
      // an error (REQUIREMENTS §9).
      setRow(snapshot);
      setWriteError(e instanceof Error ? e.message : "Couldn't save. Nothing was changed.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingPanel label="Loading notification settings…" />;
  if (loadError) return <ErrorPanel message={loadError} onRetry={() => void load()} />;
  if (!row) return <ErrorPanel message="No notification settings found." onRetry={() => void load()} />;

  const fraction = budget ? budgetFraction(budget) : null;
  const overBudget = fraction !== null && fraction >= 1;
  const nearBudget = fraction !== null && fraction >= 0.8 && !overBudget;

  return (
    <div className="space-y-5">
      <SectionCard
        title="Text messages"
        description="In-app notifications are always on and always free. These settings only control SMS."
      >
        <div className="space-y-5">
          <SettingRow
            label="Send text messages"
            help="Turn this off to run in-app only — nothing will cost you anything, and staff still see everything when they open the app."
          >
            <Toggle
              checked={row.sms_enabled}
              onChange={(v) => patch({ sms_enabled: v })}
              label="Send text messages"
            />
          </SettingRow>

          <SettingRow
            label="Quiet hours"
            help="No texts between these times. Urgent ones still go out — being told you're on for a shift tomorrow morning can't wait until 7am."
          >
            <div className="flex items-center gap-2">
              <Select
                aria-label="Quiet hours start"
                value={hhmm(row.quiet_hours_start)}
                onChange={(e) => patch({ quiet_hours_start: e.target.value })}
                disabled={!row.sms_enabled}
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
              <span className="text-ink-faint">to</span>
              <Select
                aria-label="Quiet hours end"
                value={hhmm(row.quiet_hours_end)}
                onChange={(e) => patch({ quiet_hours_end: e.target.value })}
                disabled={!row.sms_enabled}
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </div>
          </SettingRow>

          <SettingRow
            label="Daily limit per person"
            help="The most texts one person can get in a day. Anything over the limit still reaches them in the app."
            htmlFor="daily-cap"
          >
            <Input
              id="daily-cap"
              type="number"
              min={0}
              max={50}
              value={row.daily_sms_cap}
              onChange={(e) => patch({ daily_sms_cap: Math.max(0, Number(e.target.value) || 0) })}
              disabled={!row.sms_enabled}
              className="nums"
            />
          </SettingRow>
        </div>
      </SectionCard>

      <SectionCard
        title="Monthly budget"
        description="A ceiling on texts per month, so a busy fortnight can't produce a surprise bill."
      >
        <div className="space-y-5">
          <SettingRow
            label="Monthly text limit"
            help="Leave blank for no limit. At the limit, texts stop and everything switches to in-app — the app keeps working, it just goes quiet."
            htmlFor="monthly-budget"
          >
            <Input
              id="monthly-budget"
              type="number"
              min={0}
              placeholder="No limit"
              value={row.monthly_sms_budget ?? ""}
              onChange={(e) =>
                patch({
                  monthly_sms_budget: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0),
                })
              }
              disabled={!row.sms_enabled}
              className="nums"
            />
          </SettingRow>

          {budget && (
            <div
              className={`rounded-xl border px-3.5 py-3 text-[13px] leading-snug ${
                overBudget
                  ? "border-clay/40 bg-clay/5 text-clay"
                  : nearBudget
                    ? "border-saffron/40 bg-saffron-soft text-[#8a6212]"
                    : "border-line bg-surface-2 text-ink-soft"
              }`}
            >
              <span className="nums font-semibold">{budget.used}</span>
              {budget.limit === null ? (
                <> text{budget.used === 1 ? "" : "s"} sent this month · no limit set</>
              ) : (
                <>
                  {" "}of <span className="nums font-semibold">{budget.limit}</span> used this month
                  {overBudget && " — texts are paused until next month. Staff still get everything in the app."}
                  {nearBudget && " — you're close to the limit."}
                </>
              )}
            </div>
          )}
        </div>
      </SectionCard>

      {writeError && <WriteError message={writeError} onRetry={() => void save()} />}

      <div className="flex items-center justify-end gap-3">
        <SavedNote show={saved} />
        <Button className="min-h-11" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
