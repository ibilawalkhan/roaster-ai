# Rosterly — Module 4: Week Template (Staffing Requirements)

**Status:** draft for review
**Depends on:** M1 (trading hours, roles, levels, rules), M2 (staff — for feasibility checks)
**Feeds:** Auto-scheduler (M5) — this is the **demand** side of the problem; Draft review (M6); Costs (M10)

---

## 1. Purpose

The auto-scheduler answers "**who** works?" — but something has to define "**what does the restaurant need?**" first. That's this module.

The manager designs their normal week **once**: for each day, which shifts need to exist, in which role, at what times, and how many people. The scheduler then fills those requirements with real people, every week, on demand.

**Why a template and not weekly entry:** a restaurant's staffing shape is ~90% identical week to week. Making the manager re-specify it every week would be the single biggest usability failure available. Front-load the effort into a one-time setup (done during onboarding, ideally with you present), and the weekly action collapses to one click plus small tweaks.

**Design risk:** this screen has no obvious industry pattern to copy and is the most conceptually unfamiliar thing in the product. It must look and feel like the roster grid the manager already understands — same shape, but cells contain **requirements**, not people.

---

## 2. The core concept: a slot

A **slot** is one staffing requirement:

> *"Friday, Kitchen, 16:00–23:00, 2 people"*

| Field | Required | Notes |
|---|---|---|
| Day of week | Yes | Mon–Sun |
| Location | Yes | Defaults to the only/primary location |
| Role | Yes | From M1's active roles |
| Start time | Yes | |
| End time | Yes | May cross midnight (overnight) |
| Count | Yes | How many people needed (default 1) |
| Required level | No | e.g. "must be Senior" — optional per-slot override |
| Label | No | Free text ("open", "close", "lunch rush") — display only |

**Everything else falls out of this primitive:**
- **24-hour operation:** three slots chained across the day — 06:00–14:00, 14:00–22:00, 22:00–06:00 (+1).
- **Overlapping day shifts:** four slots with different times — 09:00–18:00, 10:00–16:00, 14:00–21:00, 16:00–22:30. Overlaps are normal and expected.
- **Busy Friday:** same slot with count 3 instead of 1.
- **Quiet Monday:** fewer slots.

There is deliberately **no "shift type" configuration** ("morning shift", "evening shift"). Restaurants differ too much; forcing them into named shift types would break for the next customer. Freedom comes from *not* constraining.

---

## 3. Senior coverage — how it interacts

Two distinct mechanisms; keep them separate:

1. **Business-wide senior coverage (M1 §3.6)** — "at least 1 senior-qualifying person present during **all open hours**." This is a **timeline** rule, not a per-slot rule. It does not require every slot to contain a senior; it requires that, at every moment the shop is open, *someone* senior is on. Your example — a senior 10:00–17:00 and another senior 16:00–23:00 — satisfies it with an overlap.
2. **Per-slot required level (optional)** — "this particular slot must be filled by a Senior." Use when a specific position needs seniority regardless of coverage (e.g. the closing shift).

The template screen must show, per day, whether the **defined slots can even satisfy** the coverage rule — see §5.2.

---

## 4. Screens

### 4.1 Template grid **[MVP — the main screen]**

Seven columns (Mon–Sun). Each column contains that day's slots as compact cards: role code, times, count (e.g. `KIT 16:00–23:00 ×2`). Visually echo the roster grid so it's instantly familiar.

Per column, show a summary: **total people needed**, **total hours**, and **estimated cost** for that day.

Header shows trading hours for each day (from M1) so requirements are always designed against reality — and closed days are visibly closed, not just empty.

### 4.2 Add / edit a slot **[MVP]**
Tap an empty area of a day → small form: role, start, end, count, optional required level, optional label. Times default sensibly to the day's trading hours on first use.

### 4.3 Copy day → other days **[MVP]**
The biggest time-saver in setup: build Monday, then "copy to Tue, Wed, Thu." Most restaurants have 3–4 distinct day shapes (weekday, Friday, Saturday, Sunday), not 7.

### 4.4 Build template from an existing week **[MVP — strongly recommended]**
Al Tazah already has real rosters. Offer: **"Create template from a past week"** → pick a typical week → the system converts its actual shifts into slots (grouping identical role+times into counts) → the manager reviews and adjusts.

This turns a blank-page setup into an edit task, and it's the single highest-value onboarding shortcut in the product. For a new customer with no history, the blank path plus copy-day is the fallback.

### 4.5 Named templates **[V1.1]**
Multiple templates per business ("Normal week", "School holidays", "Summer"), one marked default. Design the data model for it now (`template.name`, `is_default`) but ship with exactly one template in MVP.

---

