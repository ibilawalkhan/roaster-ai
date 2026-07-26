# Rosterly — Solver Contract (FROZEN v1)

The wire contract between the Next.js app and the Python/OR-Tools scheduler
service (Module 5). **This is the single source of truth for both sides.** The
app builds the request; the solver returns the response; neither re-implements
the other's logic. Availability arrives **pre-resolved** by the app via the one
shared resolver (`src/lib/domain/availability.ts`, M3 §6) — the solver never
re-derives pattern/exception logic.

Transport: `POST /solve`, JSON in/out. Stateless. See MODULE_05 §4/§6 for prose.

## Request

```jsonc
{
  "roster": { "start_date": "2026-08-03", "days": 14, "timezone": "Australia/Sydney" },

  "positions": [                         // one object PER PERSON NEEDED (slot count expanded)
    { "id": "p1", "date": "2026-08-03", "location_id": "L1", "role_id": "KIT",
      "start": "2026-08-03T16:00:00+10:00", "end": "2026-08-03T23:00:00+10:00",
      "required_level": null }           // "junior"|"mid"|"senior"|null
  ],

  "people": [
    { "id": "u1", "roles": ["KIT","FOH"], "level": "senior",
      "location_id": "L1", "can_work_other_locations": false,
      "pay_rate": 32.0,
      "max_hours_week": 38, "min_hours_week": 0, "max_shifts_week": null,
      "availability": [                  // PRE-RESOLVED windows in business tz; empty ⇒ unavailable
        { "date": "2026-08-03", "from": "16:00", "to": "23:00" } ],
      "preferred_days": [4,5],           // 0=Sun..6=Sat
      "preferred_time": "evening" }      // morning|afternoon|evening|night|no_preference
  ],

  "rules": {
    "senior_coverage": { "enabled": true, "min_count": 1,
                         "qualifying_levels": ["senior"],
                         "open_hours": [ { "date": "2026-08-03", "from": "10:00", "to": "22:30" } ] },
    "max_consecutive_days": 6,
    "min_rest_hours": 10,
    "max_shift_hours": 12,
    "min_shift_hours": 3,
    "one_shift_per_day": true
  },

  "locked":   [ { "position_id": "p7", "user_id": "u3" } ],   // H11 — must hold exactly
  "excluded": [ { "position_id": "p9", "user_id": "u5" } ],   // H12 — must not occur

  "objective_priority": ["fairness", "cost", "preferences", "consistency"],
  "previous_roster":   [ { "user_id": "u1", "date": "2026-07-27", "start": "...", "end": "..." } ],
  "time_limit_seconds": 15,
  "seed": 42
}
```

## Response

```jsonc
{
  "status": "ok" | "partial" | "failed",
  "assignments": [ { "position_id": "p1", "user_id": "u4" } ],
  "unfilled": [
    { "position_id": "p22", "date": "2026-08-09", "role_id": "KIT",
      "start": "16:00", "end": "23:00",
      "reason": "no_eligible_person",        // machine slug
      "detail": "3 people can work Kitchen; all at their weekly hour limit or unavailable.",
      "closest_candidates": [
        { "user_id": "u7", "blocked_by": "max_hours_week" },
        { "user_id": "u2", "blocked_by": "availability" } ] }
  ],
  "coverage_gaps": [
    { "date": "2026-08-10", "from": "20:00", "to": "22:30",
      "rule": "senior_coverage",
      "detail": "No Senior available. Both Seniors at their weekly hour limit." }
  ],
  "stats": { "positions": 68, "filled": 65, "hours": 401.5,
             "estimated_cost": 12874.50, "solve_seconds": 0.8,
             "hours_by_person": { "u1": 34, "u2": 28 } },
  "diagnostics": { "objective_value": 1240, "seed": 42, "time_limit_hit": false }
}
```

## Invariants (both sides uphold)

- **Hard constraints H1–H14 (M5 §5.1) are never violated** in `assignments`.
- **Demand is soft**: an unfillable position is returned in `unfilled` with a
  human `reason`+`detail`, never dropped and never causing an infeasible solve.
  The solver therefore **always returns** `ok`/`partial`, never throws for a
  short-staffed week. `failed` is reserved for malformed input / internal error.
- **Determinism**: identical request + `seed` ⇒ identical response.
- **Senior coverage** is a timeline constraint over `open_hours`, discretised to
  15-min blocks with a penalised slack var (M5 §5.3) → gaps surface in
  `coverage_gaps`, they do not fail the solve.
- `blocked_by` / `reason` slugs are a closed vocabulary:
  `role`, `availability`, `overlap`, `max_hours_week`, `max_shifts_week`,
  `max_consecutive_days`, `min_rest_hours`, `one_shift_per_day`, `location`,
  `required_level`, `excluded`, `no_eligible_person`.

## App-side degradation (M5 §10)

If the solver is unreachable or times out, the app keeps the seeded (unassigned)
roster, shows "couldn't generate right now — try again or build manually", and
never loses the manager's work. The product is fully usable without the solver.
