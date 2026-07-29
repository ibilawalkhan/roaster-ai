// Module 9 §2 — THE EVENT CATALOGUE.
//
// This file is the single reference table for every notification Rosterly is
// allowed to send. M9 §2 is explicit: "Nothing else sends a notification.
// Adding an event to this table is a deliberate decision, not a side effect of
// writing code." That rule is enforced structurally here:
//
//   * `EventCode` is a closed union of 'E1'..'E16'; `notify()` only accepts a
//     code from it, so there is no way to enqueue an uncatalogued message;
//   * every entry declares its RECIPIENT RULE, its channels, whether it is
//     time-critical (may break quiet hours) and its deep link. A new event
//     therefore cannot be added without someone answering all four questions.
//
// DEEP LINKS (M9 §3): every link points at the exact screen — a specific shift,
// the open-shifts list, the manager's cover queue. A text that dumps someone on
// a home screen wastes both the message and their time, so `deepLink` never
// returns a bare "/" or "/me" without something to act on. Links are app-RELATIVE;
// the worker prefixes the public origin, and a signed-out tap lands on login and
// continues to the target.
//
// COPY LIVES HERE TOO. `render()` produces the in-app title/body and the SMS
// sentence at ENQUEUE time and stores them on the outbox row's payload, so the
// delivery worker (Deno, cannot import this file) stays dumb: it sends the text
// it was given. One place to change wording; Australian English throughout.
//
// No I/O, no React, no Supabase — pure, so the whole catalogue is unit-testable.

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

export const EVENT_CODES = [
  "E1",
  "E2",
  "E3",
  "E4",
  "E5",
  "E6",
  "E7",
  "E8",
  "E9",
  "E10",
  "E11",
  "E12",
  "E13",
  "E14",
  "E15",
  "E16",
] as const;

export type EventCode = (typeof EVENT_CODES)[number];

/** Is this string one of the catalogued codes? The gate for anything untyped. */
export function isEventCode(value: unknown): value is EventCode {
  return typeof value === "string" && (EVENT_CODES as readonly string[]).includes(value);
}

/**
 * WHO gets the message. Declared rather than inferred so the M9 §2 column is
 * readable in code, and so `E6 = manager only` is a property of the catalogue
 * rather than a promise made by one call site.
 */
export type RecipientRule =
  /** Each staff member who has a shift in the roster. */
  | "staff_with_shifts"
  /** The one staff member whose shift changed. */
  | "affected_staff"
  /** The manager(s) of the business — never staff. */
  | "manager"
  /** Only staff who pass the M8 §4 eligibility check. */
  | "eligible_staff"
  /** The person who asked for cover. */
  | "dropper"
  /** The claimant whose offer was approved. */
  | "chosen_claimant"
  /** The claimants who missed out. */
  | "other_claimants"
  /** Staff with no availability set (E15). */
  | "staff_without_availability"
  /** Somebody who does not have an account yet (E16). */
  | "invited_person";

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------
//
// `when` is a HUMAN label already rendered in business time by the caller (e.g.
// "Fri 3 Oct, 16:00"). Timezone conversion is done once, at the call site, with
// src/lib/domain/timezone.ts — this module never does date arithmetic, so the
// rendered copy cannot drift from what the screen shows.
//
// `startAt` is the UTC instant, present only where the event goes stale: a
// quiet-hours-queued text about a shift that has already started is discarded
// rather than sent at 7am (M9 §8).

export interface EventPayloadMap {
  E1: { rosterId: string; when: string; shiftCount: number };
  E2: { shiftId: string; when: string; startAt: string; changeCount?: number };
  E3: { rosterId: string; when: string; removedCount?: number };
  E4: { shiftId: string; when: string; startAt: string };
  E5: { rosterId: string; when: string };
  E6: { shiftId: string; when: string; staffName: string; reason: string | null };
  E7: { shiftId: string; when: string };
  E8: { shiftId: string; when: string; startAt: string; roleName: string };
  E9: { shiftId: string; when: string; claimantName: string; claimCount: number };
  E10: { shiftId: string; when: string; startAt: string };
  E11: { shiftId: string; when: string };
  E12: { shiftId: string; rosterId: string; when: string; coveredByName: string };
  E13: { shiftId: string; when: string; startAt: string; hoursUntilStart: number };
  E14: { shiftId: string; staffUserId: string; staffName: string; when: string };
  E15: { rosterStart: string; when: string };
  E16: { inviteToken: string; businessName: string };
}

