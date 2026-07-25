# Rosterly — Module 5: Roster Creation & Auto-Scheduler

**Status:** draft for review
**Depends on:** M1 (rules, trading hours), M2 (staff capability, limits, rates), M3 (availability), M4 (week template / demand)
**Feeds:** Draft review (M6), Publish → Staff app (M7), Swaps (M8), Costs (M10)

---

## 1. Purpose

Turn **demand** (the week template, M4) plus **supply** (staff, their capability, limits and availability — M2/M3) into a **valid draft roster**, in seconds, obeying every rule the business has set.

The output is always a **draft**. The manager reviews, edits, and approves it (M6). The scheduler never publishes anything by itself.

**The promise this module can honestly keep:**
> *Rosterly will never produce an invalid roster — nobody double-booked, over their hours, or working when unavailable — and when it can't fill something, it tells you exactly what's missing and why.*

It cannot promise a complete roster always exists. If the people aren't available, no algorithm can invent them. Say this to customers plainly; it's a stronger promise than "perfect" because it's one you can keep.

---

## 2. The manager's flow

1. **Create roster** → choose the period (week/fortnight per M1) and start date.
2. The system **seeds concrete requirements** by copying the template's slots (M4) onto real dates, and shows a summary: *"14 days, 68 positions to fill, 412 hours."*
3. **This week's exceptions** (light, skippable): mark a day closed (public holiday), add or remove a one-off requirement, note someone on leave (which is really an availability exception, M3).
4. **Pre-flight check** runs automatically and reports blockers *before* solving: people with no availability, roles with no eligible staff, senior shortfall, demand exceeding total available hours.
5. **Auto-generate** → the solver runs (seconds) → a **draft roster** appears.
6. Manager reviews in M6: edits freely, **locks** the parts they like, **regenerates** the rest, then **publishes**.

---

## 3. Architecture

The solver is a **separate, stateless Python service**. The app never contains scheduling logic.

```
Next.js app ──(POST /solve, JSON)──► Scheduler service (Python + OR-Tools CP-SAT)
     ▲                                          │
     └────────(assignments + diagnostics)───────┘
```

- **Why separate:** OR-Tools is Python; the app is TypeScript. Isolation also means the solver is independently testable, can be replayed against saved inputs as regression tests, and can be tuned or replaced without touching the app.
- **Deploy as:** an AWS Lambda (container image, since OR-Tools is a large dependency) or a small always-on container. Stateless — all inputs arrive in the request.
- **Timeout:** hard cap (see §8). The app must handle a timeout gracefully, never hang the UI.

---

## 4. Solver inputs (the request contract)

```jsonc
{
  "roster": { "start_date": "2026-08-03", "days": 14, "timezone": "Australia/Sydney" },

  "positions": [                      // one per person needed (slot count expanded)
    { "id": "p1", "date": "2026-08-03", "location_id": "L1", "role_id": "KIT",
      "start": "2026-08-03T16:00", "end": "2026-08-03T23:00",
      "required_level": null }
  ],

  "people": [
    { "id": "u1", "roles": ["KIT","FOH"], "level": "senior",
      "location_id": "L1", "can_work_other_locations": false,
      "pay_rate": 32.0,
      "max_hours_week": 38, "min_hours_week": 0, "max_shifts_week": null,
      "availability": [ { "date": "2026-08-03", "from": "16:00", "to": "23:59" } ],
      "preferred_days": [4,5], "preferred_time": "evening" }
  ],

  "rules": {
    "senior_coverage": { "enabled": true, "min_count": 1,
                         "qualifying_levels": ["senior"],
                         "open_hours": [ { "date": "2026-08-03",
                                           "from": "10:00", "to": "22:30" } ] },
    "max_consecutive_days": 6,
    "min_rest_hours": 10,
    "max_shift_hours": 12,
    "min_shift_hours": 3,
    "one_shift_per_day": true
  },

  "locked": [ { "position_id": "p7", "user_id": "u3" } ],   // pinned by manager
  "excluded": [ { "position_id": "p9", "user_id": "u5" } ], // manager said "not this person"

  "objective_priority": ["fairness", "cost", "preferences", "consistency"],
  "previous_roster": [ { "user_id": "u1", "date": "...", "start": "...", "end": "..." } ],
  "time_limit_seconds": 15,
  "seed": 42
}
```

