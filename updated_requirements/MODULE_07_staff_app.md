# Rosterly — Module 7: Staff App (Phone View)

**Status:** draft for review
**Depends on:** M2 (staff records, invites), M3 (availability), M6 (published rosters)
**Feeds:** Swaps (M8), Notifications (M9)

---

## 1. Purpose

What the **staff member** sees. Almost everything in Rosterly is built for the manager; this is the half built for the other twelve people, and it has completely different requirements.

**Design principles — these override feature ambitions:**

1. **One question answered instantly:** *"When am I working next?"* That is why staff open the app. Everything else is secondary.
2. **Phone-first, one-handed, big-tap.** Used standing up, between tasks, sometimes with wet or gloved hands, on a cracked screen.
3. **Assume limited English.** Short, concrete labels. No jargon, no clever copy.
4. **Assume bad connectivity.** Kitchen wifi is poor and back rooms have no signal.
5. **Zero learning curve.** No onboarding, no tour, no settings to understand. If a new kitchen hand can't use it without being taught, it's wrong.
6. **The system must work if staff never use this at all** (M2). This app is an enhancement, never a dependency.

---

## 2. Getting in

- **Invite:** SMS with a link (M2 §4.4) → tap → phone-number OTP login → done. No password, no app store, no install.
- **Session persists** for a long period (e.g. 60 days) — a staff member re-logging-in every week will simply stop using it.
- **Deep links:** every SMS notification (M9) links straight to the relevant screen (a specific shift, an open shift, availability). Tapping a text must never dump them on a generic home screen.
- **"Add to home screen"** prompt after the second visit, so it feels like an app without being one. Nothing depends on it.
- **Signed-out state** is a single screen: enter mobile → code → in.

---

## 3. Screens

### 3.1 My shifts (home) **[MVP]**

**Next shift — the hero.** Large, unmissable, at the top:
> **Tomorrow · Fri 8 Aug**
> **16:00 – 23:00** · Kitchen · Regents Park
> 6h 30m paid · 30 min break

If the next shift is *today*, say "Today" and make it more prominent still. If there is no upcoming shift, say so plainly and usefully: *"No shifts scheduled. Your manager publishes the next roster soon."*

**Below:** the rest of the upcoming shifts as a simple chronological list (day, date, times, role, location). Grouped by week. Past shifts are not shown by default — a "previous shifts" link is enough.

**Fortnight summary:** hours and estimated pay for the current roster period, with the **estimate-not-payroll** disclaimer (REQUIREMENTS.md §0) in plain words: *"Estimate for your information only — your actual pay comes from your employer's payroll."*

### 3.2 Shift detail **[MVP]**
Tap any shift:
- Date, start–end, role, location (with address), unpaid break, paid hours, estimated pay for that shift.
- Any note the manager added.
- **Who else is on** — names and roles of colleagues working an overlapping shift at the same location. Genuinely useful ("am I on with Sara tonight?") and socially expected. **Never** shows anyone's pay rate or hours.
- Primary action: **"I can't make this shift"** → hands off to M8.

### 3.3 My availability **[MVP]**
Per M3 §4.1 — weekly pattern toggles plus date exceptions. Reachable from the home screen in one tap, because it's the only thing staff are asked to *maintain*.

### 3.4 Open shifts **[MVP — full behaviour in M8]**
A simple list: *"Shifts available to cover."* Only appears when there are any. Each shows day, time, role, location, and one action: **"I can cover this."**

### 3.5 Notifications **[MVP — mechanics in M9]**
A short list of recent events relevant to them (roster published, you got the shift, shift changed). Read/unread. No settings, no categories.

### 3.6 Profile **[MVP]**
- Read-only: role(s), level, pay rate, home location, employment type.
- Editable: own mobile and email.
- Sign out.
- Nothing else. Resist adding anything here.

---

## 4. What staff can and cannot see

| Can see | Cannot see |
|---|---|
| Their own shifts (published rosters only) | Any draft or unpublished roster |
| Their own hours, rate, estimated pay | Anyone else's rate, hours, or pay |
| Colleagues' **names and roles** on overlapping shifts | Colleagues' contact details, availability, or personal notes |
| Open shifts offered to them | The full roster grid, cost reports, or anything in the manager app |
| Their own availability | Manager notes about them (M2 `notes` field is manager-only) |

Enforced at the database via RLS, not by hiding UI (REQUIREMENTS.md §9). This table is effectively a test specification — write the isolation tests directly from it.

---

## 5. Connectivity & performance

- **Cache the last-loaded roster** so "when am I working?" is answerable with no signal. Show a quiet timestamp — *"Updated 2 hours ago"* — so stale data is never mistaken for current.
- Any action requiring the network (dropping a shift, claiming, saving availability) must clearly report success or failure and be safely retryable. **Never** show an optimistic "done" for something that didn't reach the server — a staff member believing their drop request was sent when it wasn't is a genuine operational failure.
- Target: home screen usable within ~2 seconds on a mid-range phone over 4G.

---

## 6. Data model

No new tables. This module is read paths over M2/M3/M6 data, plus:

```
user_session_meta (optional, [V1.1])
  last_seen_at, last_notification_read_at
```

Useful for the manager to know who has actually seen a published roster — a frequent real-world question ("did everyone see it?"). Defer unless asked.

---

## 7. Edge cases

- **Roster unpublished after they saw it** (M6 §4.4) → their shifts disappear; show a clear message, not an empty screen: *"Your manager has withdrawn this roster. A new one is coming."*
- **Shift changed after they saw it** → the change is notified (M9) and the detail screen reflects it; never silently update without a notification.
- **Staff member deactivated** while logged in → next action returns them to a polite signed-out state, not an error.
- **Overnight shifts** display honestly: *"Fri 22:00 – Sat 06:00"* so nobody misreads the finish day.
- **Shift at a location they don't normally work** → show the location prominently; this is exactly when people turn up at the wrong shop.
- **No shifts at all** (new starter, or not rostered this period) → helpful empty state, never a blank screen.
- **Two shifts same day** (if split shifts are enabled) → both shown clearly, not merged.
- **Timezone/DST** — times always render in the business timezone (M1), never the phone's, in case someone's phone is set oddly.

---

## 8. Acceptance criteria

- [ ] A staff member can answer "when do I work next?" within **3 seconds** of opening the app, including from a cold start.
- [ ] Login is phone + OTP only; sessions persist for weeks.
- [ ] SMS deep links land on the exact relevant screen, not the home screen.
- [ ] Only published rosters are visible; drafts are invisible and unreachable at the database level.
- [ ] A staff member cannot read any other person's pay rate, hours, or availability — verified by the isolation test derived from §4.
- [ ] Colleagues on overlapping shifts are visible by name and role only.
- [ ] The last-loaded roster is readable with no connectivity, with a visible "last updated" timestamp.
- [ ] No action ever reports success unless the server confirmed it.
- [ ] Overnight shifts state both days explicitly.
- [ ] Every screen has a designed empty state; none is ever blank.
- [ ] Usable one-handed: primary actions reachable with a thumb, tap targets ≥ 44px.

## 9. Out of scope for this module

The drop/claim workflow itself (M8), notification delivery mechanics (M9), clock-in/clock-out (never in v1 — rostered ≠ worked), shift-time preferences beyond M2, staff-to-staff messaging [LATER], payslips or timesheets (never — REQUIREMENTS.md §0), native app or true push notifications [LATER].