## 5. Validation & feasibility checks

These checks are what make the auto-scheduler feel reliable — they catch impossible situations at **template design time**, not at generation time when the manager is in a hurry.

### 5.1 Slot-level validation **[MVP]**
- Slot times must fall within that day's trading hours (M1). Outside → **block** with a clear message, or offer to extend trading hours.
- Slot length must satisfy min/max shift length rules (M1 §3.6).
- Overnight slots only allowed if the business permits them (M1); a slot crossing midnight belongs to its **start** day.
- Count must be ≥ 1.
- Role must be active.

### 5.2 Coverage checks (per day) **[MVP]**
- **Open-hours gap:** if trading hours are 10:00–22:30 but the slots only span 10:00–20:00, warn: *"No one is rostered 20:00–22:30 on Wednesday."* Warn, don't block — the manager may genuinely want a skeleton close.
- **Senior coverage impossible:** if the senior rule is on and the day's slots can't produce continuous senior presence (e.g. a 06:00–10:00 window where no slot could hold a senior), warn explicitly with the exact uncovered window. This is the check that prevents a mysterious infeasible generation later.

### 5.3 Supply-vs-demand pre-check **[MVP — high value]**
Compare what the template *demands* against what the team can *supply*:
- Total hours demanded per week vs sum of staff max-hours → *"Your template needs 320 hours; your team's limits total 280. Rosters will be short-staffed."*
- Per role: *"You need 6 Kitchen shifts Friday but only 4 people can work Kitchen."*
- Senior availability: *"Senior presence required 10:00–23:00 but you have 2 seniors with 38h/week limits — that's not enough to cover 91 hours."*

This is the difference between a manager understanding *why* the scheduler struggles and thinking the software is broken. Show it as a persistent panel on the template screen, updating as they edit.

### 5.4 Cost preview **[MVP]**
Estimated weekly labour cost of the template (using average or actual rates for eligible staff). Owners care deeply about this — it lets them shape staffing to a budget *before* generating anything. Carries the estimate-not-payroll disclaimer (REQUIREMENTS.md §0).

---

## 6. Data model

```
week_template (
  id, business_id, name, is_default, active, created_at, updated_at
)

template_slot (
  id, business_id, template_id,
  location_id,
  day_of_week,           -- 0..6
  role_id,
  start_time, end_time,  -- end may be <= start ⇒ crosses midnight
  crosses_midnight,      -- derived, stored for query simplicity
  count,                 -- how many people needed
  required_level,        -- nullable: 'senior' | 'mid' | null
  label,                 -- nullable, display only
  active
)
```

- A generated roster (M5) **copies** slots into concrete dated shift requirements — it never references the template live. Editing the template must not alter an already-generated or published roster.
- All rows carry `business_id`; RLS applies (REQUIREMENTS.md §9).

---

## 7. Edge cases

- **Closed days:** no slots allowed; adding one prompts to open that day in M1 first.
- **24-hour days:** slots chain across midnight; the last slot's end may equal the next day's first slot's start. The system must not treat the midnight boundary as a gap.
- **Trading hours changed after the template exists** (M1): re-run §5.2 and flag any slot now outside hours — don't silently drop it.
- **Role deactivated** (M1) while slots reference it: warn on the role screen, keep the slot but mark it invalid until reassigned.
- **Multi-location:** slots are per location; a business with two locations designs both. The grid needs a location filter, same as the roster.
- **Empty template:** generation cannot run. Block it with a clear message pointing to this screen — never let a manager click "Auto-generate" and get an empty roster with no explanation.

---

## 8. Acceptance criteria

- [ ] A manager can design a full week of requirements in **under 20 minutes** from scratch, or under 5 minutes using "build from a past week."
- [ ] Slots support overlapping times, overnight windows, and 24-hour days without special modes.
- [ ] "Copy day to other days" works and is discoverable.
- [ ] A slot outside trading hours is blocked with an actionable message.
- [ ] Uncovered open-hours windows are warned about, per day, with the exact time range named.
- [ ] The senior-coverage feasibility check runs at template time and names the uncovered window when it fails.
- [ ] The supply-vs-demand panel correctly reports total hours and per-role shortfalls against the current team.
- [ ] Weekly cost estimate displays with the estimate-not-payroll disclaimer.
- [ ] Editing the template does not alter any generated or published roster.
- [ ] Tenant-isolation test passes for template and slot tables.

## 9. Out of scope for this module

Multiple named templates [V1.1], demand forecasting from sales data [LATER], seasonal auto-switching [LATER], per-slot named individuals ("always put Sara here") — pinning belongs to the roster, not the template [see M5 lock-and-regenerate], budget targets as hard limits [LATER].
