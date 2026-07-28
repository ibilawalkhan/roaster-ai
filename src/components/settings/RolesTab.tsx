"use client";

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Badge, Button, Card, Input, Label, Modal } from "@/components/ui";
import { IconPlus } from "@/components/icons";
import { ErrorPanel, IssueList, LoadingPanel, SectionCard, WriteError } from "./shared";
import { checkRoleDeletion, type SettingsIssue } from "@/lib/domain/settings-validation";
import {
  countRoleReferences,
  createRole,
  deleteRole,
  fetchRoles,
  setRoleActive,
  updateRole,
  type RoleRow,
} from "@/lib/supabase/settings";
import { ACCENT_KEYS, accentOf } from "@/lib/utils";

interface EditState {
  id: string | null;
  name: string;
  shortCode: string;
  colour: string;
}

/** M1 §3.4 — the jobs people do. Editable per business, never a fixed set. */
export function RolesTab() {
  const { session, refresh } = useStore();
  const [rows, setRows] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [issues, setIssues] = useState<SettingsIssue[]>([]);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RoleRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setRows(await fetchRoles());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load your roles.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /** Optimistic flip with a visible rollback (CLAUDE.md rule 6). */
  const applyActive = async (role: RoleRow, active: boolean) => {
    const previous = rows;
    setBusyId(role.id);
    setWriteError(null);
    setIssues([]);
    setRows((prev) => prev.map((r) => (r.id === role.id ? { ...r, active } : r)));
    try {
      await setRoleActive(role.id, active);
      await refresh();
    } catch (e) {
      setRows(previous);
      setWriteError(
        e instanceof Error
          ? e.message
          : `Couldn't ${active ? "turn on" : "turn off"} ${role.name}. Nothing was changed.`,
      );
    } finally {
      setBusyId(null);
    }
  };

  const requestDelete = async (role: RoleRow) => {
    setIssues([]);
    setWriteError(null);
    setBusyId(role.id);
    try {
      const usage = await countRoleReferences(role.id);
      const check = checkRoleDeletion(role.name, usage);
      if (!check.allowed) {
        setIssues(check.issues);
        return;
      }
      setConfirmDelete(role);
    } catch (e) {
      setWriteError(e instanceof Error ? e.message : "Couldn't check that role. Try again.");
    } finally {
      setBusyId(null);
    }
  };

  const doDelete = async (role: RoleRow) => {
    setBusyId(role.id);
    setWriteError(null);
    try {
      await deleteRole(role.id);
      await load();
      await refresh();
    } catch (e) {
      setWriteError(
        e instanceof Error ? e.message : `Couldn't delete ${role.name}. Nothing was changed.`,
      );
    } finally {
      setBusyId(null);
    }
  };

  const saveEdit = async (draft: EditState) => {
    if (!session.businessId) throw new Error("No business loaded.");
    if (draft.id) {
      await updateRole(draft.id, {
        name: draft.name,
        shortCode: draft.shortCode,
        colour: draft.colour,
      });
    } else {
      await createRole(session.businessId, {
        name: draft.name,
        shortCode: draft.shortCode,
        colour: draft.colour,
      });
    }
    await load();
    await refresh();
  };

  if (loading) return <LoadingPanel label="Loading roles…" />;
  if (loadError) return <ErrorPanel message={loadError} onRetry={() => void load()} />;

  return (
    <div className="space-y-5">
      <SectionCard
        title="Roles"
        description="The jobs your team does — Kitchen, Front of House, Driver and so on. Every shift is for one role, and people can be qualified for several."
        footer={
          <Button
            className="h-11"
            onClick={() => setEdit({ id: null, name: "", shortCode: "", colour: ACCENT_KEYS[0] })}
          >
            <IconPlus width={16} height={16} /> Add role
          </Button>
        }
      >
        {writeError && <WriteError message={writeError} />}
        <IssueList issues={issues} />

        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-faint">
            No roles yet. Add the jobs people do so shifts have something to ask for.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {rows.map((r) => {
              const a = accentOf(r.colour ?? "ember");
              return (
                <li key={r.id}>
                  <Card className={`p-4 ${r.active ? "" : "opacity-60"}`}>
                    <div className="flex items-start gap-3">
                      <span
                        className="mt-1 h-4 w-4 shrink-0 rounded-full"
                        style={{ backgroundColor: a.dot }}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-display text-base font-semibold leading-tight text-ink">
                          {r.name}
                          {r.short_code && <Badge tone="neutral">{r.short_code}</Badge>}
                          {!r.active && <Badge tone="muted">Off</Badge>}
                        </p>
                        <p className="mt-0.5 text-[12px] text-ink-faint">
                          {r.active
                            ? "Can be assigned to new shifts."
                            : "Kept for history; can't be assigned to new shifts."}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-line pt-2">
                      <button
                        type="button"
                        onClick={() =>
                          setEdit({
                            id: r.id,
                            name: r.name,
                            shortCode: r.short_code ?? "",
                            colour: r.colour ?? ACCENT_KEYS[0],
                          })
                        }
                        className="min-h-11 rounded-lg px-3 text-[13px] font-medium text-ink-soft transition hover:bg-paper-deep hover:text-ink"
                      >
                        Edit
                      </button>
                      {r.active ? (
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => void applyActive(r, false)}
                          className="min-h-11 rounded-lg px-3 text-[13px] font-medium text-clay transition hover:bg-clay/10 disabled:opacity-40"
                        >
                          Turn off
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => void applyActive(r, true)}
                          className="min-h-11 rounded-lg px-3 text-[13px] font-medium text-herb transition hover:bg-herb-soft disabled:opacity-40"
                        >
                          Turn on
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => void requestDelete(r)}
                        className="ml-auto min-h-11 rounded-lg px-3 text-[13px] font-medium text-ink-faint transition hover:text-clay disabled:opacity-40"
                      >
                        {busyId === r.id ? "Checking…" : "Delete"}
                      </button>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-[13px] text-ink-soft">
          A role that anyone holds, or that any template or roster uses, can&rsquo;t be deleted —
          turn it off instead. Past rosters and costs always stay exactly as they were.
        </p>
      </SectionCard>

      {edit && <RoleModal draft={edit} onClose={() => setEdit(null)} onSave={saveEdit} />}

      {confirmDelete && (
        <Modal
          open
          onClose={() => setConfirmDelete(null)}
          title={`Delete ${confirmDelete.name}?`}
          subtitle="Nothing uses this role, so it can be removed completely."
          footer={
            <>
              <Button variant="ghost" className="h-11" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                className="h-11"
                onClick={() => {
                  const target = confirmDelete;
                  setConfirmDelete(null);
                  void doDelete(target);
                }}
              >
                Delete role
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-soft">
            You can always add it again later. If you&rsquo;d rather keep it around, turn it off
            instead.
          </p>
        </Modal>
      )}
    </div>
  );
}

function RoleModal({
  draft,
  onClose,
  onSave,
}: {
  draft: EditState;
  onClose: () => void;
  onSave: (draft: EditState) => Promise<void>;
}) {
  const [name, setName] = useState(draft.name);
  const [shortCode, setShortCode] = useState(draft.shortCode);
  const [colour, setColour] = useState(draft.colour);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const code = shortCode.trim();
  const codeValid = code.length === 0 || (code.length >= 2 && code.length <= 4);
  const valid = name.trim().length > 1 && codeValid;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({ ...draft, name, shortCode, colour });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that role. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={draft.id ? "Edit role" : "Add role"}
      footer={
        <>
          <Button variant="ghost" className="h-11" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button className="h-11" onClick={submit} disabled={!valid || busy}>
            {busy ? "Saving…" : draft.id ? "Save changes" : "Add role"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="role-name">Name</Label>
          <Input
            id="role-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Front of House"
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor="role-code">Short code (optional)</Label>
          <Input
            id="role-code"
            value={shortCode}
            onChange={(e) => setShortCode(e.target.value.toUpperCase())}
            placeholder="FOH"
            maxLength={4}
          />
          <p className="mt-1 text-[12px] text-ink-faint">
            2–4 letters, used in the tight roster grid where the full name won&rsquo;t fit.
          </p>
          {!codeValid && (
            <p className="mt-1 text-[12px] text-clay">Use 2 to 4 letters, or leave it blank.</p>
          )}
        </div>
        <div>
          <Label>Colour</Label>
          <div className="flex flex-wrap gap-2 pt-1">
            {ACCENT_KEYS.map((key) => {
              const a = accentOf(key);
              const on = colour === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setColour(key)}
                  aria-label={key}
                  aria-pressed={on}
                  className={`grid h-11 w-11 place-items-center rounded-full transition ${
                    on ? "bg-paper-deep" : ""
                  }`}
                >
                  <span
                    className="h-7 w-7 rounded-full"
                    style={{
                      backgroundColor: a.dot,
                      boxShadow: on ? `0 0 0 2px var(--color-surface), 0 0 0 4px ${a.dot}` : undefined,
                    }}
                  />
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[12px] text-ink-faint">
            Helps you scan the roster grid. Colour is never the only signal — the name is always
            shown too.
          </p>
        </div>
        {error && <WriteError message={error} onRetry={submit} />}
      </div>
    </Modal>
  );
}
