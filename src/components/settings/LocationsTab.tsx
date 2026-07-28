"use client";

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Badge, Button, Card, Input, Label, Modal } from "@/components/ui";
import { IconPin, IconPlus } from "@/components/icons";
import { ErrorPanel, IssueList, LoadingPanel, SectionCard, WriteError } from "./shared";
import { checkLocationDeactivation, type SettingsIssue } from "@/lib/domain/settings-validation";
import {
  countFutureShiftsForLocation,
  createLocation,
  fetchLocations,
  setLocationActive,
  updateLocation,
  type LocationRow,
} from "@/lib/supabase/settings";
import { todayISO } from "@/lib/utils";

interface EditState {
  id: string | null; // null = creating
  name: string;
  address: string;
}

interface ConfirmState {
  location: LocationRow;
  issues: SettingsIssue[];
}

/** M1 §3.2 — one or more sites; the business always keeps one active. */
export function LocationsTab() {
  const { session, refresh } = useStore();
  const [rows, setRows] = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [issues, setIssues] = useState<SettingsIssue[]>([]);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setRows(await fetchLocations());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load your locations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setState runs after the await, never during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const summaries = rows.map((r) => ({ id: r.id, name: r.name, active: r.active }));

  /** Optimistic active/inactive flip that rolls back visibly on failure. */
  const applyActive = async (location: LocationRow, active: boolean) => {
    const previous = rows;
    setBusyId(location.id);
    setWriteError(null);
    setRows((prev) => prev.map((r) => (r.id === location.id ? { ...r, active } : r)));
    try {
      await setLocationActive(location.id, active);
      await refresh();
    } catch (e) {
      setRows(previous); // visible rollback
      setWriteError(
        e instanceof Error
          ? e.message
          : `Couldn't ${active ? "turn on" : "turn off"} ${location.name}. Nothing was changed.`,
      );
    } finally {
      setBusyId(null);
    }
  };

  const requestDeactivate = async (location: LocationRow) => {
    setIssues([]);
    setWriteError(null);
    setBusyId(location.id);
    try {
      // Ask the DB how much future work is attached before deciding (M1 §6).
      const futureShifts = await countFutureShiftsForLocation(location.id, todayISO());
      const check = checkLocationDeactivation(location.id, summaries, futureShifts);
      if (!check.allowed) {
        setIssues(check.issues);
        return;
      }
      if (check.requiresConfirmation) {
        setConfirm({ location, issues: check.issues });
        return;
      }
      await applyActive(location, false);
    } catch (e) {
      setWriteError(e instanceof Error ? e.message : "Couldn't check that location. Try again.");
    } finally {
      setBusyId(null);
    }
  };

  const saveEdit = async (draft: EditState) => {
    if (!session.businessId) throw new Error("No business loaded.");
    if (draft.id) {
      await updateLocation(draft.id, { name: draft.name, address: draft.address });
    } else {
      await createLocation(session.businessId, { name: draft.name, address: draft.address });
    }
    await load();
    await refresh();
  };

  if (loading) return <LoadingPanel label="Loading locations…" />;
  if (loadError) return <ErrorPanel message={loadError} onRetry={() => void load()} />;

  const activeCount = rows.filter((r) => r.active).length;

  return (
    <div className="space-y-5">
      <SectionCard
        title="Locations"
        description="The sites you roster. Turning a location off keeps all its past rosters — it just stops appearing when you build new ones."
        footer={
          <Button
            className="h-11"
            onClick={() => setEdit({ id: null, name: "", address: "" })}
          >
            <IconPlus width={16} height={16} /> Add location
          </Button>
        }
      >
        {writeError && <WriteError message={writeError} />}
        <IssueList issues={issues} />

        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-faint">
            No locations yet. Add your first one — rosters need somewhere to happen.
          </p>
        ) : (
          <ul className="space-y-3">
            {rows.map((l) => {
              const isLastActive = l.active && activeCount === 1;
              return (
                <li key={l.id}>
                  <Card className={`p-4 ${l.active ? "" : "opacity-60"}`}>
                    <div className="flex flex-wrap items-start gap-3">
                      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-faint">
                        <IconPin width={17} height={17} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-display text-base font-semibold leading-tight text-ink">
                          {l.name}
                          {l.active ? (
                            <Badge tone="herb">Active</Badge>
                          ) : (
                            <Badge tone="muted">Off</Badge>
                          )}
                        </p>
                        <p className="mt-0.5 text-[13px] text-ink-soft">{l.address || "No address"}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setEdit({ id: l.id, name: l.name, address: l.address ?? "" })
                          }
                          className="min-h-11 rounded-lg px-3 text-[13px] font-medium text-ink-soft transition hover:bg-paper-deep hover:text-ink"
                        >
                          Edit
                        </button>
                        {l.active ? (
                          <button
                            type="button"
                            disabled={busyId === l.id || isLastActive}
                            title={
                              isLastActive
                                ? "This is your only active location — add another first."
                                : undefined
                            }
                            onClick={() => void requestDeactivate(l)}
                            className="min-h-11 rounded-lg px-3 text-[13px] font-medium text-clay transition hover:bg-clay/10 disabled:opacity-40"
                          >
                            {busyId === l.id ? "Checking…" : "Turn off"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busyId === l.id}
                            onClick={() => void applyActive(l, true)}
                            className="min-h-11 rounded-lg px-3 text-[13px] font-medium text-herb transition hover:bg-herb-soft disabled:opacity-40"
                          >
                            {busyId === l.id ? "Working…" : "Turn on"}
                          </button>
                        )}
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {edit && (
        <LocationModal
          draft={edit}
          onClose={() => setEdit(null)}
          onSave={saveEdit}
        />
      )}

      {confirm && (
        <Modal
          open
          onClose={() => setConfirm(null)}
          title={`Turn off ${confirm.location.name}?`}
          subtitle="Nothing is deleted — this only affects new rosters."
          footer={
            <>
              <Button variant="ghost" className="h-11" onClick={() => setConfirm(null)}>
                Keep it on
              </Button>
              <Button
                variant="danger"
                className="h-11"
                onClick={() => {
                  const target = confirm.location;
                  setConfirm(null);
                  void applyActive(target, false);
                }}
              >
                Turn it off
              </Button>
            </>
          }
        >
          <IssueList issues={confirm.issues} />
        </Modal>
      )}
    </div>
  );
}

function LocationModal({
  draft,
  onClose,
  onSave,
}: {
  draft: EditState;
  onClose: () => void;
  onSave: (draft: EditState) => Promise<void>;
}) {
  const [name, setName] = useState(draft.name);
  const [address, setAddress] = useState(draft.address);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim().length > 1;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({ ...draft, name, address });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that location. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={draft.id ? "Edit location" : "Add location"}
      subtitle={draft.id ? undefined : "A name is all you need — the address is optional."}
      footer={
        <>
          <Button variant="ghost" className="h-11" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button className="h-11" onClick={submit} disabled={!valid || busy}>
            {busy ? "Saving…" : draft.id ? "Save changes" : "Add location"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="loc-name">Name</Label>
          <Input
            id="loc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Regents Park"
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor="loc-address">Address (optional)</Label>
          <Input
            id="loc-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="e.g. 12 Amy St, Regents Park NSW"
          />
          <p className="mt-1 text-[12px] text-ink-faint">Display only — nothing is sent anywhere.</p>
        </div>
        {error && <WriteError message={error} onRetry={submit} />}
      </div>
    </Modal>
  );
}
