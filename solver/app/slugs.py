"""The closed vocabulary of ``reason`` / ``blocked_by`` slugs (SOLVER_CONTRACT).

Both the app and the solver agree on exactly these machine slugs. Diagnostics
may only ever emit values from this module — nothing outside the frozen set.
"""

from __future__ import annotations

# Per-person / per-position blocking reasons (map 1:1 onto hard constraints).
ROLE = "role"  # H1  — person does not hold the position's role
AVAILABILITY = "availability"  # H2  — not available for the whole window
OVERLAP = "overlap"  # H3  — clashes with another assigned shift
MAX_HOURS_WEEK = "max_hours_week"  # H4  — would exceed weekly hours cap
MAX_SHIFTS_WEEK = "max_shifts_week"  # H5  — would exceed weekly shift count
MAX_CONSECUTIVE_DAYS = "max_consecutive_days"  # H6  — too many days in a row
MIN_REST_HOURS = "min_rest_hours"  # H7  — not enough rest between shifts
ONE_SHIFT_PER_DAY = "one_shift_per_day"  # H8  — already works that day
LOCATION = "location"  # H9  — not eligible for the position's location
REQUIRED_LEVEL = "required_level"  # H10 — does not meet the required level
EXCLUDED = "excluded"  # H12 — manager excluded this person↔position

# Position-level "nobody at all" summary reason.
NO_ELIGIBLE_PERSON = "no_eligible_person"

# The frozen, closed set. Guarded by an assertion in the tests.
CLOSED_VOCABULARY: frozenset[str] = frozenset(
    {
        ROLE,
        AVAILABILITY,
        OVERLAP,
        MAX_HOURS_WEEK,
        MAX_SHIFTS_WEEK,
        MAX_CONSECUTIVE_DAYS,
        MIN_REST_HOURS,
        ONE_SHIFT_PER_DAY,
        LOCATION,
        REQUIRED_LEVEL,
        EXCLUDED,
        NO_ELIGIBLE_PERSON,
    }
)

# Human-readable labels used to compose ``detail`` sentences (Australian English).
SLUG_LABELS: dict[str, str] = {
    ROLE: "cannot work this role",
    AVAILABILITY: "not available for this time",
    OVERLAP: "already on another shift then",
    MAX_HOURS_WEEK: "at their weekly hour limit",
    MAX_SHIFTS_WEEK: "at their weekly shift limit",
    MAX_CONSECUTIVE_DAYS: "would exceed max consecutive days",
    MIN_REST_HOURS: "not enough rest before/after another shift",
    ONE_SHIFT_PER_DAY: "already rostered that day",
    LOCATION: "not eligible for this location",
    REQUIRED_LEVEL: "does not meet the required level",
    EXCLUDED: "excluded from this position by the manager",
    NO_ELIGIBLE_PERSON: "no eligible person",
}
