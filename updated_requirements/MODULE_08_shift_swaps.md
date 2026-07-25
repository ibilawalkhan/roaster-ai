# Rosterly — Module 8: Shift Swaps (Drop → Claim → Approve)

**Status:** draft for review
**Depends on:** M1 (rules), M2 (staff, capability), M3 (availability), M6 (published roster), M9 (notification delivery)
**Feeds:** Notifications (M9), Costs (M10)

---

## 1. Purpose

What happens when a rostered person **can't make a shift**. This is the feature the customer specifically asked for, and it replaces the current reality: a flurry of WhatsApp messages, a manager chasing people mid-service, and sometimes nobody turning up.

**Confirmed design decision — the manager is the gate.**
When someone drops a shift, **only the manager is notified.** Nothing is broadcast to the team automatically. The manager then decides: handle it himself, or open it to eligible staff to claim. This keeps the team from being pestered by every drop, and keeps the manager in control of who gets asked.

**The invariant that matters most:** *a shift is never owned by two people, and never quietly owned by nobody.* Every path either ends with a named person responsible, or with the manager explicitly told it's uncovered.

---

## 2. State machine

```
ASSIGNED ──(staff requests drop)──────────► DROP_REQUESTED   → notify MANAGER only
DROP_REQUESTED ──(manager declines)───────► ASSIGNED         → notify dropper
DROP_REQUESTED ──(manager reassigns直接)──► ASSIGNED (new)   → notify new person + dropper
DROP_REQUESTED ──(manager opens to team)──► OPEN             → notify ELIGIBLE staff
OPEN ──(staff claims)─────────────────────► CLAIMED_PENDING  → notify MANAGER
CLAIMED_PENDING ──(manager approves X)────► ASSIGNED (to X)  → notify X, dropper, other claimants
OPEN | CLAIMED_PENDING ──(manager cancels)► ASSIGNED (dropper) → notify dropper
OPEN ──(shift start approaches, unfilled)─► OPEN + ALERT     → notify MANAGER "uncovered"
```

Implement exactly this. The states live on `shift.status`; every transition is recorded (§6).

---

## 3. The flow, step by step

### 3.1 Staff drops a shift **[MVP]**
- From the shift detail screen (M7 §3.2): **"I can't make this shift"** → optional short reason → confirm.
- Status → `DROP_REQUESTED`. **Only the manager is notified.**
- The staff member's view now shows the shift clearly marked **"Cover requested — waiting for manager"**. They are still responsible for it until told otherwise. Say this explicitly in the UI: *"You're still rostered until your manager confirms."* This one sentence prevents the most damaging misunderstanding available.
- **[MVP] Cutoff rule:** a business setting for how close to the start a drop can be self-requested (default: **4 hours**). Inside that window, the app tells them to call the manager instead of relying on the app. A drop request 20 minutes before service is not an app problem.

### 3.2 Manager decides **[MVP]**
The drop request appears in the manager's notifications and on the roster (the cell is visibly flagged). Four choices:

| Choice | Result |
|---|---|
| **Decline** | Shift stays with the dropper; they're notified with an optional note |
| **Reassign directly** | Manager picks someone himself (same picker and rules as M6 §3) — no team broadcast at all |
| **Open to team** | Status → `OPEN`; **eligible** staff are notified and can claim |
| **Leave it for now** | Stays `DROP_REQUESTED`; remains flagged on the roster |

### 3.3 Eligible staff claim **[MVP]**
- Only **eligible** people see the shift in their "Open shifts" list (§4). One tap: **"I can cover this."**
- Multiple people may claim; all claims are recorded with timestamps. Claimants see: *"Requested — waiting for manager."*
- Status → `CLAIMED_PENDING` on the first claim. **Manager is notified** (once per claim, or batched — see M9).

### 3.4 Manager approves **[MVP]**
- Manager sees the claimants (name, role, level, current fortnight hours, and any warning — e.g. "this would put him at 41h").
- Picks one → status → `ASSIGNED` to that person.
- **Notifications:** chosen person ("You're on for Fri 16:00–23:00"), the dropper ("Omar is covering your shift"), other claimants ("That shift has been filled").
- The change is written to the roster change log (M6 §5).

---

## 4. Eligibility — who can see and claim an open shift

An open shift is only offered to people who could **validly** take it. Reuse the hard constraints from M5 §5.1 — the same rules the solver uses, via the same shared logic:

