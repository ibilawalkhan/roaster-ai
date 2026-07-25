# Rosterly — Module 2: Team (Employees)

**Status:** draft for review
**Depends on:** M1 (locations, roles, levels, employment-type hour defaults)
**Feeds:** Availability (M3), Auto-scheduler (M5), Draft review (M6), Staff app (M7), Swaps (M8), Costs (M10)

---

## 1. Purpose

The people the roster is built from. This module captures **who works here and what each person can do**, in enough detail for the auto-scheduler to make valid assignments — without turning staff setup into an HR system.

Two audiences for the same records:
- The **scheduler** needs facts: which roles they can work, their level, their hour limits, their location.
- The **manager** needs a usable contact list and pay rates for cost estimates.

**Design principle:** adding a staff member must take **under 60 seconds**. A restaurant onboarding 12 people should be done in about 10 minutes. Every field that can default, does.

---

## 2. Who uses it

- **Manager/owner** — adds, edits, deactivates staff; sets pay rates and levels. Full access.
- **Staff** — can view and edit **only their own contact details** (phone, email). They can *see* their own rate, role, and level but never change them, and never see anyone else's.

> Privacy note: this module holds personal information (names, phone numbers, pay rates). Tenant isolation and per-user access rules (REQUIREMENTS.md §9) are load-bearing here, not optional.

---

## 3. What gets captured

### 3.1 Identity & contact **[MVP]**

| Field | Required | Notes |
|---|---|---|
| Full name | Yes | Displayed on the roster grid |
| Mobile number | Yes | The login identity (phone OTP) and the notification channel. Unique within the business. |
| Email | No | Optional secondary contact |
| Photo / initials | Auto | Initials avatar generated from the name; no upload needed |
| Roster colour | Auto | Assigned automatically, editable — used for fast visual scanning on the grid |

### 3.2 Work capability — **the scheduler's inputs** **[MVP]**

| Field | Required | Default | Notes |
|---|---|---|---|
| **Roles they can work** | Yes | — | **Multi-select** from the business's active roles (M1 §3.4). A person may be Kitchen *and* FOH. This is the single biggest lever on how well the auto-scheduler performs — more capable people means more valid rosters. |
| **Primary role** | Yes | First selected | Used for grouping/labels when the person could fill several |
| **Level** | Yes | Mid | Junior / Mid / Senior. Drives the senior-coverage rule (M1 §3.6). |
| **Employment type** | Yes | Casual | Casual / Part-time / Full-time. Determines the default hour limits from M1. |
| **Home location** | Yes | First location | Where they normally work |
| **Can work at other locations** | No | Off | When on, the scheduler may place them at any active location |

### 3.3 Hours & pay **[MVP]**

| Field | Required | Default | Notes |
|---|---|---|---|
| **Base pay rate ($/hr)** | Yes | — | Used **only** for labour-cost estimates. Not payroll (REQUIREMENTS.md §0). |
| **Max hours per week** | No | Inherited from employment type (M1) | A per-person value **overrides** the M1 default. Hard constraint for the scheduler. |
| **Min hours per week** | No | 0 | Soft target — the scheduler tries to give at least this. Useful for part-timers with guaranteed hours. |
| **Max shifts per week** | No | — | Optional extra limit (e.g. a student who wants 3 shifts, however long) |

### 3.4 Preferences **[MVP — cheap to capture, feeds soft constraints]**

Not rules, just preferences the scheduler tries to honour when several valid rosters exist:

| Field | Notes |
|---|---|
| Preferred days | Multi-select Mon–Sun. Optional. |
| Preferred shift time | Morning / Afternoon / Evening / Night / No preference |
| Notes | Free text for the manager ("studying Tuesdays", "prefers openings") — display only, never used by the scheduler |

