# Rosterly — Module 10: Costs & Reporting

**Status:** draft for review
**Depends on:** M2 (pay rates), M4 (template cost preview), M5/M6 (shifts)
**Feeds:** Dashboard, Draft review (M6), Week template (M4)

---

## 0. The framing that governs this entire module

Every number here is an **indicative labour-cost estimate for rostering decisions only** (REQUIREMENTS.md §0).

It is **not** payroll. It does **not** include: casual loading, evening/weekend/public-holiday penalty rates, overtime, allowances, superannuation, tax, or anything else from the Restaurant Industry Award. It is `rostered hours × the base rate the manager typed in` — nothing more.

The disclaimer appears **wherever a dollar figure appears**, in plain words, not fine print:
> *Estimate for rostering only — not payroll.*

This is not legal caution for its own sake: an owner who mistakes these figures for wages and underpays staff creates a serious problem, and "the app said so" protects nobody. The wording must be unmissable and consistent everywhere.

---

## 1. Purpose

Answer the three questions a restaurant owner actually asks:

1. **"What is this roster going to cost me?"** — before publishing.
2. **"Where is the money going?"** — which days, which people, which roles.
3. **"Is that too much?"** — cost relative to trading, i.e. labour as a percentage of sales.

Question 3 is the one owners genuinely obsess over, and it's what turns this from a nice chart into something they'd pay for.

---

## 2. Calculation rules

Costs are **derived, never stored as truth** (REQUIREMENTS.md §8). Computed in one shared function used by every screen so no two views can ever disagree.

```
paid_hours(shift) = (end_at − start_at) − break_minutes        // real elapsed time
cost(shift)       = paid_hours × pay_rate_snapshot
```

**Rounding:** compute in full precision; round only at display. Hours to 2 decimals (7.25h), money to 2 decimals. Totals are the sum of unrounded values, then rounded — never the sum of rounded parts, which produces off-by-cents mismatches between a column and its rows.

**Which day a cost belongs to:** a shift is anchored to its **start date**, consistent with the roster grid (M5 §10). A 22:00–06:00 shift counts entirely on the day it started. State this in the UI where it could confuse.

**Elapsed time, not clock arithmetic:** across a daylight-saving change, a 22:00–06:00 shift is 7 or 9 hours, not always 8. Compute from real timestamps.

### 2.1 Pay-rate snapshots — **important**

If cost is computed from the person's *current* rate, then giving someone a raise silently rewrites the cost of every roster they ever worked. Historical reports change retroactively; the owner loses trust in the numbers.

**Fix:** when a shift is created or reassigned, store `pay_rate_snapshot` on the shift. Reports use the snapshot. Changing a rate in M2 affects **future** shifts only, and the UI says so on save.

**[V1.1]** "Recalculate this draft with new rates" for a manager who updates rates mid-planning.

---

## 3. Reports & views

### 3.1 Roster cost summary **[MVP]**
Shown on the dashboard and in the draft review panel (M6 §2.3):
- Total estimated cost for the period
- Total rostered hours
- Number of shifts and number of people rostered
- Average $/hour across the roster
- Week 1 vs Week 2 comparison (for fortnights)

### 3.2 Cost by day **[MVP]**
A simple bar chart across the roster period, with hours and cost per day. This is what exposes an over-staffed Tuesday at a glance.

### 3.3 Cost by team member **[MVP]**
Ranked highest to lowest: name, hours, rate, shifts, estimated cost. Immediately answers "who is my biggest cost?" and surfaces anyone unexpectedly at 45 hours.

### 3.4 Cost by role **[MVP]**
Kitchen vs FOH vs Driver, as cost and as a share of the total. Restaurants think in these buckets when trimming.

### 3.5 Cost by location **[MVP]**
For multi-location businesses; a filter across every view (All / each location), matching M4 and M6.

### 3.6 Labour as % of sales **[V1.1 — highest-value addition]**
The metric owners actually manage to. Requires one small input: **daily sales**, typed in manually (a single number per day — from the POS report they already read every night).

- Shows labour cost ÷ sales as a percentage, per day and per period.
- Optional target (e.g. 30%); days over target are highlighted.
- Trend across periods.