export type EventPayload<K extends EventCode = EventCode> = EventPayloadMap[K];

/** What the delivery worker and the in-app list actually render. */
export interface RenderedEvent {
  /** Heading in the in-app list. */
  title: string;
  /** One line of detail under the heading. */
  body: string;
  /**
   * The SMS sentence WITHOUT the link — the worker appends the absolute URL.
   * Kept short: one SMS segment is 160 characters including the link.
   */
  smsText: string;
  /** App-relative deep link. Never a generic home screen. */
  link: string;
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export interface EventSpec<K extends EventCode = EventCode> {
  code: K;
  /** How this event is described in the build log and in support conversations. */
  name: string;
  recipient: RecipientRule;
  /** M9 §2 "In-app" column. Every catalogued event is in-app except the invite. */
  inApp: boolean;
  /** M9 §2 "SMS" column. Costs money and interrupts an evening — quiet by default. */
  sms: boolean;
  /**
   * May break quiet hours (M9 §4). Only E10 ("you're on") and E13 ("still
   * uncovered, starting soon") — both are worthless the morning after.
   */
  timeCritical: boolean;
  /**
   * The recipient may turn SMS off for this one (M9 §6). Operational events —
   * publication, shift changes, "you're on" — deliberately cannot be muted.
   */
  mutable: boolean;
  /** [V1.1] items are catalogued so nothing sends outside the table, but unused in MVP. */
  mvp: boolean;
  /** The exact screen an SMS opens. */
  deepLink: (payload: EventPayloadMap[K]) => string;
  /** In-app + SMS copy. */
  render: (payload: EventPayloadMap[K]) => RenderedEvent;
}

const q = (value: string): string => encodeURIComponent(value);

/** "3 shifts" / "1 shift" — never "1 shifts". */
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

type Catalogue = { [K in EventCode]: EventSpec<K> };

export const EVENTS: Catalogue = {
  // -------------------------------------------------------------------------
  // Roster (M6 → M9)
  // -------------------------------------------------------------------------
  E1: {
    code: "E1",
    name: "Roster published",
    recipient: "staff_with_shifts",
    inApp: true,
    sms: true,
    timeCritical: false,
    mutable: false,
    mvp: true,
    // Their own roster for that period — one link, one message, whatever the
    // shift count (M9 §4: never one SMS per shift).
    deepLink: (p) => `/me?roster=${q(p.rosterId)}`,
    render: (p) => ({
      title: "Your roster is out",
      body: `${plural(p.shiftCount, "shift", "shifts")} for ${p.when}.`,
      smsText: `Rosterly: your roster for ${p.when} is out — ${plural(p.shiftCount, "shift", "shifts")}.`,
      link: `/me?roster=${q(p.rosterId)}`,
    }),
  },

  E2: {
    code: "E2",
    name: "Your shift changed",
    recipient: "affected_staff",
    inApp: true,
    sms: true,
    timeCritical: false,
    mutable: false,
    mvp: true,
    deepLink: (p) => `/me/shifts/${q(p.shiftId)}`,
    render: (p) => {
      const many = (p.changeCount ?? 1) > 1;
      return {
        title: many ? "Your shifts have changed" : "Your shift has changed",
        body: many
          ? `${plural(p.changeCount ?? 1, "shift", "shifts")} changed, from ${p.when}.`
          : `${p.when} — check the new times.`,
        smsText: many
          ? `Rosterly: ${plural(p.changeCount ?? 1, "of your shifts has", "of your shifts have")} changed.`
          : `Rosterly: your shift on ${p.when} has changed.`,
        link: `/me/shifts/${q(p.shiftId)}`,
      };
    },
  },

  E3: {
    code: "E3",
    name: "Your shift was removed",
    recipient: "affected_staff",
    inApp: true,
    sms: true,
    timeCritical: false,
    mutable: false,
    mvp: true,
    // The shift row is gone, so its detail screen would 404. The roster for the
    // period is the specific, useful place to land.
    deepLink: (p) => `/me?roster=${q(p.rosterId)}`,
    render: (p) => {
      const many = (p.removedCount ?? 1) > 1;
      return {
        title: many ? "Shifts taken off your roster" : "A shift was taken off your roster",
        body: many
          ? `${plural(p.removedCount ?? 1, "shift", "shifts")} removed, from ${p.when}.`
          : `You're no longer on ${p.when}.`,
        smsText: many
          ? `Rosterly: ${plural(p.removedCount ?? 1, "shift has", "shifts have")} been taken off your roster.`
          : `Rosterly: you're no longer rostered on ${p.when}.`,
        link: `/me?roster=${q(p.rosterId)}`,
      };
    },
  },

  E4: {
    code: "E4",
    name: "You were added to a shift",
    recipient: "affected_staff",
    inApp: true,
    sms: true,
    timeCritical: false,
    mutable: false,
    mvp: true,
    deepLink: (p) => `/me/shifts/${q(p.shiftId)}`,
    render: (p) => ({
      title: "You've been added to a shift",
      body: `${p.when}.`,
      smsText: `Rosterly: you've been added to a shift on ${p.when}.`,
      link: `/me/shifts/${q(p.shiftId)}`,
    }),
  },

  E5: {
    code: "E5",
    name: "Roster withdrawn",
    recipient: "staff_with_shifts",
    inApp: true,
    sms: true,
    timeCritical: false,
    mutable: false,
    mvp: true,
    deepLink: (p) => `/me?roster=${q(p.rosterId)}`,
    render: (p) => ({
      title: "Your roster has been withdrawn",
      body: `${p.when} is being reworked. Don't rely on the times you saw.`,
      smsText: `Rosterly: the roster for ${p.when} has been withdrawn while it's reworked.`,
      link: `/me?roster=${q(p.rosterId)}`,
    }),
  },

  // -------------------------------------------------------------------------
  // Swaps (M8 → M9). The manager is the hub: staff hear about their OWN shifts,
  // the manager hears about the restaurant.
  // -------------------------------------------------------------------------
  E6: {
    code: "E6",
    name: "Drop requested",
    // M9 §2 and M8 §1, in bold: MANAGER ONLY. A drop request is never broadcast
    // to the team — the manager decides whether the team ever hears about it.
    recipient: "manager",
    inApp: true,
    sms: true,
    timeCritical: false,
    mutable: false,
    mvp: true,
    deepLink: (p) => `/admin/swaps?shift=${q(p.shiftId)}`,
    render: (p) => ({
      title: `${p.staffName} can't make a shift`,
      body: p.reason ? `${p.when} — "${p.reason}"` : `${p.when} — no reason given.`,
      smsText: `Rosterly: ${p.staffName} has asked for cover on ${p.when}.`,
      link: `/admin/swaps?shift=${q(p.shiftId)}`,
    }),
  },

  E7: {
    code: "E7",
    name: "Drop declined",
    recipient: "dropper",
    inApp: true,
    // Deliberately in-app only (M9 §2): disappointing, but not urgent.
    sms: false,
    timeCritical: false,
    mutable: true,
    mvp: true,
    deepLink: (p) => `/me/shifts/${q(p.shiftId)}`,
    render: (p) => ({
      title: "Your cover request was declined",
      body: `You're still on ${p.when}. Speak to your manager if you can't make it.`,
      smsText: `Rosterly: your cover request for ${p.when} was declined — you're still rostered.`,
      link: `/me/shifts/${q(p.shiftId)}`,
    }),
  },

  E8: {
    code: "E8",
    name: "Shift opened to team",
    // ELIGIBLE STAFF ONLY (M8 §4) — never the whole team.
    recipient: "eligible_staff",
    inApp: true,
    sms: true,
    timeCritical: false,
    mutable: false,
    mvp: true,
    deepLink: (p) => `/me/open-shifts?shift=${q(p.shiftId)}`,
    render: (p) => ({
      title: "A shift needs covering",
      body: `${p.roleName}, ${p.when}. Offering doesn't put you on it — your manager decides.`,
      smsText: `Rosterly: ${p.roleName} shift going on ${p.when}. Can you cover it?`,
      link: `/me/open-shifts?shift=${q(p.shiftId)}`,
    }),
  },

  E9: {
    code: "E9",
    name: "Shift claimed",
    recipient: "manager",
    inApp: true,
    // In-app only (M9 §2). Batched when several people offer on one shift (§4).
    sms: false,
    timeCritical: false,
    mutable: true,
    mvp: true,
    deepLink: (p) => `/admin/swaps?shift=${q(p.shiftId)}`,
    render: (p) => ({
      title:
        p.claimCount > 1
          ? `${p.claimCount} people have offered to cover ${p.when}`
          : `${p.claimantName} has offered to cover`,
      body: p.claimCount > 1 ? "Pick who gets it." : `${p.when}. Approve to put them on.`,
      smsText:
        p.claimCount > 1
          ? `Rosterly: ${p.claimCount} people have offered to cover ${p.when}.`
          : `Rosterly: ${p.claimantName} has offered to cover ${p.when}.`,
      link: `/admin/swaps?shift=${q(p.shiftId)}`,
    }),
  },

  E10: {
    code: "E10",
    name: "Your claim was approved — you're on",
    recipient: "chosen_claimant",
    inApp: true,
    sms: true,
    // TIME-CRITICAL (M9 §4): telling somebody at 7am that they were on at 6am
    // is worse than useless, so this one breaks quiet hours.
    timeCritical: true,
    mutable: false,
    mvp: true,
    deepLink: (p) => `/me/shifts/${q(p.shiftId)}`,
    render: (p) => ({
      title: "You're on",
      body: `Your manager approved your offer — ${p.when}.`,
      smsText: `Rosterly: you're on for ${p.when}. Your manager approved your offer.`,
      link: `/me/shifts/${q(p.shiftId)}`,
    }),
  },

  E11: {
    code: "E11",
    name: "Shift filled by someone else",
    recipient: "other_claimants",
    inApp: true,
    sms: false,
    timeCritical: false,
    mutable: true,
    mvp: true,
    // Their claim is gone and the shift is not theirs to read — the list of what
    // IS still going is the useful destination.
    deepLink: () => `/me/open-shifts`,
    render: (p) => ({
      title: "That shift has been covered",
      body: `Someone else picked up ${p.when}. Thanks for offering.`,
      smsText: `Rosterly: ${p.when} has been covered by someone else.`,
      link: `/me/open-shifts`,
    }),
  },

  E12: {
    code: "E12",
    name: "Your shift was covered",
    recipient: "dropper",
    inApp: true,
    sms: true,
    timeCritical: false,
    mutable: false,
    mvp: true,
    // The shift now belongs to somebody else, so its detail screen is not
    // readable by the dropper. Their own roster for the period is (M9 §3).
    deepLink: (p) => `/me?roster=${q(p.rosterId)}`,
    render: (p) => ({
      title: "Your shift is covered",
      body: `${p.coveredByName} is on ${p.when}. You're no longer rostered for it.`,
      smsText: `Rosterly: ${p.coveredByName} is covering your shift on ${p.when}. You're off it.`,
      link: `/me?roster=${q(p.rosterId)}`,
    }),
  },

  E13: {
    code: "E13",
    name: "Shift still uncovered, starting soon",
    recipient: "manager",
    inApp: true,
    sms: true,
    // TIME-CRITICAL (M9 §4): the whole point is the hours before service.
    timeCritical: true,
    mutable: false,
    mvp: true,
    deepLink: (p) => `/admin/swaps?shift=${q(p.shiftId)}`,
    render: (p) => ({
      title: "A shift is still uncovered",
      body: `${p.when} — starts in about ${plural(Math.max(0, Math.round(p.hoursUntilStart)), "hour", "hours")}.`,
      smsText: `Rosterly: ${p.when} is still uncovered and starts in about ${plural(Math.max(0, Math.round(p.hoursUntilStart)), "hour", "hours")}.`,
      link: `/admin/swaps?shift=${q(p.shiftId)}`,
    }),
  },

  // -------------------------------------------------------------------------
  // Availability (M3 → M9)
  // -------------------------------------------------------------------------
  E14: {
    code: "E14",
    name: "Staff marked unavailable for a shift they're on",
    recipient: "manager",
    inApp: true,
    sms: false,
    timeCritical: false,
    mutable: true,
    mvp: true,
    deepLink: (p) => `/admin/availability?user=${q(p.staffUserId)}`,
    render: (p) => ({
      title: `${p.staffName} is now unavailable`,
      body: `They're rostered on ${p.when} but have marked themselves unavailable.`,
      smsText: `Rosterly: ${p.staffName} is rostered on ${p.when} but has marked themselves unavailable.`,
      link: `/admin/availability?user=${q(p.staffUserId)}`,
    }),
  },

  E15: {
    code: "E15",
    name: "Availability reminder before roster generation",
    recipient: "staff_without_availability",
    inApp: true,
    sms: false,
    timeCritical: false,
    mutable: true,
    // [V1.1], opt-in per business (M9 §2). Catalogued so that when it is built it
    // is already inside the table rather than bolted on beside it.
    mvp: false,
    deepLink: () => `/me/availability`,
    render: (p) => ({
      title: "Set your availability",
      body: `The roster from ${p.when} is being organised and you haven't told us when you're free.`,
      smsText: `Rosterly: the roster from ${p.when} is being organised — set your availability.`,
      link: `/me/availability`,
    }),
  },

  // -------------------------------------------------------------------------
  // Onboarding (M2 → M9)
  // -------------------------------------------------------------------------
  E16: {
    code: "E16",
    name: "You've been invited to Rosterly",
    recipient: "invited_person",
    // SMS ONLY (M9 §2) — there is no in-app yet to put it in.
    inApp: false,
    sms: true,
    timeCritical: false,
    mutable: false,
    mvp: true,
    deepLink: (p) => `/?invite=${q(p.inviteToken)}`,
    render: (p) => ({
      title: `${p.businessName} has invited you`,
      body: "Open the link to set up your roster access.",
      smsText: `${p.businessName} uses Rosterly for rosters. Open this to see your shifts:`,
      link: `/?invite=${q(p.inviteToken)}`,
    }),
  },
};

/** The spec for a code, typed to that code's payload. */
export function eventSpec<K extends EventCode>(code: K): EventSpec<K> {
  return EVENTS[code];
}

/** Render one catalogued event. The single place notification copy is written. */
export function renderEvent<K extends EventCode>(
  code: K,
  payload: EventPayloadMap[K],
): RenderedEvent {
  return EVENTS[code].render(payload);
}

/** The exact screen this event opens. Never a generic home screen (M9 §3). */
export function deepLinkFor<K extends EventCode>(code: K, payload: EventPayloadMap[K]): string {
  return EVENTS[code].deepLink(payload);
}

/**
 * The thing the event is ABOUT, used to de-duplicate and to batch (M9 §4).
 * Two enqueues of the same event, for the same person, about the same target,
 * are the same message however many times a button was pressed.
 */
export function targetKeyFor<K extends EventCode>(code: K, payload: EventPayloadMap[K]): string {
  const p: Record<string, unknown> = payload;
  const shiftId = typeof p.shiftId === "string" ? p.shiftId : null;
  if (shiftId) return `shift:${shiftId}`;
  const rosterId = typeof p.rosterId === "string" ? p.rosterId : null;
  if (rosterId) return `roster:${rosterId}`;
  const token = typeof p.inviteToken === "string" ? p.inviteToken : null;
  if (token) return `invite:${token}`;
  const rosterStart = typeof p.rosterStart === "string" ? p.rosterStart : null;
  if (rosterStart) return `roster-start:${rosterStart}`;
  return `event:${code}`;
}

/**
 * The instant after which this event is no longer worth sending (M9 §8): a text
 * queued behind quiet hours about a shift that has already started is DISCARDED,
 * not delivered at 7am. Null when the event never goes stale.
 */
export function relevantUntil<K extends EventCode>(
  code: K,
  payload: EventPayloadMap[K],
): string | null {
  const p: Record<string, unknown> = payload;
  return typeof p.startAt === "string" ? p.startAt : null;
}

/**
 * Events whose SOURCE must be a manager. Staff legitimately trigger E6 (they
 * asked for cover) and E9 (they offered); nobody but a manager publishes a
 * roster, opens a shift to the team or approves a claim. The server-side
 * enqueue endpoint enforces this — see src/app/api/notify/route.ts.
 */
export const MANAGER_ONLY_SOURCE: ReadonlySet<EventCode> = new Set<EventCode>([
  "E1",
  "E2",
  "E3",
  "E4",
  "E5",
  "E7",
  "E8",
  "E10",
  "E11",
  "E12",
  "E13",
  "E16",
]);
