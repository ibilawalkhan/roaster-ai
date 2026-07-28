"use client";

// Module 6 dialogs: the person picker, shift editing, adding a one-off
// requirement, regenerating, and publishing.
//
// The picker is the heart of §3.1: eligible people first, then people the
// manager MAY still choose with the rule named, then people who physically
// cannot be chosen at all. That ordering is the whole block-vs-warn philosophy
// expressed as a list — the app never hides an option the manager is entitled
// to take, it just makes sure he takes it knowingly.

import { useState } from "react";
import { Badge, Button, Card, Input, Label, Modal, Select } from "@/components/ui";
import { IconTrash } from "@/components/icons";
import type { EligibilityIssue, EligibilityResult } from "@/lib/domain/eligibility";
import type { MemberInput } from "@/lib/domain/solver-request";
import type { RosterPositionRow, ShiftRow } from "@/lib/supabase/roster";
import { minutesOfDay, wallTimeIn, zonedInstant } from "@/lib/domain/timezone";
import { COST_DISCLAIMER } from "@/lib/domain/cost";
import { LEVEL_LABEL, type Level } from "@/lib/types";
import { formatDayLabel, formatHours, formatMoney } from "@/lib/utils";

export interface PickerCandidate {
  member: MemberInput;
  result: EligibilityResult;
}

export interface RoleOption {
  id: string;
  name: string;
}

const LEVELS: Level[] = ["junior", "mid", "senior"];

// ---------------------------------------------------------------------------
// Person picker
// ---------------------------------------------------------------------------

