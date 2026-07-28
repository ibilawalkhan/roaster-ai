"use client";

// The panels down the left of the review screen: create, seeded summary,
// pre-flight, roster health, accepted exceptions and the change log.
//
// The health panel is the one that matters (M6 §2.2). Two rules govern it:
// never show a count without the detail behind it, and never show a warning the
// manager can't act on. Every line therefore names what, where and why, and
// clicking it jumps to the cell it is talking about.

import { useState } from "react";
import { Badge, Button, Card, Input, Label } from "@/components/ui";
import { IconCalendar } from "@/components/icons";
import type { PreflightIssue, PreflightResult } from "@/lib/domain/preflight";
import type { EligibilityIssue, SeniorCoverageGap } from "@/lib/domain/eligibility";
import type { ChangeAction, ChangeLogRow, RosterWarningRow } from "@/lib/supabase/roster-edit";
import { COST_DISCLAIMER, roundMoney } from "@/lib/domain/cost";
import { wallDateIn, wallTimeIn } from "@/lib/domain/timezone";
import { formatDayLabel, formatHours, formatMoney } from "@/lib/utils";

export function Dot({ tone }: { tone: "ok" | "warn" | "bad" }) {
  const colour = tone === "ok" ? "bg-herb" : tone === "warn" ? "bg-saffron" : "bg-clay";
  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${colour}`} />;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export function CreateRosterPanel({
  startDate,
  onStartDateChange,
  periodLabel,
  days,
  positionCount,
  hours,
  creating,
  canCreate,
  onCreate,
}: {
  startDate: string;
  onStartDateChange: (v: string) => void;
  periodLabel: string;
  days: number;
  positionCount: number;
  hours: number;
  creating: boolean;
  canCreate: boolean;
  onCreate: () => void;
}) {
  return (
    <Card className="rise mt-5 overflow-hidden">
      <div className="border-b border-line px-5 py-4">
        <h2 className="font-display text-base font-semibold text-ink">Create a roster</h2>
        <p className="mt-0.5 text-[13px] text-ink-soft">
          Your requirements are copied from the week template onto real dates. Change the template
          later and this roster stays exactly as it is.
        </p>
      </div>
      <div className="grid gap-5 p-5 sm:grid-cols-[minmax(0,220px)_1fr] sm:items-end">
        <div>
          <Label htmlFor="roster-start">Starts</Label>
          <Input
            id="roster-start"
            type="date"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            className="nums"
          />
          <p className="mt-1.5 text-[12px] text-ink-faint">
            {periodLabel} — {days} days, set in Settings.
          </p>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ember-soft text-ember-deep">
              <IconCalendar width={19} height={19} />
            </span>
            <p className="nums text-[13px] text-ink-soft">
              <span className="font-semibold text-ink">{days} days</span>,{" "}
              <span className="font-semibold text-ink">{positionCount} positions</span> to fill,{" "}
              <span className="font-semibold text-ink">{formatHours(hours)}</span>
            </p>
          </div>
          <Button size="lg" onClick={onCreate} disabled={creating || !canCreate}>
            {creating ? "Creating…" : "Create roster"}
          </Button>
        </div>
      </div>
      {positionCount === 0 && (
        <p className="border-t border-line bg-surface-2 px-5 py-3 text-[13px] text-clay">
          Your week template has nothing rostered on these dates, so there is nothing to create.
          Add requirements on the Template screen first.
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Pre-flight (M5 §2 step 4)
// ---------------------------------------------------------------------------

export function PreflightPanel({ result }: { result: PreflightResult }) {
  const { blockers, warnings } = result;
  const clean = blockers.length === 0 && warnings.length === 0;

  return (
    <Card className="rise mt-5 overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="font-display text-base font-semibold text-ink">Pre-flight check</h2>
        <Badge tone={blockers.length ? "clay" : warnings.length ? "saffron" : "herb"}>
          {blockers.length
            ? `${blockers.length} ${blockers.length === 1 ? "blocker" : "blockers"}`
            : warnings.length
              ? `${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}`
              : "All clear"}
        </Badge>
      </div>
      <div className="space-y-3 p-4 text-[13px]">
        {clean && (
          <div className="flex items-start gap-2 text-herb">
            <Dot tone="ok" />
            <p>Nothing is standing in the way — this roster can be generated.</p>
          </div>
        )}
        {[...blockers, ...warnings].map((issue, i) => (
          <IssueLine key={`${issue.code}-${i}`} issue={issue} />
        ))}
        {blockers.length > 0 && (
          <p className="rounded-lg border border-clay/30 bg-clay/5 px-3 py-2 text-clay">
            Generation is off until these are sorted — a roster built on them wouldn&rsquo;t mean
            anything.
          </p>
        )}
      </div>
    </Card>
  );
}

function IssueLine({ issue }: { issue: PreflightIssue }) {
  const blocker = issue.severity === "blocker";
  return (
    <div className="flex items-start gap-2">
      <Dot tone={blocker ? "bad" : "warn"} />
      <p className={blocker ? "text-clay" : "text-ink-soft"}>
        <span className="font-medium">{issue.message}</span>
        {issue.detail && <span className="text-ink-faint"> {issue.detail}</span>}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roster health (M6 §2.2)
// ---------------------------------------------------------------------------

export interface UnfilledEntry {
  positionId: string;
  date: string;
  roleName: string;
  from: string;
  to: string;
  detail: string | null;
}

export interface ShiftWarningEntry {
  shiftId: string;
  personName: string;
  date: string;
  issue: EligibilityIssue;
}

export function HealthPanel({
  generated,
  total,
  filled,
  hours,
  cost,
  staffCount,
  unfilled,
  coverageGaps,
  shiftWarnings,
  timeLimitHit,
  onFocus,
}: {
  generated: boolean;
  total: number;
  filled: number;
  hours: number;
  cost: number;
  staffCount: number;
  unfilled: UnfilledEntry[];
  coverageGaps: SeniorCoverageGap[];
  shiftWarnings: ShiftWarningEntry[];
  timeLimitHit: boolean;
  onFocus: (cellId: string) => void;
}) {
  if (!generated) return null;
  const healthy =
    unfilled.length === 0 && coverageGaps.length === 0 && shiftWarnings.length === 0;

  return (
    <Card className="rise mt-5 overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="font-display text-base font-semibold text-ink">Roster health</h2>
        <Badge tone={healthy ? "herb" : "saffron"}>
          {healthy ? "Healthy" : `${unfilled.length + coverageGaps.length + shiftWarnings.length} to look at`}
        </Badge>
      </div>

      {/* Headline, in the plain language of M6 §2.2 */}
      <div className="border-b border-line px-4 py-3 text-[13px]">
        {healthy ? (
          <p className="nums text-herb">
            ✓ All {total} positions filled · ✓ Senior present all open hours ·{" "}
            <span className="text-ink">{formatHours(hours)}</span> ·{" "}
            <span className="text-ink">Est. {formatMoney(roundMoney(cost))}</span> · {staffCount}{" "}
            staff
          </p>
        ) : (
          <p className="nums text-ink-soft">
            <span className="font-semibold text-ink">
              {filled} of {total}
            </span>{" "}
            filled
            {unfilled.length > 0 && (
              <span className="text-clay"> · ⚠ {unfilled.length} unfilled</span>
            )}
            {coverageGaps.length > 0 && (
              <span className="text-clay">
                {" "}
                · ⚠ {coverageGaps.length} senior coverage{" "}
                {coverageGaps.length === 1 ? "gap" : "gaps"}
              </span>
            )}
            {shiftWarnings.length > 0 && (
              <span className="text-[#8a6212]"> · ⚠ {shiftWarnings.length} rule warnings</span>
            )}{" "}
            · <span className="text-ink">{formatHours(hours)}</span> ·{" "}
            <span className="text-ink">Est. {formatMoney(roundMoney(cost))}</span>
          </p>
        )}
        <p className="mt-0.5 text-[11px] text-ink-faint">{COST_DISCLAIMER}</p>
      </div>

      <div className="space-y-2 p-4 text-[13px]">
        {unfilled.map((u) => (
          <HealthLine
            key={u.positionId}
            tone="bad"
            onClick={() => onFocus(u.positionId)}
            head={`${formatDayLabel(u.date)}, ${u.roleName} ${u.from}–${u.to} — unfilled`}
            detail={u.detail}
          />
        ))}

        {coverageGaps.map((g, i) => (
          <HealthLine
            key={`gap-${g.date}-${g.from}-${i}`}
            tone="bad"
            onClick={() => onFocus(`day-${g.date}`)}
            head={`${formatDayLabel(g.date)}, ${g.from}–${g.to} — senior coverage gap`}
            detail={g.detail}
          />
        ))}

        {shiftWarnings.map((w, i) => (
          <HealthLine
            key={`warn-${w.shiftId}-${i}`}
            tone="warn"
            onClick={() => onFocus(w.shiftId)}
            head={`${w.personName}, ${formatDayLabel(w.date)} — ${w.issue.short.toLowerCase()}`}
            detail={w.issue.message}
          />
        ))}

        {timeLimitHit && (
          <div className="flex items-start gap-2">
            <Dot tone="warn" />
            <p className="text-ink-soft">
              The scheduler ran out of time and returned its best roster so far. Every hard rule
              still holds; it may just not be the tidiest split of hours.
            </p>
          </div>
        )}

        {healthy && (
          <div className="flex items-start gap-2 text-herb">
            <Dot tone="ok" />
            <p>Nothing needs your attention. This roster is ready to publish.</p>
          </div>
        )}
      </div>
    </Card>
  );
}

function HealthLine({
  tone,
  head,
  detail,
  onClick,
}: {
  tone: "warn" | "bad";
  head: string;
  detail: string | null;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex min-h-11 w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-surface-2"
    >
      <Dot tone={tone} />
      <span>
        <span className={`block font-medium ${tone === "bad" ? "text-clay" : "text-[#8a6212]"}`}>
          {head}
        </span>
        {detail && <span className="block text-[12px] text-ink-soft">{detail}</span>}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Accepted exceptions — persisted overrides (M6 §3.2)
// ---------------------------------------------------------------------------

const WARNING_LABEL: Record<string, string> = {
  availability: "Marked unavailable",
  max_hours: "Over hour limit",
  min_rest: "Not enough rest",
  consecutive_days: "Too many days running",
  senior_coverage: "Senior coverage",
  min_hours: "Below minimum hours",
};

export function AcceptedExceptionsPanel({
  warnings,
  busy,
  onFocus,
  onResolve,
}: {
  warnings: RosterWarningRow[];
  busy: boolean;
  onFocus: (cellId: string) => void;
  onResolve: (id: string) => void;
}) {
  if (warnings.length === 0) return null;

  return (
    <Card className="rise mt-5 overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="font-display text-base font-semibold text-ink">Accepted exceptions</h2>
          <p className="text-[12px] text-ink-faint">
            Rules you chose to break. They stay here until the reason is gone.
          </p>
        </div>
        <Badge tone="saffron">{warnings.length}</Badge>
      </div>
      <div className="divide-y divide-line">
        {warnings.map((w) => (
          <div key={w.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
            <button
              onClick={() => w.shift_id && onFocus(w.shift_id)}
              className="min-h-11 flex-1 text-left"
              disabled={!w.shift_id}
            >
              <p className="text-[13px] font-medium text-[#8a6212]">
                {WARNING_LABEL[w.rule] ?? w.rule}
              </p>
              <p className="text-[12px] text-ink-soft">{w.detail}</p>
            </button>
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11 shrink-0"
              disabled={busy}
              onClick={() => onResolve(w.id)}
            >
              Clear
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Change log (M6 §5)
// ---------------------------------------------------------------------------

const ACTION_LABEL: Record<ChangeAction, string> = {
  assign: "Assigned someone",
  reassign: "Moved a shift to someone else",
  remove: "Took someone off a shift",
  add_position: "Added a position",
  delete_position: "Deleted a position",
  edit_times: "Edited a shift",
  lock: "Pinned a shift",
  unlock: "Unpinned a shift",
  publish: "Published the roster",
  unpublish: "Withdrew the roster",
};

export function ChangeLogPanel({
  entries,
  timezone,
  personName,
}: {
  entries: ChangeLogRow[];
  timezone: string;
  personName: (id: string | null) => string;
}) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;

  return (
    <Card className="rise mt-5 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <h2 className="font-display text-base font-semibold text-ink">Change history</h2>
          <p className="text-[12px] text-ink-faint">
            Who changed what, and when. This record can&rsquo;t be edited.
          </p>
        </div>
        <span className="text-[13px] font-semibold text-ink-soft">
          {open ? "Hide" : `Show ${entries.length}`}
        </span>
      </button>

      {open && (
        <ul className="divide-y divide-line border-t border-line">
          {entries.map((e) => (
            <li key={e.id} className="flex items-baseline justify-between gap-3 px-4 py-2">
              <span className="text-[13px] text-ink-soft">
                <span className="font-medium text-ink">
                  {ACTION_LABEL[e.action as ChangeAction] ?? e.action}
                </span>{" "}
                · {personName(e.changed_by_user_id)}
              </span>
              <span className="nums shrink-0 text-[11px] text-ink-faint">
                {formatDayLabel(wallDateIn(e.changed_at, timezone))}{" "}
                {wallTimeIn(e.changed_at, timezone)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Seeded summary
// ---------------------------------------------------------------------------

export function SeededSummary({
  days,
  positionCount,
  hours,
  filled,
  hasRun,
}: {
  days: number;
  positionCount: number;
  hours: number;
  filled: number;
  hasRun: boolean;
}) {
  return (
    <div
      className="rise mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3"
      style={{ animationDelay: "40ms" }}
    >
      <Card className="p-4">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">Period</p>
        <p className="nums mt-1 font-display text-2xl font-semibold text-ink">{days} days</p>
      </Card>
      <Card className="p-4">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
          Positions {hasRun ? "filled" : "to fill"}
        </p>
        <p className="nums mt-1 font-display text-2xl font-semibold text-ink">
          {hasRun ? `${filled} / ${positionCount}` : positionCount}
        </p>
      </Card>
      <Card className="p-4">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
          Hours required
        </p>
        <p className="nums mt-1 font-display text-2xl font-semibold text-ink">
          {formatHours(hours)}
        </p>
      </Card>
    </div>
  );
}
