import { describe, expect, it } from "vitest";
import {
  BUDGET_WARNING_FRACTION,
  CLAIM_BATCH_WINDOW_MINUTES,
  DEFAULT_DAILY_SMS_CAP,
  DEFAULT_SETTINGS,
  batchKey,
  batchWindowEnd,
  budgetLevel,
  decideDelivery,
  inQuietHours,
  isDuplicate,
  planRosterPublish,
  publishEventFor,
  quietHoursRelease,
  releaseDecision,
  resolveSettings,
  type Decision,
  type DeliveryInput,
  type NotifyChannel,
} from "../../src/lib/notify/policy";
import {
  EVENTS,
  EVENT_CODES,
  MANAGER_ONLY_SOURCE,
  deepLinkFor,
  isEventCode,
  relevantUntil,
  renderEvent,
  targetKeyFor,
  type EventCode,
} from "../../src/lib/notify/events";
import { buildNotificationDrafts, notify, setNotifyTransport } from "../../src/lib/notify";

/**
 * Module 9 §4 — throttling, batching and quiet hours, plus the §2 catalogue
 * invariants. Pure logic, so all of it is provable without a database, a
 * browser or a phone.
 */

const SYDNEY = "Australia/Sydney";

/** 22:00–07:00 quiet hours are BUSINESS time, so every fixture is built from it. */
const at = (local: string): Date => new Date(local);

const decisionFor = (decisions: Decision[], channel: NotifyChannel): Decision => {
  const found = decisions.find((d) => d.channel === channel);
  if (!found) throw new Error(`no decision for channel ${channel}`);
  return found;
};

const baseInput = (over: Partial<DeliveryInput> = {}): DeliveryInput => ({
  event: "E1",
  now: at("2026-03-10T02:00:00Z"), // 13:00 Sydney — the middle of the day
  timezone: SYDNEY,
  recipient: { userId: "u1", active: true, hasPhone: true },
  ...over,
});

// ---------------------------------------------------------------------------
// §2 — the catalogue is the gate
// ---------------------------------------------------------------------------