**Availability arrives pre-resolved** by the app using the single shared resolution function (M3 §6) — the solver never re-implements pattern/exception logic.

---

## 5. The model

Decision variable: `x[person][position] ∈ {0,1}` — person is assigned to that position.

Typical size for a small restaurant: 12 people × ~70 positions ≈ 840 booleans. CP-SAT solves this in well under a second; the time limit exists for pathological cases, not normal ones.

### 5.1 Hard constraints — **never violated**

These are provably enforced. A returned roster cannot breach them.

| # | Constraint |
|---|---|
| H1 | **Role capability** — a person may only fill a position whose role they hold (M2). |
| H2 | **Availability** — assignment only if the person is available for the whole position window (M3, resolved). |
| H3 | **No overlap** — a person is never in two positions whose times overlap (including across midnight and across locations). |
| H4 | **Max hours per week** — per-person value, else employment-type default (M2/M1). Computed per rostered week, break time excluded. |
| H5 | **Max shifts per week** — if set for that person. |
| H6 | **Max consecutive days** — no run longer than the configured limit (M1). |
| H7 | **Minimum rest** — at least N hours between the end of one shift and the start of the next (M1). This is what prevents close-then-open. |
| H8 | **One shift per day** — if enabled (M1). |
| H9 | **Location eligibility** — home location only, unless `can_work_other_locations` (M2). |
| H10 | **Required level** — if a position specifies a level, only qualifying people may fill it (M4). |
| H11 | **Locked assignments** — manager-pinned person↔position pairs must hold exactly. |
| H12 | **Exclusions** — manager-blocked person↔position pairs must not occur. |
| H13 | **Active staff only** — deactivated people are never assigned. |
| H14 | **Min/max shift length** — positions violating these are rejected at template time (M4), not silently fixed here. |

### 5.2 Soft constraints — **penalised, not forbidden**

This is the key design decision that makes the product usable: **demand is soft, safety and legality are hard.**

Rather than "every position must be filled" (which makes the model infeasible the moment staffing is short, returning nothing), each position gets a **shortfall variable** with a large penalty. The solver therefore *always returns a roster*, filling as much as it validly can, and the remaining shortfalls become the precise, explainable gaps the manager sees.

| Penalty | Weight | Meaning |
|---|---|---|
| **Unfilled position** | Very high | A required position nobody could validly fill |
| **Senior coverage gap** | Very high | A time block during open hours with no senior present |
| **Below min hours** | Medium | Person got fewer hours than their guaranteed minimum |
| **Unfairness** | Tunable | Deviation from an even distribution of hours across staff |
| **Cost** | Tunable | Total estimated labour cost |
| **Preference miss** | Low | Assigned outside preferred days/time (M2) |
| **Inconsistency** | Low | Different pattern from the previous roster (M5 input) |

Weights are derived from the business's `objective_priority` ranking (M1 §3.6) — the manager ranks plain-language priorities; the app maps them to weights. The manager never sees numbers.

### 5.3 Senior coverage — the timeline constraint (implement exactly)

The rule is *coverage over time*, not per shift. Model it by discretising each day's **open hours** (M1) into fixed blocks (**15 minutes**, configurable):

```
for each block b in open_hours:
    sum( x[p][s] for p in senior_qualifying
                 for s in positions where s covers b )
        + coverage_gap[b]  >=  senior_min_count
```

`coverage_gap[b]` is a penalised slack variable — so a roster with an uncovered 30-minute window is *returned with that window flagged*, rather than the whole solve failing.

