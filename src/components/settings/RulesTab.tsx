"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { Button, Input, cx } from "@/components/ui";
import {
  ErrorPanel,
  IssueList,
  LoadingPanel,
  SavedNote,
  SectionCard,
  SettingRow,
  Toggle,
  WriteError,
} from "./shared";
import {
  DEFAULT_SCHEDULING_RULES,
  SOFT_PRIORITIES,
  SOFT_PRIORITY_LABEL,
  countSeniorQualifyingStaff,
  hasErrors,
  isSoftPriority,
  validateSchedulingRules,
  type SchedulingRuleDraft,
  type SettingsIssue,
  type SoftPriority,
} from "@/lib/domain/settings-validation";
import {
  fetchSchedulingRule,
  saveSchedulingRule,
  type SchedulingRuleRow,
} from "@/lib/supabase/settings";
import { LEVELS, LEVEL_LABEL, type Level } from "@/lib/types";

/** Numbers live as strings while editing so a half-typed field isn't clamped. */
interface RuleForm {
  seniorCoverageEnabled: boolean;
  seniorMinCount: string;
  seniorQualifyingLevels: Level[];
  maxHoursCasual: string;
  maxHoursPartTime: string;
  maxHoursFullTime: string;
  maxConsecutiveDays: string;
  minRestHours: string;
  maxShiftHours: string;
  minShiftHours: string;
  oneShiftPerDay: boolean;
  allowOvernight: boolean;
  softPriorityOrder: SoftPriority[];
}

function formFromDefaults(): RuleForm {
  const d = DEFAULT_SCHEDULING_RULES;
  return {
    seniorCoverageEnabled: d.seniorCoverageEnabled,
    seniorMinCount: String(d.seniorMinCount),
    seniorQualifyingLevels: [...d.seniorQualifyingLevels],
    maxHoursCasual: String(d.maxHoursCasual),
    maxHoursPartTime: String(d.maxHoursPartTime),
    maxHoursFullTime: String(d.maxHoursFullTime),
    maxConsecutiveDays: String(d.maxConsecutiveDays),
    minRestHours: String(d.minRestHours),
    maxShiftHours: String(d.maxShiftHours),
    minShiftHours: String(d.minShiftHours),
    oneShiftPerDay: d.oneShiftPerDay,
    allowOvernight: d.allowOvernight,
    softPriorityOrder: [...d.softPriorityOrder],
  };
}

function formFromRow(row: SchedulingRuleRow): RuleForm {
  const order = row.soft_priority_order.filter(isSoftPriority);
  // Anything missing (older row, hand-edited data) falls back to the default rank.
  for (const p of DEFAULT_SCHEDULING_RULES.softPriorityOrder) {
    if (!order.includes(p)) order.push(p);
  }
  return {
    seniorCoverageEnabled: row.senior_coverage_enabled,
    seniorMinCount: String(row.senior_min_count),
    seniorQualifyingLevels: [...row.senior_qualifying_levels],
    maxHoursCasual: String(row.max_hours_casual),
    maxHoursPartTime: String(row.max_hours_part_time),
    maxHoursFullTime: String(row.max_hours_full_time),
    maxConsecutiveDays: String(row.max_consecutive_days),
    minRestHours: String(row.min_rest_hours),
    maxShiftHours: String(row.max_shift_hours),
    minShiftHours: String(row.min_shift_hours),
    oneShiftPerDay: row.one_shift_per_day,
    allowOvernight: row.allow_overnight,
    softPriorityOrder: order,
  };
}

function toDraft(form: RuleForm): SchedulingRuleDraft {
  const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
  return {
    seniorCoverageEnabled: form.seniorCoverageEnabled,
    seniorMinCount: num(form.seniorMinCount),
    seniorQualifyingLevels: form.seniorQualifyingLevels,
    maxHoursCasual: num(form.maxHoursCasual),
    maxHoursPartTime: num(form.maxHoursPartTime),
    maxHoursFullTime: num(form.maxHoursFullTime),
    maxConsecutiveDays: num(form.maxConsecutiveDays),
    minRestHours: num(form.minRestHours),
    maxShiftHours: num(form.maxShiftHours),
    minShiftHours: num(form.minShiftHours),
    oneShiftPerDay: form.oneShiftPerDay,
    allowOvernight: form.allowOvernight,
    softPriorityOrder: form.softPriorityOrder,
  };
}