describe("the event catalogue (§2)", () => {
  it("holds exactly E1..E16 and nothing else", () => {
    expect(EVENT_CODES).toHaveLength(16);
    expect(Object.keys(EVENTS).sort()).toEqual([...EVENT_CODES].sort());
    expect(isEventCode("E7")).toBe(true);
    expect(isEventCode("E17")).toBe(false);
    expect(isEventCode("roster_published")).toBe(false);
  });

  it("every event declares a channel — nothing is catalogued that cannot be sent", () => {
    for (const code of EVENT_CODES) {
      const spec = EVENTS[code];
      expect(spec.inApp || spec.sms).toBe(true);
      expect(spec.code).toBe(code);
    }
  });

  it("only E10 and E13 may break quiet hours", () => {
    const timeCritical = EVENT_CODES.filter((c) => EVENTS[c].timeCritical);
    expect(timeCritical).toEqual(["E10", "E13"]);
  });

  it("operational events cannot be muted by the recipient (§6)", () => {
    // Roster publication, shift changes and "you're on" are not optional.
    for (const code of ["E1", "E2", "E3", "E4", "E5", "E10"] as EventCode[]) {
      expect(EVENTS[code].mutable).toBe(false);
    }
    // The ones §6 explicitly allows staff/managers to silence.
    for (const code of ["E7", "E9", "E11"] as EventCode[]) {
      expect(EVENTS[code].mutable).toBe(true);
    }
  });

  it("E6 (drop requested) is manager-only — never broadcast to staff", () => {
    expect(EVENTS.E6.recipient).toBe("manager");
    expect(EVENTS.E8.recipient).toBe("eligible_staff");
  });

  it("every deep link points at a specific screen, never a bare home screen", () => {
    const links = [
      deepLinkFor("E1", { rosterId: "r1", when: "next fortnight", shiftCount: 4 }),
      deepLinkFor("E2", { shiftId: "s1", when: "Fri 16:00", startAt: "2026-03-10T05:00:00Z" }),
      deepLinkFor("E6", { shiftId: "s1", when: "Fri 16:00", staffName: "Ahmed", reason: null }),
      deepLinkFor("E8", {
        shiftId: "s1",
        when: "Fri 16:00",
        startAt: "2026-03-10T05:00:00Z",
        roleName: "Kitchen",
      }),
      deepLinkFor("E10", { shiftId: "s1", when: "Fri 16:00", startAt: "2026-03-10T05:00:00Z" }),
      deepLinkFor("E11", { shiftId: "s1", when: "Fri 16:00" }),
      deepLinkFor("E16", { inviteToken: "tok", businessName: "Al Tazah" }),
    ];
    for (const link of links) {
      expect(link.startsWith("/")).toBe(true);
      expect(link).not.toBe("/");
      expect(link).not.toBe("/me");
      expect(link.length).toBeGreaterThan(3);
    }
    expect(deepLinkFor("E10", { shiftId: "abc", when: "x", startAt: "2026-01-01T00:00:00Z" })).toBe(
      "/me/shifts/abc",
    );
  });

  it("renders Australian-English copy with an SMS short enough to be one segment", () => {
    const rendered = renderEvent("E1", { rosterId: "r1", when: "next fortnight", shiftCount: 1 });
    expect(rendered.body).toContain("1 shift");
    expect(rendered.body).not.toContain("1 shifts");
    for (const code of EVENT_CODES.filter((c) => EVENTS[c].sms)) {
      // 160 characters per segment, and the worker appends a ~40-char URL.
      const text = renderEvent(code, samplePayload(code)).smsText;
      expect(text.length).toBeLessThanOrEqual(115);
    }
  });

  it("marks only events with a start time as capable of going stale (§8)", () => {
    expect(
      relevantUntil("E10", { shiftId: "s", when: "x", startAt: "2026-03-10T05:00:00Z" }),
    ).toBe("2026-03-10T05:00:00Z");
    expect(relevantUntil("E7", { shiftId: "s", when: "x" })).toBeNull();
  });

  it("keys de-duplication on the thing the event is about", () => {
    expect(targetKeyFor("E9", { shiftId: "s1", when: "x", claimantName: "A", claimCount: 1 })).toBe(
      "shift:s1",
    );
    expect(targetKeyFor("E1", { rosterId: "r1", when: "x", shiftCount: 2 })).toBe("roster:r1");
  });

  it("gates manager-sourced events, and lets staff raise their own", () => {
    // A staff member legitimately triggers E6 (they asked) and E9 (they offered).
    expect(MANAGER_ONLY_SOURCE.has("E6")).toBe(false);
    expect(MANAGER_ONLY_SOURCE.has("E9")).toBe(false);
    // Nobody but a manager publishes, opens to the team or approves.
    for (const code of ["E1", "E5", "E8", "E10"] as EventCode[]) {
      expect(MANAGER_ONLY_SOURCE.has(code)).toBe(true);
    }
  });
});

/** A minimal, valid payload for each code — used for the copy-length sweep. */
function samplePayload(code: EventCode): never {
  const start = "2026-03-10T05:00:00Z";
  const when = "Fri 10 Mar, 16:00";
  const map: Record<EventCode, unknown> = {
    E1: { rosterId: "r1", when, shiftCount: 9 },
    E2: { shiftId: "s1", when, startAt: start },
    E3: { rosterId: "r1", when },
    E4: { shiftId: "s1", when, startAt: start },
    E5: { rosterId: "r1", when },
    E6: { shiftId: "s1", when, staffName: "Ahmed", reason: null },
    E7: { shiftId: "s1", when },
    E8: { shiftId: "s1", when, startAt: start, roleName: "Kitchen" },
    E9: { shiftId: "s1", when, claimantName: "Ahmed", claimCount: 3 },
    E10: { shiftId: "s1", when, startAt: start },
    E11: { shiftId: "s1", when },
    E12: { shiftId: "s1", rosterId: "r1", when, coveredByName: "Ahmed" },
    E13: { shiftId: "s1", when, startAt: start, hoursUntilStart: 12 },
    E14: { shiftId: "s1", staffUserId: "u1", staffName: "Ahmed", when },
    E15: { rosterStart: "2026-03-16", when: "Mon 16 Mar" },
    E16: { inviteToken: "tok", businessName: "Al Tazah" },
  };
  return map[code] as never;
}

// ---------------------------------------------------------------------------
// §4 — quiet hours
// ---------------------------------------------------------------------------

