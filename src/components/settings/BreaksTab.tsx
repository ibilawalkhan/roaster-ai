"use client";

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Button, Input } from "@/components/ui";
import { IconPlus, IconTrash } from "@/components/icons";
import {
  ErrorPanel,
  IssueList,
  LoadingPanel,
  SavedNote,
  SectionCard,
  WriteError,
} from "./shared";
import {
  DEFAULT_BREAK_TIERS,
  hasErrors,
  validateBreakRules,
  type BreakRuleTier,
  type SettingsIssue,
} from "@/lib/domain/settings-validation";
import {
  createBreakRule,
  deleteBreakRule,
  fetchBreakRules,
  updateBreakRule,
  type BreakRuleRow,
} from "@/lib/supabase/settings";

/** One editable row. Numbers stay strings so a half-typed value isn't clamped. */
interface TierForm {
  key: string;
  id?: string;
  min: string;
  max: string; // "" = open-ended ("and over")
  minutes: string;
}

let keySeq = 0;
const nextKey = () => `tier-${(keySeq += 1)}`;

function rowToForm(row: BreakRuleRow): TierForm {
  return {
    key: nextKey(),
    id: row.id,
    min: String(Number(row.min_hours)),
    max: row.max_hours === null ? "" : String(Number(row.max_hours)),
    minutes: String(row.break_minutes),
  };
}

function formToTier(f: TierForm): BreakRuleTier {
  const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
  return {
    id: f.id,
    minHours: num(f.min),
    maxHours: f.max.trim() === "" ? null : num(f.max),
    breakMinutes: num(f.minutes),
  };
}

function tierToForm(t: BreakRuleTier): TierForm {
  return {
    key: nextKey(),
    min: String(t.minHours),
    max: t.maxHours === null ? "" : String(t.maxHours),
    minutes: String(t.breakMinutes),
  };
}

/** M1 §3.7 — the unpaid break suggested by shift length. Estimates only. */
export function BreaksTab() {
  const { session } = useStore();
  const [original, setOriginal] = useState<BreakRuleRow[]>([]);
  const [tiers, setTiers] = useState<TierForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [issues, setIssues] = useState<SettingsIssue[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await fetchBreakRules();
      setOriginal(rows);
      setTiers(rows.map(rowToForm));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load your break rules.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const patchTier = (key: string, patch: Partial<TierForm>) => {
    setTiers((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));
    setAcknowledged(false);
    setSaved(false);
  };

  const addTier = () => {
    const last = tiers[tiers.length - 1];
    const start = last && last.max.trim() !== "" ? last.max : "";
    setTiers((prev) => [...prev, { key: nextKey(), min: start, max: "", minutes: "0" }]);
    setAcknowledged(false);
    setSaved(false);
  };

  const removeTier = (key: string) => {
    setTiers((prev) => prev.filter((t) => t.key !== key));
    setAcknowledged(false);
    setSaved(false);
  };

  const useRecommended = () => {
    // Keep the existing ids where we can so the save is an update, not a churn.
    setTiers(
      DEFAULT_BREAK_TIERS.map((t, i) => ({ ...tierToForm(t), id: original[i]?.id })),
    );
    setAcknowledged(false);
    setSaved(false);
  };

  const save = async () => {
    if (!session.businessId || busy) return;
    const drafts = tiers.map(formToTier);
    const found = validateBreakRules(drafts);
    setIssues(found);
    if (hasErrors(found)) return;
    if (found.length > 0 && !acknowledged) {
      setAcknowledged(true);
      return;
    }

    setBusy(true);
    setWriteError(null);
    setSaved(false);
    try {
      const keptIds = new Set(tiers.map((t) => t.id).filter(Boolean));
      const removed = original.filter((r) => !keptIds.has(r.id));

      for (const r of removed) await deleteBreakRule(r.id);
      for (const draft of drafts) {
        const input = {
          minHours: draft.minHours,
          maxHours: draft.maxHours,
          breakMinutes: draft.breakMinutes,
        };
        if (draft.id) await updateBreakRule(draft.id, input);
        else await createBreakRule(session.businessId, input);
      }
      await load();
      setSaved(true);
      setAcknowledged(false);
    } catch (e) {
      setWriteError(
        e instanceof Error
          ? e.message
          : "Couldn't save your break rules. Reload to see what did save.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingPanel label="Loading break rules…" />;
  if (loadError) return <ErrorPanel message={loadError} onRetry={() => void load()} />;

  return (
    <div className="space-y-5">
      <SectionCard
        title="Breaks"
        description="The unpaid break Rosterly suggests based on how long a shift is. You can always change the break on any individual shift."
        footer={
          <>
            <SavedNote show={saved} />
            <Button variant="ghost" className="h-11" onClick={useRecommended} disabled={busy}>
              Use recommended
            </Button>
            <Button className="h-11" onClick={save} disabled={busy}>
              {busy
                ? "Saving…"
                : acknowledged && issues.length > 0 && !hasErrors(issues)
                  ? "Save anyway"
                  : "Save break rules"}
            </Button>
          </>
        }
      >
        {writeError && <WriteError message={writeError} onRetry={save} />}
        <IssueList issues={issues} />

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="px-2 py-2 text-left text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
                  Shift from
                </th>
                <th className="px-2 py-2 text-left text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
                  Shift up to
                </th>
                <th className="px-2 py-2 text-left text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
                  Unpaid break
                </th>
                <th className="w-14" />
              </tr>
            </thead>
            <tbody>
              {tiers.map((t) => (
                <tr key={t.key} className="border-b border-line last:border-0">
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        step={0.5}
                        aria-label="Shift length from (hours)"
                        value={t.min}
                        onChange={(e) => patchTier(t.key, { min: e.target.value })}
                        className="nums w-24"
                      />
                      <span className="text-[13px] text-ink-soft">h</span>
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        step={0.5}
                        aria-label="Shift length up to (hours), blank for no upper limit"
                        placeholder="and over"
                        value={t.max}
                        onChange={(e) => patchTier(t.key, { max: e.target.value })}
                        className="nums w-24"
                      />
                      <span className="text-[13px] text-ink-soft">h</span>
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        step={5}
                        aria-label="Unpaid break (minutes)"
                        value={t.minutes}
                        onChange={(e) => patchTier(t.key, { minutes: e.target.value })}
                        className="nums w-24"
                      />
                      <span className="text-[13px] text-ink-soft">min</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeTier(t.key)}
                      aria-label="Remove this break rule"
                      className="grid h-11 w-11 place-items-center rounded-lg text-ink-faint transition hover:bg-clay/10 hover:text-clay"
                    >
                      <IconTrash width={17} height={17} />
                    </button>
                  </td>
                </tr>
              ))}
              {tiers.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-2 py-6 text-center text-sm text-ink-faint">
                    No break rules. Every rostered hour will be counted as paid.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Button variant="outline" className="h-11" onClick={addTier}>
          <IconPlus width={16} height={16} /> Add a rule
        </Button>

        <p className="text-[13px] text-ink-soft">
          Leave &ldquo;shift up to&rdquo; blank on the last row to mean &ldquo;and anything
          longer&rdquo;. A shift lasting exactly the same as a boundary — 5 hours, say — falls into
          the row that starts at 5.
        </p>

        <p className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-[13px] text-ink-soft">
          <strong className="font-semibold text-ink">These are rostering conveniences, not award
          interpretation.</strong>{" "}
          Break rules only change the estimated hours and cost Rosterly shows you. They are an
          estimate, not payroll, and don&rsquo;t include penalty rates, loadings, overtime, super or
          tax.
        </p>
      </SectionCard>
    </div>
  );
}