> Availability (when someone *can't* work) is a hard constraint and is handled separately in **M3** — do not conflate the two. Preferences are wishes; availability is a rule.

### 3.5 Account status **[MVP]**

| Field | Values | Notes |
|---|---|---|
| Invite status | Not invited / Invited / Active | Tracks whether they've logged in yet |
| Active | Yes / No | Inactive staff are excluded from scheduling but keep all history |

**Deactivate, never delete.** Deleting a person would corrupt past rosters and cost reports.

---

## 4. Screens

### 4.1 Team list **[MVP]**
Cards or rows showing: avatar, name, primary role badge, **level badge**, employment type, fortnight hours, estimated pay, location, invite status. Filters: location, role, level, active/inactive. Search by name.

The **level badge must be visually distinct** (it drives the senior rule) — a manager should be able to answer "how many seniors do I have?" at a glance.

### 4.2 Add / edit staff **[MVP]**
A single form, ordered by importance so the common case is fast:
1. Name, mobile *(the 60-second path stops here — everything below has a default)*
2. Roles (multi-select), primary role, level
3. Employment type, home location, pay rate
4. Hours limits (collapsed; shows the inherited default, expand to override)
5. Preferences (collapsed, optional)

Progressive disclosure is the point: a manager in a hurry fills four fields; a manager who cares can tune everything.

### 4.3 Quick-add (onboarding) **[MVP]**
A fast repeated-entry mode for the first setup: name + mobile + role + level + rate, one row at a time, staying on the same screen. Getting 12 people in without 12 round trips through a modal is the difference between onboarding taking 10 minutes and 40.

### 4.4 Invite staff **[MVP]**
- Per person or bulk: "Send invite" → SMS with a login link → they log in with phone OTP → status becomes Active.
- Re-send invite for anyone who hasn't logged in.
- Staff who never log in are still fully rosterable — the manager can run the whole system alone if some staff won't use phones. **The app must not require staff adoption to be useful.**

### 4.5 Staff's own profile (phone) **[MVP]**
Read-only: role, level, pay rate, home location. Editable: own phone, email. Plus availability (M3) and sign-out.

---

## 5. Data model

```
app_user (
  id, business_id, auth_user_id,
  name, phone, email, colour,
  level                    -- 'junior' | 'mid' | 'senior'
  employment_type          -- 'casual' | 'part_time' | 'full_time'
  primary_role_id,
  home_location_id,
  can_work_other_locations,
  pay_rate,
  max_hours_week,          -- nullable; null = inherit from M1 by employment type
  min_hours_week,          -- nullable
  max_shifts_week,         -- nullable
  preferred_days[],        -- nullable
  preferred_time_of_day,   -- nullable
  notes,
  is_manager,              -- role in the app, distinct from job role
  invite_status,           -- 'not_invited' | 'invited' | 'active'
  active,
  created_at
)

user_role (user_id, role_id)   -- many-to-many: roles a person can work
```

- `phone` is unique per `business_id` (not globally — the same person could theoretically work at two customers).
- `is_manager` controls app permissions; `role_id` describes the job they do on the floor. Keep these separate — a manager who also works kitchen shifts is normal.
- All rows carry `business_id`; RLS scopes everything (REQUIREMENTS.md §9).

---

## 6. Validation & edge cases

- **Mobile number** must be a valid AU format and unique within the business. Duplicate → clear error naming the existing person.
- **Pay rate** must be > 0. Warn (don't block) if below the current national minimum wage or implausibly high — a typo like `2.8` instead of `28` would silently distort every cost estimate.
- **At least one role** must be selected; the primary role must be one of them.
- **Roles must be active** (M1). Deactivating a role in M1 must not silently strip it from people — warn there instead.
- **Deactivating a person with future shifts:** block the action until those shifts are reassigned or removed, and say exactly which ones. Silently orphaning shifts is the worst possible outcome.
- **Senior-coverage sanity check:** if M1 requires seniors present and the business has **no active Senior**, show a persistent warning on the Team screen — rosters cannot generate. Same if `senior_min_count` exceeds the number of active seniors.
- **min_hours > max_hours** → reject.
- **Changing level, roles, or hour limits** does not alter published rosters; it applies to the next generation. State this on save.
- **Manager cannot deactivate their own account**, and a business must always retain at least one active manager.
- Changing someone's phone number after they've logged in must not orphan their login — re-link the auth identity or require re-invite (decide and implement explicitly, don't leave to chance).

---

## 7. Acceptance criteria

- [ ] A staff member can be added with **name + mobile** alone; every other field has a working default.
- [ ] 12 staff can be onboarded in under 10 minutes using quick-add.
- [ ] A person can hold multiple roles, and the scheduler can place them in any of them.
- [ ] Per-person hour limits override the employment-type defaults from M1.
- [ ] Level is visible at a glance in the team list, and the count of active seniors is discoverable.
- [ ] Deactivating a person with future shifts is blocked with a clear, actionable message.
- [ ] Staff can edit their own contact details and nothing else; they cannot see any other person's pay rate.
- [ ] Tenant-isolation test passes: a manager of business A cannot read a single staff record from business B.
- [ ] Invited staff can log in by phone OTP and land on their own profile; un-invited staff remain fully rosterable.
- [ ] Deactivated staff disappear from scheduling but remain in past rosters and cost reports.

## 8. Out of scope for this module

Documents/certifications (RSA, food safety) [LATER], onboarding paperwork or contracts [LATER], skills/proficiency ratings beyond level [LATER], staff-to-staff messaging [LATER], performance or attendance tracking [LATER], award classifications and pay grades (never — REQUIREMENTS.md §0).
