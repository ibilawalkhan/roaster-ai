# Rosterly — Module 3: Availability

**Status:** draft for review
**Depends on:** M1 (trading hours, timezone), M2 (staff records)
**Feeds:** Auto-scheduler (M5) — as a **hard constraint**; Draft review (M6); Swaps (M8)

---

## 1. Purpose

When each person **can and cannot work**. This is the single most important input to the auto-scheduler after the staffing requirements themselves: the solver is only as good as this data. A roster generated from stale or missing availability will place people who can't work, and the manager will stop trusting the whole feature after one bad week.

**Design principle:** availability must be **almost free to maintain**. Most people's availability is stable, so it is entered once as a repeating weekly pattern, and only *changes* are entered week to week. If maintaining it feels like a chore, staff won't do it and the feature dies.

---

## 2. Who uses it

- **Staff** — set their own default pattern and add exceptions ("can't do this Saturday").
- **Manager** — can view everyone's availability and **edit on anyone's behalf** (essential: some staff will never open the app; the manager still knows they can't work Tuesdays).

Both write to the same records; the UI records **who set it** so the manager can tell their own entries from the staff member's.

---

## 3. The model: pattern + exceptions

Two layers, resolved at read time.

### 3.1 Default weekly pattern **[MVP]**
Per person, per day of week: are they available, and if so, between what times?

| Day | Available | From | To |
|---|---|---|---|
| Mon | Yes | 16:00 | 23:00 |
| Tue | **No** | — | — |
| Wed | Yes | (any time) | |
| … | | | |

- "Available (any time)" is the simple default — it means "any time the business is open that day."
- A time window narrows it: "only after 4pm," "only 10am–4pm." This covers the common student/second-job cases without a complex calendar.
- Marking a day unavailable is a single tap.

### 3.2 Date exceptions **[MVP]**
One-off overrides for a specific date, in either direction:

- **Unavailable this date** — "can't do Saturday 14 Aug, wedding."
- **Available this date** — a normally-unavailable day they *can* work this once.
- Optional reason (free text, short). Visible to the manager only.

### 3.3 Resolution rule (implement exactly)
For any person + date:
1. If a **date exception** exists for that date → it wins, entirely.
2. Otherwise → use the **weekly pattern** for that day of week.
3. If no pattern has ever been set → treat as **available all open hours**, and flag the person as **"availability not set"** (see §4).

Then intersect with the business's **trading hours** for that day (M1): someone "available any time" on a day the shop opens 10:00–22:30 is available 10:00–22:30.

### 3.4 The "not set" problem — an explicit decision
Two possible defaults, and this choice matters:

- **Default = available (chosen).** New staff are assumed available until they say otherwise. The app works from day one even if nobody fills anything in, consistent with M2's rule that staff adoption is not required.
- Default = unavailable would be "safer" but makes the product unusable until every person completes a form — an unacceptable onboarding cliff.

**Mitigation, which is mandatory:** anyone who has never had availability set is clearly badged **"availability not set"** in the team list, in the manager's availability view, and in the auto-scheduler's pre-flight check ("4 people have no availability recorded — rosters may place them when they can't work"). The risk is made visible rather than hidden.

---

## 4. Screens

### 4.1 Staff: My availability (phone) **[MVP]**
- Seven day rows, each a simple toggle: **Available / Not available**, with an optional "only between ___ and ___".
- Below: **Exceptions** — "Add a date I can't work" (date picker + optional reason), and the list of upcoming exceptions with remove.
- Dead simple, big tap targets, no calendar grid. Should take under a minute to complete for the first time.
- Clear confirmation on save, and a plain statement of what it means: *"Your manager will see this when building the roster."*

### 4.2 Manager: Team availability view **[MVP]**
A grid of **people × the 7 days** of the week being rostered, showing each person's resolved availability (available / limited hours / unavailable), with "not set" badges. This is what the manager scans before generating, and what explains the auto-scheduler's choices afterwards.

- Editable in place — the manager can set availability for anyone.
- Entries show provenance: set by the staff member vs set by the manager.
- Filter by location/role; highlight people with **no availability recorded**.

### 4.3 Inline in the roster **[MVP]**
When the manager manually assigns someone to a shift they're unavailable for (M6), the app **warns immediately and clearly** but does **not** block — the manager may know something the app doesn't ("he told me he's free this once"). The warning must name the reason: *"Nadia is marked unavailable Tue after 6pm."*

---

## 5. Interaction with published rosters (important)

This is where availability features usually go wrong. The rules:

- **Changing availability never silently removes an existing shift.** If a staff member marks themselves unavailable for a date they're already rostered on, the shift stays and the app **notifies the manager**: *"Layla is now unavailable Sat 16 Aug — she's rostered 11:30–19:30."*
- The staff member is prompted at that moment to use the proper path: **"You're rostered that day — request cover?"** which hands off to the drop flow (M8). Availability and shift-dropping are different actions and must not be conflated.
- Availability changes apply to **future generations**, not retroactively to a published roster.

**[V1.1] Advance-notice rule:** an optional business setting — "availability changes for the next N days need manager approval" (default off). Restaurants that need this will ask; don't build the approval workflow before someone does.

---

## 6. Data model

```
availability_pattern (
  id, business_id, user_id,
  day_of_week,            -- 0..6
  is_available,           -- bool
  from_time,              -- nullable = any time
  to_time,                -- nullable = any time
  updated_by_user_id, updated_at
)   -- one row per user per weekday

availability_exception (
  id, business_id, user_id,
  date,
  is_available,           -- true = available this date, false = unavailable
  from_time, to_time,     -- nullable = whole day
  reason,                 -- nullable, short text
  source,                 -- 'staff' | 'manager'
  created_by_user_id, created_at
)   -- unique per (user_id, date)

-- Derived, never stored:
--   resolved_availability(user, date) = exception ?? pattern ?? default-available
--                                        ∩ trading_hours(date)
```

- Resolution happens in **one shared function** used by the scheduler, the roster warnings, and the manager view — so all three can never disagree. This is a hard rule: no duplicate resolution logic.
- All rows carry `business_id`; RLS restricts staff to **their own** rows, managers to their business.

---

## 7. Validation & edge cases

- `from_time` must be before `to_time` unless the business allows overnight (M1) and the window crosses midnight — in which case treat as continuing into the next day, consistent with trading-hours handling.
- Availability outside trading hours is harmless (it gets intersected away), but the UI should note it: *"You're available 6am–10am but the shop opens at 10."*
- An exception for a past date is pointless — hide past exceptions from the staff view, keep them in data for auditing.
- A person marked unavailable **every** day is legal (someone on extended leave) but should warn the manager, and the scheduler must not treat it as an error.
- If **too many** people are unavailable for a slot, that's a scheduler infeasibility (M5) — not an availability error. Handle it there, with a clear message.
- Deactivated staff (M2) are excluded from availability views entirely.
- Timezone: all dates/times resolved in the business's timezone (M1), stored UTC. Test around a daylight-saving change — an availability window of "4pm–11pm" must not drift by an hour.
- Exceptions are **unique per user per date** — adding a second one for the same date replaces the first (with confirmation), never silently duplicates.

---

## 8. Acceptance criteria

- [ ] A staff member can set their full weekly pattern in under a minute on a phone.
- [ ] A manager can set or change availability for any staff member, and see who set each entry.
- [ ] Exceptions correctly override the weekly pattern for that date, in both directions (unavailable *and* available).
- [ ] Resolved availability is intersected with trading hours and produced by **one shared function** used by scheduler, warnings, and manager view.
- [ ] People with no availability recorded are visibly badged everywhere it matters, including a pre-flight warning before auto-generation.
- [ ] Marking unavailable on an already-rostered date does **not** remove the shift; it notifies the manager and offers the drop flow.
- [ ] Manually assigning someone to a shift they're unavailable for warns clearly but does not block.
- [ ] Staff can read and write only their own availability; the tenant-isolation test passes.
- [ ] Availability windows survive a daylight-saving boundary without shifting.

## 9. Out of scope for this module

Leave requests with manager approval workflow [LATER — M3 covers "I can't work then", not formal leave], recurring exceptions ("every second Tuesday") [LATER], availability approval/cutoff windows [V1.1], holiday accrual or entitlements (never — not an HR system).