function PersonPicker({
  candidates,
  currentUserId,
  roleName,
  busy,
  onChoose,
  onGrantRole,
}: {
  candidates: PickerCandidate[];
  currentUserId: string | null;
  roleName: string;
  busy: boolean;
  onChoose: (userId: string, warnings: EligibilityIssue[]) => void;
  onGrantRole: (userId: string) => void;
}) {
  const clear = candidates.filter((c) => c.result.eligible);
  const warned = candidates.filter((c) => !c.result.eligible && !c.result.blocked);
  const blocked = candidates.filter((c) => c.result.blocked);

  const row = (c: PickerCandidate) => {
    const isCurrent = c.member.id === currentUserId;
    const { result } = c;
    // A missing role is the one block with a fix: grant it and the assignment
    // becomes legal (M6 §3.2). Only offer that when it's the ONLY problem.
    const roleOnly = result.blocks.length === 1 && result.blocks[0].rule === "role";

    return (
      <div
        key={c.member.id}
        className={`flex min-h-11 items-start justify-between gap-3 rounded-xl border px-3 py-2 ${
          result.blocked
            ? "border-line bg-surface-2 opacity-70"
            : "border-line-strong bg-surface hover:border-ember"
        }`}
      >
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-ink">
            {c.member.name}
            {isCurrent && <span className="ml-1.5 text-[11px] text-ink-faint">(on now)</span>}
          </p>
          {result.issues.length > 0 && (
            <ul className="mt-0.5 space-y-0.5">
              {result.issues.map((i, n) => (
                <li
                  key={n}
                  className={`text-[11px] leading-snug ${
                    i.severity === "block" ? "text-ink-faint" : "text-[#8a6212]"
                  }`}
                >
                  {i.message}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {roleOnly && (
            <Button
              size="sm"
              variant="outline"
              className="min-h-11"
              disabled={busy}
              onClick={() => onGrantRole(c.member.id)}
              title={`Add ${roleName} to ${c.member.name}'s roles`}
            >
              Add {roleName}
            </Button>
          )}
          <Button
            size="sm"
            variant={result.eligible ? "primary" : "outline"}
            className="min-h-11"
            disabled={busy || result.blocked || isCurrent}
            onClick={() => onChoose(c.member.id, result.warnings)}
          >
            {isCurrent ? "On" : result.eligible ? "Assign" : "Assign anyway"}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Group title="Available" tone="herb" count={clear.length}>
        {clear.length === 0 ? (
          <Empty>Nobody is completely free for this shift.</Empty>
        ) : (
          clear.map(row)
        )}
      </Group>

      {warned.length > 0 && (
        <Group title="Possible, with a warning" tone="saffron" count={warned.length}>
          {warned.map(row)}
        </Group>
      )}

      {blocked.length > 0 && (
        <Group title="Can't be rostered" tone="clay" count={blocked.length}>
          {blocked.map(row)}
        </Group>
      )}
    </div>
  );
}

function Group({
  title,
  tone,
  count,
  children,
}: {
  title: string;
  tone: "herb" | "saffron" | "clay";
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">{title}</p>
        <Badge tone={tone}>{count}</Badge>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-1 py-2 text-[12px] text-ink-faint">{children}</p>;
}

// ---------------------------------------------------------------------------
// Shift editor — fill, reassign, edit, lock, remove, delete
// ---------------------------------------------------------------------------

export interface ShiftPatch {
  startAt?: string;
  endAt?: string;
  breakMinutes?: number;
  roleId?: string;
}

export function ShiftEditorModal({
  position,
  shift,
  timezone,
  roles,
  candidates,
  busy,
  published,
  onClose,
  onChoose,
  onGrantRole,
  onRemove,
  onDeletePosition,
  onEditTimes,
  onToggleLock,
  onExclude,
}: {
  position: RosterPositionRow;
  shift: ShiftRow | null;
  timezone: string;
  roles: RoleOption[];
  candidates: PickerCandidate[];
  busy: boolean;
  published: boolean;
  onClose: () => void;
  onChoose: (userId: string, warnings: EligibilityIssue[]) => void;
  onGrantRole: (userId: string, roleId: string) => void;
  onRemove: () => void;
  onDeletePosition: () => void;
  onEditTimes: (patch: ShiftPatch) => void;
  onToggleLock: (locked: boolean) => void;
  onExclude: (userId: string) => void;
}) {
  const source = shift ?? position;
  const roleName = roles.find((r) => r.id === source.role_id)?.name ?? "this role";

  const [start, setStart] = useState(wallTimeIn(source.start_at, timezone));
  const [end, setEnd] = useState(wallTimeIn(source.end_at, timezone));
  const [breakMinutes, setBreakMinutes] = useState(String(shift?.break_minutes ?? 0));
  const [roleId, setRoleId] = useState(source.role_id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [vError, setVError] = useState<string | null>(null);

  const saveTimes = () => {
    const startMin = minutesOfDay(start);
    const rawEnd = minutesOfDay(end);
    const endMin = rawEnd <= startMin ? rawEnd + 1440 : rawEnd;
    const mins = Number(breakMinutes);
    if (!Number.isInteger(mins) || mins < 0) {
      setVError("Break must be a whole number of minutes.");
      return;
    }
    if (endMin - startMin <= mins) {
      setVError("The break can't be longer than the shift.");
      return;
    }
    setVError(null);
    onEditTimes({
      startAt: zonedInstant(position.date, startMin, timezone).toISOString(),
      endAt: zonedInstant(position.date, endMin, timezone).toISOString(),
      breakMinutes: mins,
      roleId,
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth={640}
      title={shift ? "Edit shift" : "Fill this position"}
      subtitle={`${roleName} · ${formatDayLabel(position.date)} · ${wallTimeIn(source.start_at, timezone)}–${wallTimeIn(source.end_at, timezone)}${
        position.source === "manual" ? " · one-off" : ""
      }`}
      footer={
        <>
          <Button variant="ghost" size="sm" className="min-h-11" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {published && (
          <p className="rounded-lg border border-saffron/40 bg-saffron-soft/50 px-3 py-2 text-[12px] text-[#8a6212]">
            This roster is published. Any change here will be sent to the affected staff member
            when notifications go live, and is recorded in the change log either way.
          </p>
        )}

        <PersonPicker
          candidates={candidates}
          currentUserId={shift?.assigned_user_id ?? null}
          roleName={roleName}
          busy={busy}
          onChoose={onChoose}
          onGrantRole={(userId) => onGrantRole(userId, source.role_id)}
        />

        {/* ---- shift details ---- */}
        <div className="border-t border-line pt-5">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
            Times &amp; role
          </p>
          {vError && (
            <p className="mb-3 rounded-lg border border-clay/30 bg-clay/5 px-3 py-2 text-[13px] text-clay">
              {vError}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <Label htmlFor="edit-start">Start</Label>
              <Input
                id="edit-start"
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="nums"
              />
            </div>
            <div>
              <Label htmlFor="edit-end">End</Label>
              <Input
                id="edit-end"
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="nums"
              />
            </div>
            <div>
              <Label htmlFor="edit-break">Break (min)</Label>
              <Input
                id="edit-break"
                type="number"
                min={0}
                value={breakMinutes}
                onChange={(e) => setBreakMinutes(e.target.value)}
                className="nums"
                disabled={!shift}
              />
            </div>
            <div>
              <Label htmlFor="edit-role">Role</Label>
              <Select id="edit-role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" className="min-h-11" disabled={busy || !shift} onClick={saveTimes}>
              Save changes
            </Button>
            {!shift && (
              <span className="text-[12px] text-ink-faint">
                Assign someone first, then the times can be adjusted.
              </span>
            )}
          </div>
        </div>

        {/* ---- lock ---- */}
        {shift && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5">
            <div>
              <p className="text-[13px] font-medium text-ink">
                {shift.locked ? "Pinned for regeneration" : "Not pinned"}
              </p>
              <p className="text-[12px] text-ink-faint">
                Pinned shifts are kept exactly as they are when you generate again.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="min-h-11"
              disabled={busy}
              onClick={() => onToggleLock(!shift.locked)}
            >
              {shift.locked ? "Unpin" : "Pin"}
            </Button>
          </div>
        )}

        {/* ---- destructive: two clearly different things ---- */}
        <div className="space-y-2 border-t border-line pt-5">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
            Remove
          </p>
          {shift && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
              <p className="text-[13px] text-ink-soft">
                <span className="font-medium text-ink">Take this person off.</span> The shift stays
                on the roster as an unfilled position.
              </p>
              <div className="flex shrink-0 gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11"
                  disabled={busy}
                  onClick={() => shift.assigned_user_id && onExclude(shift.assigned_user_id)}
                  title="Take them off and keep the scheduler from putting them back"
                >
                  Not them
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11"
                  disabled={busy}
                  onClick={onRemove}
                >
                  Remove person
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 rounded-xl border border-clay/30 bg-clay/5 px-3 py-2.5">
            <p className="text-[13px] text-clay">
              <span className="font-semibold">Delete the requirement.</span> This shift stops being
              needed at all and disappears from the roster.
            </p>
            {confirmDelete ? (
              <div className="flex shrink-0 gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => setConfirmDelete(false)}
                >
                  Keep it
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  className="min-h-11"
                  disabled={busy}
                  onClick={onDeletePosition}
                >
                  Delete for good
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="danger"
                className="min-h-11 shrink-0"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                <IconTrash width={14} height={14} /> Delete position
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Add a one-off position
// ---------------------------------------------------------------------------

export interface NewPositionDraft {
  date: string;
  roleId: string;
  locationId: string;
  start: string;
  end: string;
  requiredLevel: Level | null;
  label: string | null;
}

export function AddPositionModal({
  dates,
  roles,
  locations,
  busy,
  onClose,
  onAdd,
}: {
  dates: string[];
  roles: RoleOption[];
  locations: { id: string; name: string }[];
  busy: boolean;
  onClose: () => void;
  onAdd: (draft: NewPositionDraft) => void;
}) {
  const [date, setDate] = useState(dates[0] ?? "");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [start, setStart] = useState("17:00");
  const [end, setEnd] = useState("23:00");
  const [requiredLevel, setRequiredLevel] = useState<string>("");
  const [label, setLabel] = useState("");
  const [vError, setVError] = useState<string | null>(null);

  const submit = () => {
    if (!date || !roleId || !locationId) {
      setVError("Pick a day, a role and a location.");
      return;
    }
    if (minutesOfDay(start) === minutesOfDay(end)) {
      setVError("Start and end can't be the same time.");
      return;
    }
    setVError(null);
    onAdd({
      date,
      roleId,
      locationId,
      start,
      end,
      requiredLevel: (requiredLevel || null) as Level | null,
      label: label.trim() || null,
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth={520}
      title="Add a one-off position"
      subtitle="A requirement for this roster only — your week template isn't changed."
      footer={
        <>
          <Button variant="ghost" size="sm" className="min-h-11" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" className="min-h-11" onClick={submit} disabled={busy}>
            {busy ? "Adding…" : "Add position"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {vError && (
          <p className="rounded-lg border border-clay/30 bg-clay/5 px-3 py-2 text-[13px] text-clay">
            {vError}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="np-date">Day</Label>
            <Select id="np-date" value={date} onChange={(e) => setDate(e.target.value)}>
              {dates.map((d) => (
                <option key={d} value={d}>
                  {formatDayLabel(d)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="np-role">Role</Label>
            <Select id="np-role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="np-start">Start</Label>
            <Input
              id="np-start"
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="nums"
            />
          </div>
          <div>
            <Label htmlFor="np-end">End</Label>
            <Input
              id="np-end"
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="nums"
            />
          </div>
          {locations.length > 1 && (
            <div>
              <Label htmlFor="np-loc">Location</Label>
              <Select
                id="np-loc"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="np-level">Required level</Label>
            <Select
              id="np-level"
              value={requiredLevel}
              onChange={(e) => setRequiredLevel(e.target.value)}
            >
              <option value="">Any level</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {LEVEL_LABEL[l]} or above
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="np-label">Note (optional)</Label>
          <Input
            id="np-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. function upstairs, extra cover"
          />
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Regenerate
// ---------------------------------------------------------------------------

export const PRIORITY_PRESETS: { id: string; label: string; order: string[]; blurb: string }[] = [
  {
    id: "fairness",
    label: "Share hours evenly",
    order: ["fairness", "cost", "preferences", "consistency"],
    blurb: "Spreads hours as evenly as the rules allow.",
  },
  {
    id: "cost",
    label: "Keep cost down",
    order: ["cost", "fairness", "preferences", "consistency"],
    blurb: "Favours lower-cost staffing where the rules allow it.",
  },
  {
    id: "preferences",
    label: "Follow staff preferences",
    order: ["preferences", "fairness", "cost", "consistency"],
    blurb: "Leans towards preferred days and times.",
  },
];

export function RegenerateModal({
  presetId,
  onPreset,
  manualUnlocked,
  lockedCount,
  exclusions,
  memberName,
  busy,
  onClearExclusion,
  onLockManualEdits,
  onClose,
  onRegenerate,
}: {
  presetId: string;
  onPreset: (id: string) => void;
  manualUnlocked: number;
  lockedCount: number;
  exclusions: { position_id: string; user_id: string }[];
  memberName: (id: string) => string;
  busy: boolean;
  onClearExclusion: (positionId: string, userId: string) => void;
  onLockManualEdits: () => void;
  onClose: () => void;
  onRegenerate: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      maxWidth={560}
      title="Generate again"
      subtitle="Pinned shifts are kept exactly; everything else is re-solved."
      footer={
        <>
          <Button variant="ghost" size="sm" className="min-h-11" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" className="min-h-11" onClick={onRegenerate} disabled={busy}>
            {busy ? "Generating…" : "Generate"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
            What matters most
          </p>
          <div className="space-y-1.5">
            {PRIORITY_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => onPreset(p.id)}
                className={`flex min-h-11 w-full flex-col items-start rounded-xl border px-3 py-2 text-left transition ${
                  presetId === p.id
                    ? "border-ember bg-ember-soft"
                    : "border-line-strong bg-surface hover:border-ink-faint"
                }`}
              >
                <span className="text-[13px] font-medium text-ink">{p.label}</span>
                <span className="text-[11px] text-ink-soft">{p.blurb}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[13px]">
          <p className="text-ink-soft">
            <span className="nums font-semibold text-ink">{lockedCount}</span> pinned{" "}
            {lockedCount === 1 ? "shift is" : "shifts are"} kept exactly as they are.
          </p>
          {manualUnlocked > 0 && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
              <p className="text-clay">
                <span className="nums font-semibold">{manualUnlocked}</span> of your own{" "}
                {manualUnlocked === 1 ? "edit is" : "edits are"} not pinned and{" "}
                <span className="font-semibold">will be overwritten</span>.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="min-h-11"
                onClick={onLockManualEdits}
                disabled={busy}
              >
                Pin them first
              </Button>
            </div>
          )}
        </div>

        {exclusions.length > 0 && (
          <div>
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
              Kept off
            </p>
            <div className="space-y-1.5">
              {exclusions.map((x) => (
                <div
                  key={`${x.position_id}:${x.user_id}`}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-[13px]"
                >
                  <span className="text-ink-soft">
                    {memberName(x.user_id)} won&rsquo;t be put back on that shift.
                  </span>
                  <button
                    onClick={() => onClearExclusion(x.position_id, x.user_id)}
                    className="min-h-11 px-2 text-[12px] font-semibold text-ink-faint underline hover:text-ink"
                  >
                    Undo
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

export function PublishModal({
  periodLabel,
  filled,
  total,
  unfilled,
  coverageGaps,
  staffCount,
  cost,
  hours,
  busy,
  onClose,
  onPublish,
}: {
  periodLabel: string;
  filled: number;
  total: number;
  unfilled: number;
  coverageGaps: number;
  staffCount: number;
  cost: number;
  hours: number;
  busy: boolean;
  onClose: () => void;
  onPublish: () => void;
}) {
  const empty = filled === 0;
  const [confirmedEmpty, setConfirmedEmpty] = useState(false);

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth={520}
      title={`Publishing ${periodLabel}`}
      subtitle="Staff will be able to see their own shifts."
      footer={
        <>
          <Button variant="ghost" size="sm" className="min-h-11" onClick={onClose}>
            Not yet
          </Button>
          <Button
            size="sm"
            className="min-h-11"
            onClick={onPublish}
            disabled={busy || (empty && !confirmedEmpty)}
          >
            {busy ? "Publishing…" : unfilled > 0 ? "Publish anyway" : "Publish"}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-[13px]">
        <Card className="p-3">
          <p className="nums text-ink-soft">
            <span className="font-semibold text-ink">
              {filled} of {total}
            </span>{" "}
            positions filled · <span className="font-semibold text-ink">{unfilled}</span> unfilled ·{" "}
            <span className="font-semibold text-ink">{coverageGaps}</span>{" "}
            {coverageGaps === 1 ? "coverage gap" : "coverage gaps"} ·{" "}
            <span className="font-semibold text-ink">{staffCount}</span> staff ·{" "}
            <span className="font-semibold text-ink">{formatHours(hours)}</span>
          </p>
          <p className="nums mt-1 font-display text-lg font-semibold text-ink">
            Est. {formatMoney(cost)}
          </p>
          <p className="mt-0.5 text-[11px] text-ink-faint">{COST_DISCLAIMER}</p>
        </Card>

        {unfilled > 0 && (
          <p className="rounded-lg border border-saffron/40 bg-saffron-soft/50 px-3 py-2 text-[#8a6212]">
            {unfilled} unfilled {unfilled === 1 ? "position" : "positions"} will not be visible to
            staff. You can keep chasing cover and fill them after publishing.
          </p>
        )}

        {empty && (
          <label className="flex items-start gap-2 rounded-lg border border-clay/30 bg-clay/5 px-3 py-2 text-clay">
            <input
              type="checkbox"
              checked={confirmedEmpty}
              onChange={(e) => setConfirmedEmpty(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              Nobody is rostered at all. I&rsquo;m sure I want to publish an empty roster.
            </span>
          </label>
        )}
      </div>
    </Modal>
  );
}