describe("quiet hours (§4)", () => {
  it("is quiet at 23:00 and 02:00 Sydney, and awake at 13:00", () => {
    const quiet = DEFAULT_SETTINGS.quietHours;
    // 2026-03-10 is AEDT (+11).
    expect(inQuietHours(at("2026-03-10T12:00:00Z"), SYDNEY, quiet)).toBe(true); // 23:00
    expect(inQuietHours(at("2026-03-10T15:00:00Z"), SYDNEY, quiet)).toBe(true); // 02:00
    expect(inQuietHours(at("2026-03-10T02:00:00Z"), SYDNEY, quiet)).toBe(false); // 13:00
    expect(inQuietHours(at("2026-03-09T20:30:00Z"), SYDNEY, quiet)).toBe(false); // 07:30
  });

  it("uses BUSINESS time, not the server's — the same instant differs by zone", () => {
    const quiet = DEFAULT_SETTINGS.quietHours;
    const instant = at("2026-03-10T12:00:00Z"); // 23:00 Sydney, 12:00 UTC
    expect(inQuietHours(instant, SYDNEY, quiet)).toBe(true);
    expect(inQuietHours(instant, "UTC", quiet)).toBe(false);
  });

  it("releases at the next 07:00 business time", () => {
    const release = quietHoursRelease(at("2026-03-10T12:00:00Z"), SYDNEY, DEFAULT_SETTINGS.quietHours);
    // 23:00 Sat 10th AEDT → 07:00 the following morning = 20:00 UTC the same day.
    expect(release).toBe("2026-03-10T20:00:00.000Z");
  });

  it("still lands on 07:00 local across the daylight-saving change", () => {
    // AEDT (+11) ends 05 Apr 2026 at 03:00, when clocks go back to AEST (+10).
    // 07:00 must stay 07:00 to the person holding the phone, which means the UTC
    // instant MOVES by an hour. Naive arithmetic gets this wrong; zonedInstant
    // does not (CLAUDE.md rule 8).
    const beforeChange = quietHoursRelease(
      at("2026-04-03T13:00:00Z"), // 00:00 Sat 4 Apr, AEDT
      SYDNEY,
      DEFAULT_SETTINGS.quietHours,
    );
    const acrossChange = quietHoursRelease(
      at("2026-04-04T13:00:00Z"), // 00:00 Sun 5 Apr, AEDT — the clocks go back at 03:00
      SYDNEY,
      DEFAULT_SETTINGS.quietHours,
    );
    const afterChange = quietHoursRelease(
      at("2026-04-05T13:00:00Z"), // 23:00 Sun 5 Apr, AEST
      SYDNEY,
      DEFAULT_SETTINGS.quietHours,
    );
    expect(beforeChange).toBe("2026-04-03T20:00:00.000Z"); // 07:00 AEDT (+11)
    expect(acrossChange).toBe("2026-04-04T21:00:00.000Z"); // 07:00 AEST (+10) — an hour later in UTC
    expect(afterChange).toBe("2026-04-05T21:00:00.000Z"); // 07:00 AEST (+10)
  });

  it("holds a non-urgent SMS overnight but never the in-app copy", () => {
    const decisions = decideDelivery(baseInput({ event: "E1", now: at("2026-03-10T12:00:00Z") }));
    expect(decisionFor(decisions, "inapp")).toEqual({ action: "send", channel: "inapp" });
    const sms = decisionFor(decisions, "sms");
    expect(sms.action).toBe("schedule");
    if (sms.action !== "schedule") throw new Error("expected a scheduled decision");
    expect(sms.reason).toBe("quiet_hours");
    expect(sms.scheduledFor).toBe("2026-03-10T20:00:00.000Z");
  });

  it("lets the two time-critical events through at 2am", () => {
    for (const event of ["E10", "E13"] as EventCode[]) {
      const decisions = decideDelivery(baseInput({ event, now: at("2026-03-10T15:00:00Z") }));
      expect(decisionFor(decisions, "sms")).toEqual({ action: "send", channel: "sms" });
    }
    // …and holds a non-critical one at the same instant.
    const held = decideDelivery(baseInput({ event: "E12", now: at("2026-03-10T15:00:00Z") }));
    expect(decisionFor(held, "sms").action).toBe("schedule");
  });

  it("discards a queued message whose shift has already started (§8)", () => {
    const now = at("2026-03-10T20:00:00Z");
    expect(releaseDecision(now, "2026-03-10T19:00:00Z")).toEqual({
      action: "suppress",
      reason: "stale",
    });
    expect(releaseDecision(now, "2026-03-11T06:00:00Z")).toEqual({ action: "send" });
    expect(releaseDecision(now, null)).toEqual({ action: "send" });
  });
});