/** M1 §3.6 — the hard constraints every generated roster must obey. */
export function RulesTab() {
  const { session, team } = useStore();
  const [form, setForm] = useState<RuleForm>(formFromDefaults);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [issues, setIssues] = useState<SettingsIssue[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [seeded, setSeeded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const row = await fetchSchedulingRule();
      setForm(row ? formFromRow(row) : formFromDefaults());
      // No row yet = a business that never ran setup; the defaults below are
      // shown but nothing is stored until the manager saves.
      setSeeded(!row);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load your scheduling rules.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const patch = (p: Partial<RuleForm>) => {
    setForm((prev) => ({ ...prev, ...p }));
    setAcknowledged(false);
    setSaved(false);
  };

  const seniorStaffCount = useMemo(
    () =>
      countSeniorQualifyingStaff(
        team.map((m) => ({ level: m.level, active: m.active })),
        form.seniorQualifyingLevels,
      ),
    [team, form.seniorQualifyingLevels],
  );

  const move = (index: number, delta: number) => {
    const next = [...form.softPriorityOrder];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    patch({ softPriorityOrder: next });
  };

  const toggleLevel = (level: Level) => {
    const has = form.seniorQualifyingLevels.includes(level);
    patch({
      seniorQualifyingLevels: has
        ? form.seniorQualifyingLevels.filter((l) => l !== level)
        : LEVELS.filter((l) => l === level || form.seniorQualifyingLevels.includes(l)),
    });
  };

  const save = async () => {
    if (!session.businessId || busy) return;
    const draft = toDraft(form);
    const found = validateSchedulingRules(draft, {
      seniorQualifyingStaffCount: seniorStaffCount,
    });
    setIssues(found);
    if (hasErrors(found)) return;
    // Warnings are shown once and must be acknowledged before the write goes
    // through — the manager sees the problem at save time, not at generation.
    if (found.length > 0 && !acknowledged) {
      setAcknowledged(true);
      return;
    }

    setBusy(true);
    setWriteError(null);
    setSaved(false);
    try {
      await saveSchedulingRule(session.businessId, {
        seniorCoverageEnabled: draft.seniorCoverageEnabled,
        seniorMinCount: draft.seniorMinCount,
        seniorQualifyingLevels: draft.seniorQualifyingLevels,
        maxHoursCasual: draft.maxHoursCasual,
        maxHoursPartTime: draft.maxHoursPartTime,
        maxHoursFullTime: draft.maxHoursFullTime,
        maxConsecutiveDays: draft.maxConsecutiveDays,
        minRestHours: draft.minRestHours,
        maxShiftHours: draft.maxShiftHours,
        minShiftHours: draft.minShiftHours,
        oneShiftPerDay: draft.oneShiftPerDay,
        allowOvernight: draft.allowOvernight,
        softPriorityOrder: draft.softPriorityOrder,
      });
      setSeeded(false);
      setSaved(true);
      setAcknowledged(false);
    } catch (e) {
      setWriteError(
        e instanceof Error ? e.message : "Couldn't save your rules. Nothing was changed.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingPanel label="Loading rules…" />;
  if (loadError) return <ErrorPanel message={loadError} onRetry={() => void load()} />;

  const numberField = (
    id: string,
    key: keyof RuleForm,
    suffix: string,
    extra: { min?: number; max?: number } = {},
  ) => (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={extra.min ?? 0}
        max={extra.max}
        value={String(form[key])}
        // Computed-key assertion: `key` is a keyof RuleForm and every numeric
        // field on RuleForm is a string, so this is sound — TS just can't
        // narrow a computed key back to the union member on its own.
        onChange={(e) => patch({ [key]: e.target.value } as Partial<RuleForm>)}
        className="nums w-24"
      />
      <span className="text-[13px] text-ink-soft">{suffix}</span>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-[13px] text-ink-soft">
        <strong className="font-semibold text-ink">Changing these rules never changes a roster
        you&rsquo;ve already published.</strong>{" "}
        They apply the next time you generate a roster. Anything already out with your team stays
        exactly as it is.
      </div>

      {seeded && (
        <div className="rounded-xl border border-saffron/40 bg-saffron-soft/50 px-4 py-3 text-[13px] text-[#8a6212]">
          These are the recommended starting rules. They aren&rsquo;t saved yet — press
          &ldquo;Save rules&rdquo; to accept them.
        </div>
      )}

      <SectionCard
        title="Senior on site"
        description="The headline rule: somebody experienced is always on the floor."
      >
        <SettingRow
          label="Require a senior during all open hours"
          help="Rosterly won't leave a minute of trading time without one of the levels you choose below."
        >
          <Toggle
            checked={form.seniorCoverageEnabled}
            onChange={(v) => patch({ seniorCoverageEnabled: v })}
            label="Require a senior during all open hours"
          />
        </SettingRow>

        {form.seniorCoverageEnabled && (
          <>
            <SettingRow
              label="How many must be on at once"
              help="Usually 1. Choose 2 only if you genuinely have enough senior staff to cover every open hour."
              htmlFor="senior-count"
            >
              {numberField("senior-count", "seniorMinCount", "on at all times", { min: 1, max: 5 })}
            </SettingRow>

            <SettingRow
              label="Which levels count as senior"
              help="Default is Senior only. Pick Mid as well if your experienced mid-level staff can hold the floor."
            >
              <div className="flex flex-wrap gap-2 sm:justify-end">
                {LEVELS.map((l) => {
                  const on = form.seniorQualifyingLevels.includes(l);
                  return (
                    <button
                      key={l}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleLevel(l)}
                      className={cx(
                        "min-h-11 rounded-full border px-4 text-[13px] font-medium transition",
                        on
                          ? "border-ember bg-ember-soft text-ember-deep"
                          : "border-line bg-surface text-ink-soft hover:border-ink-faint",
                      )}
                    >
                      {LEVEL_LABEL[l]}
                    </button>
                  );
                })}
              </div>
            </SettingRow>

            <p className="text-[13px] text-ink-soft">
              Right now {seniorStaffCount}{" "}
              {seniorStaffCount === 1 ? "active person counts" : "active people count"} as senior.
            </p>
          </>
        )}
      </SectionCard>

      <SectionCard
        title="Limits on people"
        description="Guardrails Rosterly will never break when it builds a roster."
      >
        <SettingRow
          label="Most days in a row"
          help="Stops anyone being rostered every day of the week without a break."
          htmlFor="consec-days"
        >
          {numberField("consec-days", "maxConsecutiveDays", "days", { min: 1, max: 7 })}
        </SettingRow>

        <SettingRow
          label="Rest between shifts"
          help="Stops a late close followed by an early open. 10 hours is standard in hospitality."
          htmlFor="min-rest"
        >
          {numberField("min-rest", "minRestHours", "hours", { min: 0, max: 24 })}
        </SettingRow>

        <SettingRow
          label="Shortest shift"
          help="Nobody gets called in for a pointlessly short shift."
          htmlFor="min-shift"
        >
          {numberField("min-shift", "minShiftHours", "hours", { min: 0, max: 24 })}
        </SettingRow>

        <SettingRow
          label="Longest shift"
          help="A safety valve — no one is rostered a marathon by accident."
          htmlFor="max-shift"
        >
          {numberField("max-shift", "maxShiftHours", "hours", { min: 1, max: 24 })}
        </SettingRow>

        <SettingRow
          label="One shift per person per day"
          help="On means no split shifts — a person works once a day, in one block."
        >
          <Toggle
            checked={form.oneShiftPerDay}
            onChange={(v) => patch({ oneShiftPerDay: v })}
            label="One shift per person per day"
          />
        </SettingRow>

        <SettingRow
          label="Allow shifts past midnight"
          help="Turn off if you never trade overnight — it makes rosters simpler to check."
        >
          <Toggle
            checked={form.allowOvernight}
            onChange={(v) => patch({ allowOvernight: v })}
            label="Allow shifts past midnight"
          />
        </SettingRow>
      </SectionCard>

      <SectionCard
        title="Weekly hour caps"
        description="The most anyone on each employment type is rostered in a week. If you set a limit on someone's own profile, that number wins."
      >
        <SettingRow label="Casual" help="Applies to everyone marked Casual." htmlFor="cap-casual">
          {numberField("cap-casual", "maxHoursCasual", "hours a week", { min: 1, max: 168 })}
        </SettingRow>
        <SettingRow
          label="Part-time"
          help="Applies to everyone marked Part-time."
          htmlFor="cap-part"
        >
          {numberField("cap-part", "maxHoursPartTime", "hours a week", { min: 1, max: 168 })}
        </SettingRow>
        <SettingRow
          label="Full-time"
          help="Applies to everyone marked Full-time."
          htmlFor="cap-full"
        >
          {numberField("cap-full", "maxHoursFullTime", "hours a week", { min: 1, max: 168 })}
        </SettingRow>
      </SectionCard>

      <SectionCard
        title="What matters most"
        description="When more than one roster obeys all the rules above, Rosterly picks the one that best matches this order. Drag the top item to the top of your priorities — number 1 wins."
      >
        <ol className="space-y-2">
          {form.softPriorityOrder.map((p, i) => (
            <li
              key={p}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-2.5"
            >
              <span className="nums grid h-8 w-8 shrink-0 place-items-center rounded-full bg-paper-deep text-sm font-bold text-ink-soft">
                {i + 1}
              </span>
              <span className="flex-1 text-sm text-ink">{SOFT_PRIORITY_LABEL[p]}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={`Move ${SOFT_PRIORITY_LABEL[p]} up`}
                  className="grid h-11 w-11 place-items-center rounded-lg text-ink-soft transition hover:bg-paper-deep disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === form.softPriorityOrder.length - 1}
                  aria-label={`Move ${SOFT_PRIORITY_LABEL[p]} down`}
                  className="grid h-11 w-11 place-items-center rounded-lg text-ink-soft transition hover:bg-paper-deep disabled:opacity-30"
                >
                  ↓
                </button>
              </div>
            </li>
          ))}
        </ol>
        <p className="text-[13px] text-ink-soft">
          These are preferences, not rules — Rosterly leans towards them but will never break a
          limit above to satisfy one. ({SOFT_PRIORITIES.length} preferences, no numbers to tune.)
        </p>
      </SectionCard>

      <div className="flex flex-col gap-3">
        {writeError && <WriteError message={writeError} onRetry={save} />}
        <IssueList issues={issues} />
        <div className="flex flex-wrap items-center justify-end gap-3">
          <SavedNote show={saved} />
          <Button className="h-11" onClick={save} disabled={busy}>
            {busy
              ? "Saving…"
              : acknowledged && issues.length > 0 && !hasErrors(issues)
                ? "Save anyway"
                : "Save rules"}
          </Button>
        </div>
      </div>
    </div>
  );
}
