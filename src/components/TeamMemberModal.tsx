"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { Button, Input, Label, Modal, Select } from "@/components/ui";
import {
  EMPLOYMENT_LABEL,
  EMPLOYMENT_TYPES,
  LEVELS,
  LEVEL_LABEL,
  type EmploymentType,
  type Level,
  type TeamMember,
} from "@/lib/types";
import { ACCENT_KEYS, accentOf } from "@/lib/utils";

export function TeamMemberModal({
  open,
  onClose,
  member,
}: {
  open: boolean;
  onClose: () => void;
  member?: TeamMember;
}) {
  const { addMember, updateMember, roles, locations } = useStore();
  const isEdit = !!member;
  const activeRoles = roles.filter((r) => r.active);
  const activeLocations = locations.filter((l) => l.active);

  const [name, setName] = useState(member?.name ?? "");
  const [phone, setPhone] = useState(member?.phone ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  const [roleIds, setRoleIds] = useState<string[]>(member?.roleIds ?? []);
  const [primaryRoleId, setPrimaryRoleId] = useState<string | null>(
    member?.primaryRoleId ?? null,
  );
  const [level, setLevel] = useState<Level>(member?.level ?? "mid");
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    member?.employmentType ?? "casual",
  );
  const [homeLocationId, setHomeLocationId] = useState<string | null>(
    member?.homeLocationId ?? activeLocations[0]?.id ?? null,
  );
  const [payRate, setPayRate] = useState(String(member?.payRate ?? ""));
  const [colour, setColour] = useState(member?.colour ?? ACCENT_KEYS[0]);
  const [isManager, setIsManager] = useState(member?.isManager ?? false);
  const [showMore, setShowMore] = useState(false);
  const [maxHours, setMaxHours] = useState(
    member?.maxHoursWeek != null ? String(member.maxHoursWeek) : "",
  );
  const [minHours, setMinHours] = useState(
    member?.minHoursWeek != null ? String(member.minHoursWeek) : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The 60-second path: name + mobile is enough. Everything else defaults
  // (rate 0, no roles yet) — the manager can fill it in later (M2 §4.2).
  const rate = payRate.trim() === "" ? 0 : parseFloat(payRate);
  const rolesValid = roleIds.length === 0 || (!!primaryRoleId && roleIds.includes(primaryRoleId));
  const valid =
    name.trim().length > 1 &&
    phone.trim().length >= 6 &&
    rolesValid &&
    !isNaN(rate) &&
    rate >= 0;

  const primaryOptions = useMemo(
    () => activeRoles.filter((r) => roleIds.includes(r.id)),
    [activeRoles, roleIds],
  );

  const toggleRole = (id: string) => {
    setRoleIds((prev) => {
      const next = prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id];
      // Keep primary valid: default to first selected, clear if none.
      if (!next.includes(primaryRoleId ?? "")) setPrimaryRoleId(next[0] ?? null);
      return next;
    });
  };

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        roleIds,
        primaryRoleId,
        level,
        employmentType,
        homeLocationId,
        payRate: rate,
        colour,
        isManager,
        maxHoursWeek: maxHours === "" ? null : Number(maxHours),
        minHoursWeek: minHours === "" ? 0 : Number(minHours),
      };
      if (member) await updateMember(member.id, payload);
      else await addMember(payload);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit team member" : "Add team member"}
      subtitle={isEdit ? member!.name : "Name and mobile are all you need to start"}
      maxWidth={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid || busy}>
            {busy ? "Saving…" : isEdit ? "Save changes" : "Add member"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {activeRoles.length === 0 && (
          <p className="rounded-lg border border-saffron/40 bg-saffron-soft/50 px-3 py-2 text-[13px] text-[#8a6212]">
            No job roles exist yet. Add roles in Settings first so people can be assigned work.
          </p>
        )}

        {/* Core: the 60-second path */}
        <div>
          <Label htmlFor="name">Full name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sara Haddad" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="phone">Mobile</Label>
            <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="04xx xxx xxx" />
          </div>
          <div>
            <Label htmlFor="email">Email (optional)</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          </div>
        </div>

        {/* Capability */}
        <div>
          <Label>Roles they can work</Label>
          <div className="flex flex-wrap gap-2">
            {activeRoles.map((r) => {
              const on = roleIds.includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggleRole(r.id)}
                  className={`rounded-full border px-3 py-1.5 text-[13px] font-medium transition ${
                    on
                      ? "border-ember bg-ember-soft text-ember-deep"
                      : "border-line bg-surface text-ink-soft hover:border-ink-faint"
                  }`}
                >
                  {r.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="primary">Primary role</Label>
            <Select
              id="primary"
              value={primaryRoleId ?? ""}
              onChange={(e) => setPrimaryRoleId(e.target.value || null)}
              disabled={primaryOptions.length === 0}
            >
              <option value="">Select…</option>
              {primaryOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="level">Level</Label>
            <Select id="level" value={level} onChange={(e) => setLevel(e.target.value as Level)}>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {LEVEL_LABEL[l]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="emp">Employment</Label>
            <Select id="emp" value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}>
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EMPLOYMENT_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="loc">Home location</Label>
            <Select id="loc" value={homeLocationId ?? ""} onChange={(e) => setHomeLocationId(e.target.value || null)}>
              <option value="">Select…</option>
              {activeLocations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="rate">Pay rate (AUD/hr)</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-ink-faint">$</span>
              <Input id="rate" type="number" min="0" step="0.5" value={payRate} onChange={(e) => setPayRate(e.target.value)} className="nums pl-7" placeholder="0.00" />
            </div>
            <p className="mt-1 text-[11px] text-ink-faint">For labour-cost estimates only — not payroll.</p>
          </div>
          <div>
            <Label>Roster colour</Label>
            <div className="flex flex-wrap gap-2 pt-1">
              {ACCENT_KEYS.map((key) => {
                const a = accentOf(key);
                const on = colour === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setColour(key)}
                    className={`h-7 w-7 rounded-full transition ${on ? "ring-2 ring-offset-2 ring-offset-surface" : ""}`}
                    style={{ backgroundColor: a.dot, ...(on ? ({ "--tw-ring-color": a.dot } as React.CSSProperties) : {}) }}
                    aria-label={key}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Progressive disclosure: limits + access */}
        <button
          type="button"
          onClick={() => setShowMore((s) => !s)}
          className="text-[13px] font-medium text-ember hover:underline"
        >
          {showMore ? "Hide" : "More options (hours, access)"}
        </button>
        {showMore && (
          <div className="space-y-4 rounded-xl bg-surface-2 p-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="maxh">Max hours / week</Label>
                <Input id="maxh" type="number" min="0" value={maxHours} onChange={(e) => setMaxHours(e.target.value)} placeholder="inherit from type" />
              </div>
              <div>
                <Label htmlFor="minh">Min hours / week</Label>
                <Input id="minh" type="number" min="0" value={minHours} onChange={(e) => setMinHours(e.target.value)} placeholder="0" />
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink">
              <input type="checkbox" checked={isManager} onChange={(e) => setIsManager(e.target.checked)} className="h-4 w-4 accent-[var(--color-ember)]" />
              Manager — can build rosters, manage staff and see all costs
            </label>
          </div>
        )}

        {error && (
          <p className="rounded-lg border border-clay/30 bg-clay/5 px-3 py-2 text-[13px] text-clay">{error}</p>
        )}
      </div>
    </Modal>
  );
}
