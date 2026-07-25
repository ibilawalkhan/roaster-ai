# Rosterly — Module 1: Business Setup & Configuration

**Status:** draft for review
**Depends on:** nothing (this is the foundation)
**Feeds:** Team (M2), Availability (M3), Week Template (M4), Auto-scheduler (M5), Costs (M10)

---

## 1. Purpose

Everything else in Rosterly depends on a small set of facts about the restaurant: where it operates, what jobs exist, when it's open, and what rules its rosters must obey. This module captures those facts **once**, during onboarding, so that every later screen — especially the auto-scheduler — has something concrete to work with.

**Design principle:** this is a one-time setup, done with the manager (ideally with you sitting beside them on day one). It can ask for more than the weekly screens do, but it must still be completable by a non-technical restaurant owner in **under 15 minutes**. Anything that can have a sensible default, has one.

---

## 2. Who uses it

- **Manager/owner** — completes it at onboarding, edits occasionally (new role added, trading hours change).
- **Staff** — never see this module.

---

## 3. What gets configured

### 3.1 Business profile **[MVP]**

| Field | Notes | Default |
|---|---|---|
| Business name | Shown in the app header | — |
| Timezone | Fixed to `Australia/Sydney` for now; stored so it's not hard-coded later | Australia/Sydney |
| Week starts on | Affects how rosters and templates are laid out | Monday |
| Roster period | `week` or `fortnight` | Fortnight |
| Currency | Display only | AUD |

> The existing prototype hard-codes a business. This module replaces that with real, editable records — see the tenancy rules in REQUIREMENTS.md §1.

### 3.2 Locations **[MVP]**

Each business has **one or more locations**. v1 assumption: most customers have one; the model supports more so multi-site is a later toggle, not a rebuild.

| Field | Notes |
|---|---|
| Name | e.g. "Regents Park" |
| Address | Optional, display only |
| Active | Inactive locations keep history but can't be rostered |

**Rule:** a business must always have at least one active location. The last active location cannot be deactivated.

### 3.3 Trading hours (open hours) **[MVP — required by the scheduler]**

Per **day of week**, per **location**: the window the restaurant is open.

| Field | Notes |
|---|---|
| Day | Mon–Sun |
| Open / Closed | A closed day has no hours and no requirements |
| Opens at | e.g. 10:00 |
| Closes at | e.g. 22:30 |
| 24 hours | Toggle — the location trades continuously that day |

**Why this is mandatory:** the senior-coverage rule (§3.6) is defined as "a Senior must be present during **all open hours**." Without a defined window, that rule has no meaning and the scheduler cannot validate it.

**Overnight handling:** if `closes at` is earlier than or equal to `opens at` (e.g. 18:00 → 02:00), the closing time is on the **following day**. The system must treat this as one continuous trading window, not an error. A 24-hour day is a special case of this.

### 3.4 Roles **[MVP]**

The jobs people do. An editable list per business — not a fixed set, because a pizza shop and a charcoal chicken shop differ.

| Field | Notes |
|---|---|
| Name | e.g. Kitchen, Front of House, Driver, Cashier, Manager |
| Short code | 2–4 chars for the dense roster grid (KIT, FOH, DRV) |
| Colour | Used on the roster grid for fast visual scanning |
| Active | Inactive roles keep history, can't be assigned to new shifts |

**Seeded defaults on signup** (editable/removable): Kitchen (KIT), Front of House (FOH), Driver (DRV), Manager (MGR). Starting from a sensible list is far friendlier than an empty screen.

**Rule:** a role that is used by any existing shift or staff member cannot be hard-deleted — only deactivated.

### 3.5 Levels **[MVP]**

Fixed system values, **not** editable by the business (they carry scheduler logic):

- **Junior**
- **Mid**
- **Senior**

Configurable part: **which levels satisfy the "senior present" rule.** Default: `Senior` only. Some restaurants may want `Mid or above` to count — one setting, big flexibility, no new concepts.

### 3.6 Scheduling rules **[MVP — these are the auto-scheduler's hard constraints]**

The rules every generated roster must obey. Each has a sane default so the manager can accept them all and move on.

| Rule | Type | Default | Notes |
|---|---|---|---|
| **Senior coverage** | Hard | On — "at least 1 senior-qualifying person present during all open hours" | The headline rule. Can be turned off by businesses that don't need it. Minimum count configurable (1 or 2). |
| Max hours per week (per employment type) | Hard | Casual 38, Part-time 30, Full-time 38 | Overridable per person in M2 — the per-person value wins. |
| Max consecutive days | Hard | 6 | Prevents 7-day weeks. |
| Minimum rest between shifts | Hard | 10 hours | Standard hospitality practice; prevents close-then-open ("clopening"). |
| Max shift length | Hard | 12 hours | Safety valve against absurd assignments. |
| Min shift length | Hard | 3 hours | Avoids uselessly short shifts. |
| One shift per person per day | Hard | On | Off = split shifts allowed. Keep On for v1 simplicity. |
| Allow overnight shifts | Config | On (needed by 24h customers) | Off simplifies validation for daytime-only shops. |