This correctly handles the manager's real intent: a senior 10:00–17:00 and another 16:00–23:00 cover a 10:00–23:00 open day between them, with no requirement that every individual shift contains a senior.

**Overnight/24h:** blocks are generated from the trading-hours timeline, which already spans midnight where configured (M1 §3.3). A block belongs to the trading day it falls in, so a 22:00–06:00 window is one continuous run of blocks, not two broken halves.

---

## 6. Solver output (the response contract)

```jsonc
{
  "status": "ok" | "partial" | "failed",
  "assignments": [ { "position_id": "p1", "user_id": "u4" } ],
  "unfilled": [
    { "position_id": "p22", "date": "2026-08-09", "role_id": "KIT",
      "start": "16:00", "end": "23:00",
      "reason": "no_eligible_person",
      "detail": "3 people can work Kitchen; all are at their weekly hour limit or unavailable.",
      "closest_candidates": [
        { "user_id": "u7", "blocked_by": "max_hours_week" },
        { "user_id": "u2", "blocked_by": "availability" }
      ] }
  ],
  "coverage_gaps": [
    { "date": "2026-08-10", "from": "20:00", "to": "22:30",
      "rule": "senior_coverage",
      "detail": "No Senior available. Both Seniors are at their weekly hour limit." }
  ],
  "stats": { "positions": 68, "filled": 65, "hours": 401.5,
             "estimated_cost": 12874.50, "solve_seconds": 0.8,
             "hours_by_person": { "u1": 34, "u2": 28 } },
  "diagnostics": { "objective_value": 1240, "seed": 42, "time_limit_hit": false }
}
```

**`reason` and `detail` are the most important fields in this module.** A gap the manager can't understand is a bug in the product, not a staffing problem. Every unfilled position and coverage gap must name *which constraint blocked it* and, where possible, *who came closest and why they were ruled out*. This is what converts "the software failed" into "I need another senior on Sundays."

**`closest_candidates`** is computed by re-checking each hard constraint per person for that position and reporting the first that failed. It is diagnostic only — it never relaxes a rule.

---

## 7. Lock & regenerate

A constraint solver is deterministic: identical inputs give an identical roster. A naive "Generate again" would return the same thing and look broken. So regeneration must always change *something*:

1. **Lock & regenerate (primary).** The manager pins the assignments they like; those become hard constraints (H11); the rest is re-solved. This is steering, not dice-rolling, and it's the main interaction.
2. **Change priorities.** Re-rank fairness / cost / preferences → different weights → a genuinely different, explainable roster.
3. **Exclude a person from a position.** "Not him on Friday" → H12 → re-solve.
4. **[V1.1] Show another option.** Add a constraint excluding the previous solution and re-solve, for managers who just want alternatives. Secondary — the result is unpredictable to the manager, so it's not the primary control.

**Discard draft** exists but is quiet and confirm-gated. There is deliberately **no bare "Reject"** — rejecting into an empty week leaves the manager worse off than before they clicked.

---

## 8. Determinism, limits and performance

- **Fixed seed** by default → reproducible results, so the same inputs always explain the same output. Store the seed with each run.
- **Time limit** default **15 seconds**, hard ceiling 30. CP-SAT returns the best solution found so far; take it. "Very good in 10 seconds" beats "provably optimal in 4 minutes" for a manager waiting on a screen.
- If the limit is hit, set `time_limit_hit: true` — the roster is still valid (hard constraints always hold), just possibly not optimal.
- **Every solve is stored** (`solve_run`, §9): inputs, outputs, seed, rule version, duration. This gives you replay for debugging, regression tests from real data, and the ability to answer "why is Omar on Friday?" later.
- Expected performance at target scale (≤ 30 staff, ≤ 200 positions): **under 2 seconds**.

---

## 9. Data model