// ---------------------------------------------------------------------------
// §4 — de-duplication, rate cap, budget, preferences
// ---------------------------------------------------------------------------

describe("de-duplication (§4)", () => {
  it("treats an identical event within 60 seconds as one message", () => {
    const now = at("2026-03-10T02:00:00Z");
    expect(isDuplicate(now, ["2026-03-10T01:59:30Z"])).toBe(true);
    expect(isDuplicate(now, ["2026-03-10T01:58:00Z"])).toBe(false);
    expect(isDuplicate(now, [])).toBe(false);
    expect(isDuplicate(now, undefined)).toBe(false);
  });

  it("never suppresses a real message because of an unreadable timestamp", () => {
    expect(isDuplicate(at("2026-03-10T02:00:00Z"), ["not-a-date"])).toBe(false);
  });

  it("suppresses BOTH channels of a double-tap, with a recorded reason", () => {
    const decisions = decideDelivery(
      baseInput({
        recipient: {
          userId: "u1",
          active: true,
          hasPhone: true,
          recentIdenticalAt: ["2026-03-10T01:59:45Z"],
        },
      }),
    );
    expect(decisions).toHaveLength(2);
    for (const d of decisions) {
      expect(d.action).toBe("suppress");
      if (d.action === "suppress") expect(d.reason).toBe("duplicate");
    }
  });
});