**Must pass (or the shift isn't shown to them):**
- Holds the required role (H1) and level if specified (H10)
- Location eligible (H9)
- Available for the whole window (H2, resolved via M3's shared function)
- No overlapping shift (H3)
- Active staff (H13)

**Shown, but flagged as a warning to the manager at approval time:**
- Would exceed weekly max hours (H4) or max shifts (H5)
- Breaks minimum rest (H7) or max consecutive days (H6)
- Violates one-shift-per-day (H8)

> Rationale: hard-hiding on hour limits would leave shifts uncovered when someone is *willing* to do an extra hour and the manager is happy to allow it. Physical impossibility (overlap) hides it; policy limits warn.

**Senior coverage check at approval:** if the dropper was a senior and the proposed replacement is not, approving may create a coverage gap. The manager must be warned explicitly at that moment — *"Approving Bilal leaves no Senior on 16:00–23:00 Friday"* — and may proceed knowingly (consistent with M6's warn-don't-block philosophy).

**[V1.1] Manager control over the audience:** choose to open a shift to *everyone eligible*, to a specific role, or to named individuals. Default in MVP: all eligible staff.

---

## 5. Concurrency — the critical section

The approval step is the one place a race condition causes real harm (two people told they have the same shift). Requirements:

- **Approval runs in a single database transaction** that:
  1. re-reads the shift and asserts its status is still `OPEN` or `CLAIMED_PENDING`;
  2. re-validates the chosen claimant against the hard constraints (they may have picked up another shift since claiming);
  3. sets `assigned_user_id` and status → `ASSIGNED`;
  4. marks the winning claim `approved` and all others `rejected`;
  5. writes the change-log entry.
- If the status changed underneath (another manager or tab already approved), the transaction fails cleanly and the UI refreshes with a clear message — never a silent overwrite.
- **Claiming is also transactional**: a claim is only recorded if the shift is still `OPEN`/`CLAIMED_PENDING`. A staff member tapping "I can cover" on a shift that was just filled sees *"Sorry, this shift has already been filled."*
- Claims are **idempotent** — a double-tap or retried request creates one claim, not two.
- **Re-validation at approval is mandatory**, not optional. The gap between claiming and approving can be hours, and the claimant's situation may have changed.

---

## 6. Data model

```
shift  (extends M5)
  status              -- 'assigned' | 'drop_requested' | 'open'
                      -- | 'claimed_pending'
  drop_requested_by, drop_reason, drop_requested_at
  original_user_id    -- who it was rostered to before any swap (audit)

shift_claim (
  id, business_id, shift_id, claimant_user_id,
  outcome,            -- 'pending' | 'approved' | 'rejected' | 'withdrawn'
  created_at, decided_at, decided_by
)   -- unique (shift_id, claimant_user_id)

shift_swap_event (          -- full audit of every transition
  id, business_id, shift_id,
  from_status, to_status, action,
  actor_user_id, target_user_id, note, created_at
)
```

All carry `business_id`; RLS applies. Staff may read only their own claims and the open shifts they're eligible for.

---

## 7. Edge cases

- **Nobody claims and the shift is approaching.** At a configurable lead time (default **12 hours** before start), notify the manager: *"Sunday 16:00 Kitchen is still uncovered."* The shift **does not** revert to unassigned — if it was never reassigned, the **dropper remains responsible**, and both parties should understand that. Never let a shift silently become nobody's.
- **Dropper changes their mind.** They may withdraw the drop request while status is `DROP_REQUESTED` or `OPEN`, but **not** once someone has been approved. Manager is notified.
- **Manager cancels an open shift** → reverts to the dropper, who is notified.
- **Claimant withdraws** before approval → claim marked `withdrawn`; if it was the only claim, status returns to `OPEN`.
- **Claimant becomes ineligible** between claiming and approval (took another shift, changed availability) → surfaced to the manager at approval with the reason, and blocked if it's a physical overlap.
- **The shift is edited** (times changed) while open → existing claims are invalidated with notification, since people claimed different hours.
- **The roster is unpublished** (M6 §4.4) while swaps are in flight → freeze the swap state, notify affected parties; resolve on republish.
- **Dropper is deactivated** (M2) while a drop is pending → manager alerted; shift must be reassigned.
- **Multiple shifts dropped at once** (someone sick for a week) → each shift is an independent swap. **[V1.1]** a bulk "I'm sick this week" action.
- **Shift starts while still `OPEN`** → auto-transition to a terminal state and flag the manager for the record; do not leave it dangling in the state machine forever.

---

## 8. Acceptance criteria

- [ ] Dropping a shift notifies **only the manager** — no staff broadcast occurs at any point without the manager's explicit action.
- [ ] The dropper's UI clearly states they remain responsible until the manager confirms.
- [ ] The manager can decline, reassign directly, open to team, or defer — all four paths work and notify correctly.
- [ ] Only eligible staff (role, location, availability, no overlap) can see and claim an open shift.
- [ ] Approving re-validates the claimant and runs in one transaction; concurrent approvals result in exactly one winner and a clear message for the loser.
- [ ] Claiming an already-filled shift produces a clear "already filled" message, never an error or a duplicate assignment.
- [ ] All four parties (chosen, dropper, other claimants, manager) receive the correct notification on approval.
- [ ] Approving a replacement that breaks senior coverage warns the manager explicitly before confirming.
- [ ] An uncovered shift approaching its start time alerts the manager; ownership never becomes ambiguous.
- [ ] Every transition is recorded in `shift_swap_event` with actor and timestamp.
- [ ] Claims are idempotent under double-tap and retry.
- [ ] Tenant isolation holds: staff see only their own claims and eligible open shifts within their business.

## 9. Out of scope for this module

Direct staff-to-staff swaps without manager approval (deliberately excluded — the manager is the gate), notification delivery mechanics (M9), automatic best-candidate selection [V1.1 — the manager chooses; a "recommended" hint could come later], shift bidding or seniority-based allocation rules [LATER], bulk sickness reporting [V1.1], overtime approval workflows [LATER].
