# Rosterly — Module 6: Draft Review, Edit & Publish

**Status:** draft for review
**Depends on:** M1–M5 (rules, staff, availability, template, generated draft)
**Feeds:** Staff app (M7), Swaps (M8), Notifications (M9), Costs (M10)

---

## 1. Purpose

Where the manager takes the auto-generated draft, **understands** it, **adjusts** it, and **publishes** it.

This is the screen the whole product is judged on. The scheduler can be mathematically perfect and still fail commercially if the manager can't see at a glance whether the roster is good, or can't fix the bits he disagrees with. Two jobs:

1. **Make the roster's health obvious** — what's covered, what's missing, and why.
2. **Let the manager override anything, fast, without breaking the rules silently.**

**Principle:** the algorithm proposes; the manager decides. The app never blocks a decision the manager is entitled to make — it makes sure he makes it *knowingly*.

---

## 2. The screen

### 2.1 Roster grid **[MVP]**
The familiar staff × days grid (as in the existing prototype), now populated by the solver.

Each filled cell shows: time range, role code, and a subtle marker distinguishing **auto-assigned** from **manager-edited** (M5 `shift.origin`). Keep this quiet — a small dot or weight difference, not a loud badge. It lets the manager see the algorithm's work versus their own without visual noise.

**Unfilled positions are first-class citizens.** A required position nobody could fill appears in the grid as an explicit empty slot card — *"KIT 16:00–23:00 · unfilled"* — never as blank space. Blank space reads as "nothing needed"; an unfilled marker reads as "you have a problem here." This distinction matters more than almost anything else on the screen.

Per-day and per-person totals (hours + estimated cost) sit at the edges and update live on every edit.

### 2.2 Roster health panel **[MVP]**
A persistent summary, in plain language, at the top or side:

**When healthy:**
> ✓ All 68 positions filled · ✓ Senior present all open hours · 412 hours · Est. $12,874

**When not:**
> ⚠ 3 positions unfilled · ⚠ 1 senior coverage gap
> · Sun 9 Aug, Kitchen 16:00–23:00 — *no eligible person: all 3 Kitchen staff are at their weekly hour limit*
> · Sun 9 Aug, 20:00–22:30 — *no Senior available: both Seniors at hour limit*

Every item is **clickable and scrolls to the cell it's about**. Each states the reason from the solver (M5 §6). Never show a warning the manager can't act on, and never show a count without the detail behind it.

### 2.3 Estimated cost **[MVP]**
Fortnight and per-day estimates, updating live as edits are made, always carrying the **estimate-not-payroll** disclaimer (REQUIREMENTS.md §0).

---

## 3. Manual editing

Everything the manager can do by hand, all live-rechecked.

