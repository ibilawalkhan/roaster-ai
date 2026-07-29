// Module 9 §2 — turning the store's people into notification recipients.
//
// Every call site has to answer the catalogue's RECIPIENT RULE, and getting it
// wrong is how a private drop request becomes a group text. These helpers exist
// so each call site answers it in one readable line, and so `active` and
// `hasPhone` — the two facts the policy needs (M9 §8) — are never forgotten.
//
// Pure; no I/O.

import type { TeamMember } from "../types";
import type { NotifyRecipient } from "./index";

/**
 * One person, with the two throttling facts M9 §8 turns on: a deactivated staff
 * member's notifications are suppressed and logged, and somebody with no mobile
 * number gets the in-app copy and an explicit `no_phone` record rather than a
 * silent nothing.
 */
export function toRecipient(member: TeamMember): NotifyRecipient {
  return {
    userId: member.id,
    active: member.active,
    hasPhone: member.phone.trim().length > 0,
  };
}

/** The named people, in the order given. Unknown ids are dropped, not guessed. */
export function recipientsFor(
  team: readonly TeamMember[],
  userIds: readonly (string | null | undefined)[],
): NotifyRecipient[] {
  const wanted = new Set(userIds.filter((id): id is string => typeof id === "string" && id !== ""));
  return team.filter((m) => wanted.has(m.id)).map(toRecipient);
}

/**
 * Managers of this business, for a caller that can actually see the team (i.e.
 * a manager screen). STAFF screens must use the `MANAGERS` sentinel instead —
 * they cannot read colleagues' rows, so `team` holds only themselves and this
 * would silently return nobody.
 */
export function managerRecipients(team: readonly TeamMember[]): NotifyRecipient[] {
  return team.filter((m) => m.isManager && m.active).map(toRecipient);
}