describe("rate cap and budget (§4, §5)", () => {
  it("degrades to in-app only once the daily SMS cap is reached — never dropped", () => {
    const decisions = decideDelivery(
      baseInput({
        recipient: { userId: "u1", active: true, hasPhone: true, smsSentToday: DEFAULT_DAILY_SMS_CAP },
      }),
    );
    // The message still reaches them; it just stops costing money.
    expect(decisionFor(decisions, "inapp")).toEqual({ action: "send", channel: "inapp" });
    expect(decisionFor(decisions, "sms")).toEqual({
      action: "suppress",
      channel: "sms",
      reason: "rate_cap",
    });
  });

  it("still sends the 5th SMS of the day", () => {
    const decisions = decideDelivery(
      baseInput({ recipient: { userId: "u1", active: true, hasPhone: true, smsSentToday: 4 } }),
    );
    expect(decisionFor(decisions, "sms").action).toBe("send");
  });

  it("warns at 80% of the monthly budget and degrades at 100%", () => {
    expect(budgetLevel({ used: 0, limit: 500 })).toBe("ok");
    expect(budgetLevel({ used: 500 * BUDGET_WARNING_FRACTION, limit: 500 })).toBe("warning");
    expect(budgetLevel({ used: 500, limit: 500 })).toBe("exhausted");
    expect(budgetLevel({ used: 9_999, limit: null })).toBe("ok");
    expect(budgetLevel(undefined)).toBe("ok");
  });

  it("keeps the product working when the budget is spent — in-app only", () => {
    const decisions = decideDelivery(baseInput({ budget: { used: 500, limit: 500 } }));
    expect(decisionFor(decisions, "inapp").action).toBe("send");
    expect(decisionFor(decisions, "sms")).toEqual({
      action: "suppress",
      channel: "sms",
      reason: "budget",
    });
  });

  it("honours the per-business SMS toggle", () => {
    const decisions = decideDelivery(baseInput({ settings: { smsEnabled: false } }));
    expect(decisionFor(decisions, "inapp").action).toBe("send");
    expect(decisionFor(decisions, "sms").action).toBe("suppress");
  });

  it("records a missing phone number rather than swallowing it (§8)", () => {
    const decisions = decideDelivery(
      baseInput({ recipient: { userId: "u1", active: true, hasPhone: false } }),
    );
    expect(decisionFor(decisions, "sms")).toEqual({
      action: "suppress",
      channel: "sms",
      reason: "no_phone",
    });
  });

  it("suppresses everything for a deactivated staff member, and logs why (§8)", () => {
    const decisions = decideDelivery(
      baseInput({ recipient: { userId: "u1", active: false, hasPhone: true } }),
    );
    for (const d of decisions) {
      expect(d.action).toBe("suppress");
      if (d.action === "suppress") expect(d.reason).toBe("inactive");
    }
  });

  it("lets a mute silence E11 but NOT the roster publish (§6)", () => {
    const muted = { userId: "u1", active: true, hasPhone: true, smsMuted: true };
    // E11 is in-app only, so muting it changes nothing that was going to be sent…
    expect(decideDelivery(baseInput({ event: "E11", recipient: muted })).some((d) => d.channel === "sms")).toBe(
      false,
    );
    // …and an operational event ignores the flag entirely.
    expect(decisionFor(decideDelivery(baseInput({ event: "E1", recipient: muted })), "sms").action).toBe(
      "send",
    );
    // E7 is mutable, and in-app only, so the catalogue already limits the blast.
    expect(EVENTS.E7.mutable).toBe(true);
  });

  it("only ever produces the channels the catalogue allows", () => {
    // E9 is in-app only — no SMS decision can exist for it, muted or not.
    const decisions = decideDelivery(baseInput({ event: "E9" }));
    expect(decisions.map((d) => d.channel)).toEqual(["inapp"]);
    // E16 is SMS only — there is no in-app for somebody without an account.
    expect(decideDelivery(baseInput({ event: "E16" })).map((d) => d.channel)).toEqual(["sms"]);
  });

  it("fills partial settings from the documented defaults", () => {
    const settings = resolveSettings({ dailySmsCap: 2 });
    expect(settings.dailySmsCap).toBe(2);
    expect(settings.quietHours).toEqual(DEFAULT_SETTINGS.quietHours);
    expect(settings.smsEnabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §4 — batching, and the one-SMS-per-person publish rule
// ---------------------------------------------------------------------------

describe("batching (§4)", () => {
  it("collapses several claims on one shift under one key", () => {
    expect(batchKey("E9", { shiftId: "s1" })).toBe("claims:shift_s1");
    expect(batchKey("E9", { shiftId: "s2" })).toBe("claims:shift_s2");
    expect(batchKey("E9", { shiftId: "s1" })).toBe(batchKey("E9", { shiftId: "s1" }));
  });

  it("collapses a bulk edit into one 'your shifts have changed' per person (§8)", () => {
    const first = batchKey("E2", { rosterId: "r1", userId: "u1" });
    const second = batchKey("E3", { rosterId: "r1", userId: "u1" });
    const other = batchKey("E2", { rosterId: "r1", userId: "u2" });
    expect(first).toBe("changes:roster_r1:user_u1");
    expect(second).toBe(first); // change, removal and addition share the window
    expect(other).not.toBe(first); // …but never across people
  });

  it("does not batch events that must arrive on their own", () => {
    expect(batchKey("E10", { shiftId: "s1" })).toBeNull();
    expect(batchKey("E13", { shiftId: "s1" })).toBeNull();
    expect(batchKey("E6", { shiftId: "s1" })).toBeNull();
  });

  it("closes the batch window 10 minutes out by default", () => {
    const end = batchWindowEnd(at("2026-03-10T02:00:00Z"));
    expect(end).toBe("2026-03-10T02:10:00.000Z");
    expect(CLAIM_BATCH_WINDOW_MINUTES).toBe(10);
  });
});

describe("roster publish sends ONE message per person, never one per shift (§4)", () => {
  const fortnight = [
    { assignedUserId: "u1", date: "2026-03-16" },
    { assignedUserId: "u1", date: "2026-03-17" },
    { assignedUserId: "u1", date: "2026-03-20" },
    { assignedUserId: "u2", date: "2026-03-18" },
    { assignedUserId: null, date: "2026-03-19" }, // an unfilled position
  ];

  it("produces one plan per staff member, with their shift count and range", () => {
    const plans = planRosterPublish(fortnight);
    expect(plans).toHaveLength(2);
    expect(plans[0]).toEqual({
      userId: "u1",
      shiftCount: 3,
      firstDate: "2026-03-16",
      lastDate: "2026-03-20",
    });
    expect(plans[1].userId).toBe("u2");
    expect(plans[1].shiftCount).toBe(1);
  });

  it("tells nobody about an unfilled position", () => {
    expect(planRosterPublish([{ assignedUserId: null, date: "2026-03-19" }])).toEqual([]);
    expect(planRosterPublish([])).toEqual([]);
  });

  it("produces exactly one SMS row per person for a whole fortnight", () => {
    const plans = planRosterPublish(fortnight);
    const drafts = buildNotificationDrafts({
      event: "E1",
      businessId: "b1",
      timezone: SYDNEY,
      now: at("2026-03-10T02:00:00Z"),
      recipients: plans.map((p) => ({ userId: p.userId })),
      payload: { rosterId: "r1", when: "16–29 March", shiftCount: 3 },
    });
    const sms = drafts.filter((d) => d.channel === "sms");
    expect(sms).toHaveLength(2); // two people, not five shifts
    expect(new Set(sms.map((d) => d.userId)).size).toBe(2);
  });

  it("does not re-blast everyone when a roster is republished (§8)", () => {
    expect(publishEventFor(false)).toBe("E1");
    expect(publishEventFor(true)).toBeNull(); // only E2/E3/E4 for who actually changed
  });
});

// ---------------------------------------------------------------------------
// notify() — the rule the whole module exists to hold
// ---------------------------------------------------------------------------

describe("notify() can never break the action that triggered it (CLAUDE.md rule 7)", () => {
  it("resolves rather than rejects when the transport throws", async () => {
    setNotifyTransport({
      enqueue: () => Promise.reject(new Error("Twilio is down / RLS said no")),
    });
    const outcome = await notify({
      event: "E10",
      businessId: "b1",
      timezone: SYDNEY,
      recipients: [{ userId: "u1" }],
      payload: { shiftId: "s1", when: "Fri 16:00", startAt: "2026-03-20T05:00:00Z" },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.enqueued).toBe(0);
    expect(outcome.error).toContain("Twilio is down");
    setNotifyTransport(null);
  });

  it("resolves rather than rejects when the transport throws a non-Error", async () => {
    setNotifyTransport({ enqueue: () => Promise.reject("network gone") });
    const outcome = await notify({
      event: "E6",
      businessId: "b1",
      timezone: SYDNEY,
      recipients: [{ userId: "m1" }],
      payload: { shiftId: "s1", when: "Fri 16:00", staffName: "Ahmed", reason: null },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("network gone");
    setNotifyTransport(null);
  });

  it("is a no-op with no recipients, without touching the transport", async () => {
    let called = false;
    setNotifyTransport({
      enqueue: () => {
        called = true;
        return Promise.resolve(0);
      },
    });
    const outcome = await notify({
      event: "E8",
      businessId: "b1",
      timezone: SYDNEY,
      recipients: [],
      payload: {
        shiftId: "s1",
        when: "Fri 16:00",
        startAt: "2026-03-20T05:00:00Z",
        roleName: "Kitchen",
      },
    });
    expect(outcome).toEqual({ ok: true, enqueued: 0, drafts: [], error: null });
    expect(called).toBe(false);
    setNotifyTransport(null);
  });

  it("writes a row for a SUPPRESSED message too — 'I never got told' must be answerable", () => {
    const drafts = buildNotificationDrafts({
      event: "E1",
      businessId: "b1",
      timezone: SYDNEY,
      now: at("2026-03-10T02:00:00Z"),
      recipients: [{ userId: "u1", active: false }],
      payload: { rosterId: "r1", when: "16–29 March", shiftCount: 3 },
    });
    expect(drafts).toHaveLength(2);
    for (const d of drafts) {
      expect(d.status).toBe("suppressed");
      expect(d.suppressedReason).toBe("inactive");
    }
  });

  it("carries the rendered copy and the deep link onto the row", () => {
    const [inapp] = buildNotificationDrafts({
      event: "E10",
      businessId: "b1",
      timezone: SYDNEY,
      now: at("2026-03-10T02:00:00Z"),
      recipients: [{ userId: "u1" }],
      payload: { shiftId: "s1", when: "Fri 16:00", startAt: "2026-03-20T05:00:00Z" },
    });
    expect(inapp.channel).toBe("inapp");
    expect(inapp.payload.link).toBe("/me/shifts/s1");
    expect(inapp.payload.title).toBe("You're on");
    expect(inapp.payload.relevantUntil).toBe("2026-03-20T05:00:00Z");
    expect(inapp.payload.targetKey).toBe("shift:s1");
    expect(inapp.eventType).toBe("E10");
  });
});