Deliberately manual: POS integrations are a large project (M-LATER) and one number a day is a 10-second task for information owners find genuinely valuable.

### 3.7 Planned vs actual **[V1.1]**
Compare the published roster's cost against the original template estimate (M4 §5.4) — i.e. did this week's changes push us over the plan?

> **Never** "rostered vs worked" — that requires clock-in data, which this product deliberately does not collect (M7 §9).

---

## 4. Where costs appear elsewhere

Same shared calculation, different surfaces:
- **Roster grid** (M6): per-day column totals, per-person row totals, updating live on every edit.
- **Week template** (M4 §5.4): estimated weekly cost of the staffing shape, before any people are assigned (uses average rate of eligible staff for the role — flagged as approximate).
- **Staff app** (M7): the individual's own estimated pay only, never anyone else's.
- **Draft review panel** (M6 §2.2): the headline cost figure alongside roster health.

---

## 5. Filters & period selection **[MVP]**

- Period: current roster, previous rosters, or a custom date range.
- Location filter across all views.
- Role filter on the by-person view.
- Active/inactive staff inclusion (default: whoever was rostered, regardless of current status — history must not change when someone leaves).

---

## 6. Export **[V1.1]**

CSV export of shifts (date, person, role, location, start, end, break, hours, rate, estimated cost) and of the summary tables. Two reasons this will be requested early: owners want the numbers in their own spreadsheet, and it's the data-portability promise in the service agreement (SERVICE_AGREEMENT.md §6). PDF/print of the roster itself is separate (M6 §8).

---

## 7. Data model

No new tables for MVP — everything derives from `shift`.

```
shift  (extends M5)
  pay_rate_snapshot     -- captured at assignment; reports use this

daily_sales  ([V1.1])
  id, business_id, location_id, date, amount, entered_by, entered_at
```

All rows carry `business_id`; RLS applies. **Cost data is manager-only** — no staff member can read any cost view (REQUIREMENTS.md §9; M7 §4).

---

## 8. Edge cases

- **Unfilled positions** (M6) contribute **no** cost — but the summary should note them, since a "cheap" roster with three unfilled shifts isn't actually cheap: *"Est. $12,540 · 3 positions unfilled."* Without this, cost figures mislead in exactly the wrong direction.
- **Overnight shifts** count on their start date; state it where it might confuse.
- **DST** — real elapsed hours (§2).
- **Rate changed after publishing** → historical costs unchanged (snapshots, §2.1).
- **Person deactivated** → their past shifts remain in historical reports.
- **Shift swapped** (M8) → cost follows the person who ends up assigned, using **their** rate snapshot at reassignment. A senior covering a junior's shift costs more, and the report must show that.
- **Zero-sales day entered** (V1.1) → labour % is undefined, not infinity; display "—".
- **Multi-location person** → cost attributes to the shift's location, not the person's home location.
- **Draft vs published** → cost views default to the published roster; a draft's cost is clearly labelled as an estimate of an unpublished plan.

---

## 9. Acceptance criteria

- [ ] Every dollar figure in the product carries the estimate-not-payroll disclaimer, in plain words.
- [ ] All cost and hours calculations come from **one shared function**; grid totals, reports, template preview and the staff app can never disagree.
- [ ] Totals are computed from unrounded values and rounded only for display; a column total always equals the sum of its rows as shown.
- [ ] `pay_rate_snapshot` is captured at assignment; changing a rate does not alter any historical or published roster's cost.
- [ ] Overnight shifts attribute to their start date consistently across grid and reports.
- [ ] A roster containing unfilled positions displays the unfilled count alongside its cost.
- [ ] Cost by day, by person, by role and by location all reconcile to the same period total.
- [ ] Location and period filters apply consistently across every view.
- [ ] No staff member can access any cost view or another person's figures — verified by the isolation test.
- [ ] Costs across a daylight-saving boundary reflect real elapsed hours.

## 10. Out of scope for this module

Award-interpreted or penalty-rate pay (never — §0), payroll export or payslips (never), superannuation/tax (never), clock-in-based actual-hours reporting (never in v1), POS/accounting integrations [LATER], sales forecasting [LATER], multi-period budgeting and variance workflows [LATER], per-person profitability [LATER].