```
roster (
  id, business_id, location_scope, start_date, days,
  status,            -- 'draft' | 'published'
  template_id,       -- which template seeded it
  created_by, created_at, published_at
)

roster_position (           -- concrete dated requirement (from template slot)
  id, business_id, roster_id, location_id, date, role_id,
  start_at, end_at,         -- UTC timestamps
  required_level, label,
  source                    -- 'template' | 'manual'
)

shift (                      -- an assignment; the roster's real content
  id, business_id, roster_id, roster_position_id,
  location_id, date, start_at, end_at, break_minutes, role_id,
  assigned_user_id,
  origin,                    -- 'auto' | 'manual'
  locked,                    -- pinned for regeneration
  status,                    -- assignment lifecycle (M8: assigned/open/etc.)
  created_at, updated_at
)

solve_run (
  id, business_id, roster_id,
  request_json, response_json,
  seed, time_limit, solve_seconds, status,
  created_by, created_at
)
```

- `roster_position` is the *requirement*; `shift` is the *assignment*. Keeping them separate is what allows unfilled positions to be first-class, visible objects rather than absences.
- `origin` distinguishes the algorithm's work from the manager's edits (surfaced subtly in M6).
- All tables carry `business_id`; RLS applies (REQUIREMENTS.md §9).

---

## 10. Edge cases

- **Empty template** → block generation with a message pointing to M4. Never produce a silently empty roster.
- **No staff / no eligible staff for a role** → pre-flight blocks with a clear message before any solve.
- **Everyone unavailable** → returns a roster of all-unfilled positions with reasons; not an error.
- **Locked assignment becomes invalid** (locked person later marked unavailable, or over hours) → the solve would be infeasible on H11; detect this **before solving** and tell the manager which lock conflicts, offering to release it.
- **DST boundary** inside the roster period → position durations must be computed on real elapsed time; a "shift" spanning the change is 7 or 9 hours, not always 8. Test explicitly.
- **Overnight positions** are anchored to their start date for grid display and consecutive-day counting.
- **Mid-roster rule change** (M1 edited after generation) → does not retro-apply; the next generation uses the new rules. Show this on the rules screen.
- **Solver service down or timing out** → the app must fail gracefully: keep the seeded (unassigned) roster, show "couldn't generate right now, try again or build manually," and never lose the manager's work.
- **Partial fortnight** (roster created mid-period) → allowed; positions only exist for the dates covered.

---

## 11. Acceptance criteria

- [ ] Generation never violates a hard constraint (H1–H14). This is verified by an automated test suite over generated rosters, including randomised inputs.
- [ ] Generation **always returns a roster** — short-staffed weeks come back partial with reasons, never as a failure.
- [ ] Every unfilled position states a human-readable reason and, where possible, who came closest and what blocked them.
- [ ] Senior coverage is evaluated over the timeline (15-min blocks) across open hours, correctly handling overlapping shifts, overnight windows and 24-hour days.
- [ ] Same inputs + same seed → identical output (deterministic and reproducible).
- [ ] Lock & regenerate preserves every pinned assignment exactly and re-solves the rest.
- [ ] Changing the priority ranking produces a measurably different roster (e.g. fairness-first spreads hours more evenly than cost-first).
- [ ] A solve of 30 staff × 200 positions completes in under 2 seconds; the 15-second limit is never the normal path.
- [ ] Every solve is persisted and can be replayed to reproduce the same result.
- [ ] Solver unavailability degrades gracefully and loses no manager work.
- [ ] Tenant isolation holds: a solve request can only ever reference one business's data.

## 12. Out of scope for this module

Publishing and staff visibility (M6/M7), shift swapping (M8), demand forecasting from sales history [LATER], LLM/AI-generated rosters (deliberately excluded — an LLM cannot guarantee the hard constraints, which is the entire value here), multi-week optimisation beyond the roster period [LATER], auto-publish without manager approval (deliberately never).