**Soft preferences** (the scheduler optimises these; the manager ranks them):
1. Even distribution of hours across staff (fairness)
2. Lower labour cost
3. Respect stated shift preferences
4. Consistency week to week (people keep similar shifts)

Default ranking: **fairness first, then cost.** Presented as a simple drag-to-rank or a "what matters most?" choice — not as numeric weights.

### 3.7 Break rules **[MVP — affects cost estimates]**

Unpaid break automatically suggested by shift length. Manager can override per shift.

| Shift length | Default unpaid break |
|---|---|
| < 5 hours | 0 min |
| 5 – 8 hours | 30 min |
| > 8 hours | 45 min |

> These are **rostering conveniences only**, not award interpretation. The estimate-not-payroll disclaimer (REQUIREMENTS.md §0) applies.

### 3.8 Public holidays **[V1.1]**

A list of dates where trading hours differ or the shop is closed. In MVP, handled as a manual per-week exception when creating a roster (M5). Deferred because a full holiday calendar is more setup burden than it's worth on day one.

---

## 4. Screens

### 4.1 Setup wizard (first-run) **[MVP]**
A short, guided sequence for a brand-new business — this is the first thing a new customer sees:

1. **Business** — name, roster period.
2. **Locations** — add first location.
3. **Trading hours** — per day; a "same every day" shortcut plus per-day overrides; closed-day and 24-hour toggles.
4. **Roles** — pre-filled defaults; add/remove/rename.
5. **Rules** — all defaults pre-selected, shown in plain language with a one-line "what this means"; manager confirms or adjusts. Priority ranking for soft preferences.
6. **Done** → routed to Team (M2) to add staff.

Progress must be visible, every step skippable-with-defaults except locations and trading hours, and the whole thing resumable if they close the tab.

### 4.2 Settings (ongoing) **[MVP]**
The same content as tabs for later edits: Business · Locations · Trading hours · Roles · Rules · Breaks. Plain-language descriptions, not jargon.

---

## 5. Data model

```
business        (id, name, timezone, week_start_day, roster_period,
                 currency, subscription_status, created_at)

location        (id, business_id, name, address, active)

trading_hours   (id, business_id, location_id, day_of_week,
                 is_open, opens_at, closes_at, is_24h)
                 -- one row per location per weekday

role            (id, business_id, name, short_code, colour, active)

scheduling_rule (id, business_id,
                 senior_coverage_enabled, senior_min_count,
                 senior_qualifying_levels[],
                 max_hours_casual, max_hours_part_time, max_hours_full_time,
                 max_consecutive_days, min_rest_hours,
                 max_shift_hours, min_shift_hours,
                 one_shift_per_day, allow_overnight,
                 soft_priority_order[])

break_rule      (id, business_id, min_hours, max_hours, break_minutes)
```

All tables carry `business_id`; RLS scopes every read/write by it (REQUIREMENTS.md §9).

---

## 6. Validation & edge cases

- Trading hours: `closes_at == opens_at` is only valid when `is_24h` is true; otherwise reject.
- A location cannot be deactivated if it is the last active one, or if it has future shifts (warn and require confirmation).
- A role cannot be deleted if referenced by any staff member or shift — deactivate instead.
- `senior_min_count` cannot exceed the number of active senior-qualifying staff — warn at save time ("you have 1 Senior but require 2 present; rosters will fail to generate").
- `min_shift_hours` must be ≤ `max_shift_hours`; `max_consecutive_days` between 1 and 7.
- Changing rules does **not** retroactively alter published rosters. It applies to the next generation. Show this explicitly when rules are edited.
- Deactivating a location or role must never delete history — past rosters and costs stay intact.

---

## 7. Acceptance criteria

- [ ] A new business can complete setup end-to-end in under 15 minutes with no prior training.
- [ ] Trading hours support: normal days, closed days, overnight (18:00→02:00) and 24-hour days.
- [ ] Roles are seeded with sensible defaults and are fully editable.
- [ ] All scheduling rules have working defaults; a manager who clicks through accepting everything ends with a valid, usable configuration.
- [ ] Saving a rule that is impossible to satisfy (e.g. 2 seniors required, 1 senior employed) produces a clear warning at save time, not a failure later during generation.
- [ ] Setup is resumable — closing the browser mid-wizard loses nothing.
- [ ] All configuration is scoped to the business; the tenant-isolation test passes for every table in §5.
- [ ] Editing configuration never alters an already-published roster.

## 8. Out of scope for this module

Public holiday calendar (V1.1), per-location rule overrides (LATER), award/penalty-rate configuration (never — REQUIREMENTS.md §0), self-serve business signup (LATER — you create businesses manually).
