import { describe, expect, it } from "vitest";
import {
  GRACE_MINUTES,
  reconcileChangeLog,
  type ChangeLogEntry,
} from "../../src/lib/domain/notification-reconcile";

/**
 * M9 §3 — at-least-once reconciliation. The live notify path runs after the
 * action commits, so a crash between the two loses the message. These pin the
 * mapping that catches it, and the de-duplication that stops a resend.
 */

const NOW = new Date("2026-08-14T12:00:00Z");
/** Comfortably outside the grace window, so the live path has had its chance. */
const OLD = "2026-08-14T11:00:00Z";
/** Inside the window — the live path may still be mid-flight. */
const RECENT = "2026-08-14T11:58:00Z";

function entry(over: Partial<ChangeLogEntry> = {}): ChangeLogEntry {
  return {
    id: "log1",
    businessId: "b1",
    rosterId: "r1",
    shiftId: "s1",
    action: "assign",
    before: null,
    after: { assigned_user_id: "u-new" },
    changedAt: OLD,
    ...over,
  };
}

const none = new Set<string>();

describe("grace window", () => {
  it("leaves a recent change alone — the live path may still succeed", () => {
    const r = reconcileChangeLog([entry({ changedAt: RECENT })], none, NOW);
    expect(r.pending).toEqual([]);
    expect(r.silent).toEqual([]);
  });

  it("picks up a change once the window has passed", () => {
    expect(reconcileChangeLog([entry()], none, NOW).pending).toHaveLength(1);
  });

  it("defaults to a ten-minute grace", () => {
    expect(GRACE_MINUTES).toBe(10);
  });
});

describe("action → event mapping", () => {
  it("assign tells the new person (E4)", () => {
    const [p] = reconcileChangeLog([entry({ action: "assign" })], none, NOW).pending;
    expect(p).toMatchObject({ event: "E4", userId: "u-new" });
  });

  it("remove tells the person who lost it (E3)", () => {
    const e = entry({ action: "remove", before: { assigned_user_id: "u-old" }, after: null });
    const [p] = reconcileChangeLog([e], none, NOW).pending;
    expect(p).toMatchObject({ event: "E3", userId: "u-old" });
  });

  it("reassign tells BOTH people", () => {
    const e = entry({
      action: "reassign",
      before: { assigned_user_id: "u-old" },
      after: { assigned_user_id: "u-new" },
    });
    const { pending } = reconcileChangeLog([e], none, NOW);
    expect(pending).toHaveLength(2);
    expect(pending.find((p) => p.event === "E3")?.userId).toBe("u-old");
    expect(pending.find((p) => p.event === "E4")?.userId).toBe("u-new");
  });

  it("a reassign to the same person tells nobody twice", () => {
    const e = entry({
      action: "reassign",
      before: { assigned_user_id: "u1" },
      after: { assigned_user_id: "u1" },
    });
    expect(reconcileChangeLog([e], none, NOW).pending).toEqual([]);
  });

  it("edit_times tells the assignee (E2)", () => {
    const [p] = reconcileChangeLog([entry({ action: "edit_times" })], none, NOW).pending;
    expect(p.event).toBe("E2");
  });

  it("publish and unpublish fan out to everyone rostered", () => {
    const pub = reconcileChangeLog([entry({ action: "publish" })], none, NOW).pending;
    const un = reconcileChangeLog([entry({ action: "unpublish" })], none, NOW).pending;
    expect(pub[0]).toMatchObject({ event: "E1", userId: null });
    expect(un[0]).toMatchObject({ event: "E5", userId: null });
  });
});

describe("draining rows nobody needs to hear about", () => {
  it("marks lock/unlock and position edits silent rather than leaving them", () => {
    // An ever-growing backlog of unnotified rows would hide the real ones.
    const actions = ["lock", "unlock", "add_position", "delete_position"];
    const entries = actions.map((action, i) => entry({ id: `l${i}`, action }));
    const r = reconcileChangeLog(entries, none, NOW);
    expect(r.pending).toEqual([]);
    expect(r.silent).toHaveLength(4);
  });

  it("drains an unrecognised action too", () => {
    const r = reconcileChangeLog([entry({ action: "something_new" })], none, NOW);
    expect(r.pending).toEqual([]);
    expect(r.silent).toEqual(["log1"]);
  });
});

describe("de-duplication against what was already sent", () => {
  it("does not resend a message the live path delivered", () => {
    const sent = new Set(["E4:s1:u-new"]);
    const r = reconcileChangeLog([entry()], sent, NOW);
    expect(r.pending).toEqual([]);
    // …but the log row is still closed off, so it isn't scanned forever.
    expect(r.silent).toEqual(["log1"]);
  });

  it("sends only the half that was missed", () => {
    const e = entry({
      action: "reassign",
      before: { assigned_user_id: "u-old" },
      after: { assigned_user_id: "u-new" },
    });
    const sent = new Set(["E4:s1:u-new"]); // the new person heard; the old one didn't
    const { pending } = reconcileChangeLog([e], sent, NOW);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ event: "E3", userId: "u-old" });
  });
});