### 3.1 Actions **[MVP]**
| Action | Behaviour |
|---|---|
| **Assign** a person to an unfilled position | Person picker showing eligible people first, ineligible below with the reason greyed in ("at hour limit", "unavailable") |
| **Reassign** a shift to someone else | Same picker |
| **Remove** an assignment | Position returns to unfilled (the requirement doesn't disappear) |
| **Delete the position entirely** | The requirement itself is removed — distinct from removing the person, and confirm-gated |
| **Add a position** | A one-off requirement not in the template (`source: 'manual'`) |
| **Edit times / break / role / note** | On an individual shift |
| **Lock / unlock** a shift | Pins it for regeneration (M5 §7) |

### 3.2 Live re-check — block vs warn **[MVP — get this right]**

On every edit, re-evaluate the rules and update the health panel immediately. But **not every violation is equal**:

**BLOCK (physically impossible — never allow):**
- Assigning a person to two overlapping shifts (they cannot be in two places at once).
- Assigning someone to a role they don't hold *and* the manager hasn't granted — offer instead: "Ahmed isn't marked for Kitchen. Add Kitchen to his roles?" (fixes the data, then allows).
- Assigning a deactivated person.

**WARN, but ALLOW (the manager may know better):**
- Person is marked unavailable — *"Nadia is marked unavailable Tue after 18:00."* He may have arranged it verbally.
- Over their weekly max hours — *"This puts Bilal at 41h (limit 38)."*
- Less than minimum rest between shifts — *"Only 8h rest after last night's close."*
- Exceeds max consecutive days.
- Creates a senior coverage gap — *"No Senior on between 20:00–22:30 Sunday."*
- Below someone's minimum hours.

Every warning names **who, when, and which rule**, and appears in the health panel so it's not lost after the toast fades. Overridden warnings persist as visible flags on the roster until resolved — the manager should be able to publish with known exceptions, but never *forget* them.

> Rationale: hard-blocking availability or hour limits would make the tool fight the manager on the one thing he's certain about — his own restaurant. Making violations visible and persistent is the honest middle ground.

### 3.3 Regeneration controls **[MVP]**
Per M5 §7, available from this screen: **lock & regenerate**, **change priorities** (fairness / cost / preferences), **exclude a person from a position**. Regenerating never touches locked shifts and never silently discards manual edits without saying so — if a regenerate would overwrite unlocked manual edits, say so and offer to lock them first.

---

## 4. Publish

### 4.1 Pre-publish check **[MVP]**
On clicking Publish, show a short summary of what the manager is about to commit:

> **Publishing fortnight 3–16 Aug**
> 65 of 68 positions filled · 3 unfilled · 1 senior coverage gap · 12 staff · Est. $12,874
> 3 unfilled positions will not be visible to staff. Publish anyway?

**Publishing with gaps is allowed** — a real restaurant often publishes a roster while still chasing cover. Blocking it would push the manager back to WhatsApp, which is exactly what the product exists to replace. But the gaps must be stated at the moment of commitment, not buried.

### 4.2 What publishing does **[MVP]**
- `roster.status` → `published`, with `published_at` and `published_by` recorded.
- Staff can now see **their own** shifts (M7). Unfilled positions are **not** shown to staff — with one exception below.
- Notifications fire (M9): "Your roster for 3–16 Aug is out."
- The draft/published state becomes unmistakable in the UI (a persistent banner or state chip). A manager must never wonder whether staff can see what he's looking at.

**[V1.1] Optional:** publish unfilled positions to staff as **open shifts** they can claim (reusing M8's claim flow) — this is genuinely useful for filling gaps fast, but it depends on M8 being live, so it follows.

### 4.3 Editing after publish **[MVP]**
Real rosters change. Editing a published roster is allowed, and:
- Every change **notifies the affected staff member** immediately (M9): shift added, removed, or times changed.
- Changes are recorded in a **change log** (§5) with who changed what and when — essential when a staff member says "that's not what it said yesterday."
- The health panel and warnings continue to apply.

### 4.4 Unpublish / discard **[MVP]**
- **Unpublish** (back to draft) is allowed but confirm-gated and notifies staff that the roster was withdrawn. Use sparingly — it's disruptive.
- **Discard draft** (unpublished only) deletes the draft and its positions, confirm-gated.

---

## 5. Data model additions

```
roster_change_log (
  id, business_id, roster_id, shift_id,
  action,            -- 'assign' | 'reassign' | 'remove' | 'add_position'
                     -- | 'delete_position' | 'edit_times' | 'lock' | 'unlock'
                     -- | 'publish' | 'unpublish'
  before_json, after_json,
  changed_by_user_id, changed_at,
  notified                -- whether affected staff were notified
)

roster_warning (          -- persisted overrides so they aren't forgotten
  id, business_id, roster_id, shift_id,
  rule,                   -- 'availability' | 'max_hours' | 'min_rest'
                          -- | 'consecutive_days' | 'senior_coverage' | 'min_hours'
  detail, acknowledged_by, acknowledged_at, resolved
)
```

`shift` gains: `locked`, `origin` (from M5), and edits update `updated_at`. All tables carry `business_id`; RLS applies.

---

## 6. Edge cases

- **Two managers editing simultaneously** — last write wins is acceptable for v1 (one manager per shop), but the second editor must see fresh data rather than silently overwriting: refresh the grid on save conflict and tell them. Do not implement full collaborative editing.
- **Optimistic UI must roll back visibly** on a failed save (REQUIREMENTS.md §9) — a phantom assignment that isn't really saved is the worst bug on this screen.
- **Regenerate after manual edits** — unlocked manual edits will be overwritten; warn explicitly with a count before proceeding.
- **A locked shift becomes invalid** (person deactivated or now unavailable) — flag it and offer to release the lock rather than failing silently (M5 §10).
- **Deleting a position vs removing a person** — these are different and must be visually distinct actions; conflating them is how requirements silently disappear from a roster.
- **Editing times of a published shift the staff member already saw** — always notify; never rely on them re-checking.
- **Publishing an empty roster** (no assignments at all) — allowed only with explicit confirmation; almost always a mistake.
- **DST inside the period** — displayed durations must reflect real elapsed hours (M5 §10).

---

## 7. Acceptance criteria

- [ ] Unfilled positions render as explicit "unfilled" cards in the grid, never as blank cells.
- [ ] The health panel states, in plain language, exactly what is wrong and where, with each item linking to its cell.
- [ ] Every manual edit re-checks rules within ~200ms and updates the panel and totals live.
- [ ] Physically-impossible edits (overlap, deactivated staff) are blocked; rule violations the manager may knowingly accept are warned-but-allowed and persist as visible flags.
- [ ] Warnings state who, when, and which rule — never a generic "invalid roster" message.
- [ ] Lock & regenerate preserves pinned shifts exactly; regeneration warns before overwriting unlocked manual edits.
- [ ] Publishing with gaps is possible and the gaps are stated at the moment of publishing.
- [ ] Draft vs published state is unmistakable at all times.
- [ ] Every change to a published roster notifies the affected staff and is recorded in the change log with author and timestamp.
- [ ] A failed save visibly rolls back; no phantom assignments.
- [ ] Tenant-isolation test passes for all new tables.

## 8. Out of scope for this module

Staff-side viewing (M7), drop/claim workflow (M8), notification delivery mechanics (M9), collaborative multi-manager editing [LATER], roster version comparison / diff view [V1.1], approval workflow requiring a second manager's sign-off [LATER], exporting the roster to PDF or print [V1.1 — likely an early customer request].
