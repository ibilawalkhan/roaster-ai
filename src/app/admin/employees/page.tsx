"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { TeamMemberModal } from "@/components/TeamMemberModal";
import { Avatar, Badge, Button, Card } from "@/components/ui";
import { IconEdit, IconMail, IconPhone, IconPlus, IconUsers } from "@/components/icons";
import {
  INVITE_LABEL,
  LEVEL_LABEL,
  EMPLOYMENT_LABEL,
  type Level,
  type TeamMember,
} from "@/lib/types";
import { formatMoney } from "@/lib/utils";

export default function TeamPage() {
  const { team, roles, locations, setMemberActive, inviteMember } = useStore();

  const [levelFilter, setLevelFilter] = useState<Level | "all">("all");
  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal] = useState<{ member?: TeamMember } | null>(null);

  const roleName = (id: string | null) => roles.find((r) => r.id === id)?.name ?? "—";
  const locationName = (id: string | null) => locations.find((l) => l.id === id)?.name ?? "—";

  const list = useMemo(
    () =>
      team
        .filter((m) => (showInactive ? true : m.active))
        .filter((m) => levelFilter === "all" || m.level === levelFilter)
        .sort(
          (a, b) =>
            Number(b.active) - Number(a.active) || a.name.localeCompare(b.name),
        ),
    [team, levelFilter, showInactive],
  );

  const activeCount = team.filter((m) => m.active).length;
  const seniorCount = team.filter((m) => m.active && m.level === "senior").length;

  return (
    <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Team</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {activeCount} active · {seniorCount} senior{seniorCount === 1 ? "" : "s"}
          </p>
        </div>
        <Button onClick={() => setModal({})}>
          <IconPlus width={16} height={16} /> Add member
        </Button>
      </header>

      {seniorCount === 0 && activeCount > 0 && (
        <div className="rise mt-4 rounded-xl border border-saffron/40 bg-saffron-soft/50 px-4 py-2.5 text-[13px] text-[#8a6212]">
          No active Senior on the team — rosters that require senior coverage won&rsquo;t generate.
        </div>
      )}

      {/* Filters */}
      <div className="rise mt-5 flex flex-wrap items-center gap-2" style={{ animationDelay: "60ms" }}>
        <div className="inline-flex rounded-[11px] border border-line bg-surface p-1 shadow-soft">
          {(["all", "junior", "mid", "senior"] as const).map((o) => (
            <button
              key={o}
              onClick={() => setLevelFilter(o)}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-medium capitalize transition ${
                levelFilter === o ? "bg-charcoal text-paper" : "text-ink-soft hover:text-ink"
              }`}
            >
              {o === "all" ? "All levels" : o}
            </button>
          ))}
        </div>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-ember)]"
          />
          Show inactive
        </label>
      </div>

      {/* Cards */}
      <div className="rise mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3" style={{ animationDelay: "100ms" }}>
        {list.map((m) => (
          <Card key={m.id} className={`p-5 transition ${m.active ? "" : "opacity-60"}`}>
            <div className="flex items-start gap-3">
              <Avatar name={m.name} accent={m.colour} size={48} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-lg font-semibold leading-tight text-ink">
                  {m.name}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone="neutral">{roleName(m.primaryRoleId)}</Badge>
                  <Badge tone={m.level === "senior" ? "ember" : m.level === "mid" ? "herb" : "muted"}>
                    {LEVEL_LABEL[m.level]}
                  </Badge>
                  {m.isManager && <Badge tone="saffron">Manager</Badge>}
                </div>
              </div>
              <button
                onClick={() => setModal({ member: m })}
                className="grid h-8 w-8 place-items-center rounded-lg text-ink-faint transition hover:bg-paper-deep hover:text-ink"
                aria-label="Edit"
              >
                <IconEdit width={17} height={17} />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-surface-2 p-3 text-center">
              <Metric label="Rate" value={`${formatMoney(m.payRate)}`} />
              <Metric label="Type" value={EMPLOYMENT_LABEL[m.employmentType]} />
              <Metric label="Roles" value={String(m.roleIds.length)} />
            </div>

            <div className="mt-3 space-y-1 text-[13px] text-ink-soft">
              <p className="flex items-center gap-2">
                <IconPhone width={14} height={14} className="text-ink-faint" />
                {m.phone || "—"}
              </p>
              <p className="flex items-center gap-2 truncate">
                <IconMail width={14} height={14} className="text-ink-faint" />
                <span className="truncate">{m.email || "—"}</span>
              </p>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
              <span className="flex items-center gap-2 text-[12px] font-medium text-ink-faint">
                {locationName(m.homeLocationId)}
                <span className="text-line-strong">·</span>
                <span className={m.inviteStatus === "active" ? "text-herb" : ""}>
                  {INVITE_LABEL[m.inviteStatus]}
                </span>
              </span>
              <div className="flex items-center gap-3">
                {m.active && m.inviteStatus === "not_invited" && (
                  <button
                    onClick={() => inviteMember(m.id)}
                    className="text-[13px] font-medium text-ember hover:underline"
                  >
                    Invite
                  </button>
                )}
                {m.active ? (
                  <button
                    onClick={() => setMemberActive(m.id, false)}
                    className="text-[13px] font-medium text-clay hover:underline"
                  >
                    Deactivate
                  </button>
                ) : (
                  <button
                    onClick={() => setMemberActive(m.id, true)}
                    className="text-[13px] font-medium text-herb hover:underline"
                  >
                    Reactivate
                  </button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {list.length === 0 && (
        <div className="mt-10 flex flex-col items-center gap-3 text-center">
          <IconUsers width={32} height={32} className="text-ink-faint" />
          <p className="text-sm text-ink-faint">No team members yet. Add your first one to get started.</p>
        </div>
      )}

      {modal && (
        <TeamMemberModal open onClose={() => setModal(null)} member={modal.member} />
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="nums truncate text-sm font-bold text-ink">{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</p>
    </div>
  );
}
