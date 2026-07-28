"""H1-H14 are never violated in a returned roster (MODULE_05 §5.1, §11).

Every test asserts against the *response*, re-deriving the constraints with the
independent verifier rather than trusting the CP-SAT encoding.
"""

from __future__ import annotations

import random

import pytest
from conftest import day, make_request, person, position, rules

from app.constraints import verify_assignments
from app.context import build_context
from app.solve import solve


def assert_valid(request: dict, response: dict) -> None:
    """The core invariant: no hard constraint is breached, whatever else happened."""
    assert response["status"] in ("ok", "partial")
    ctx = build_context(request)
    assert verify_assignments(ctx, response["assignments"]) == []


def assigned_map(response: dict) -> dict[str, str]:
    return {a["position_id"]: a["user_id"] for a in response["assignments"]}


# --------------------------------------------------------------------------- #


def test_simple_week_fills_completely(simple_request: dict) -> None:
    response = solve(simple_request)
    assert_valid(simple_request, response)
    assert response["status"] == "ok"
    assert response["stats"]["filled"] == 5
    assert response["unfilled"] == []


def test_h1_role_capability(simple_request: dict) -> None:
    """Only people holding the position's role may fill it."""
    request = make_request(
        positions=[position("p1", day(0), "16:00", "22:00", role="KIT")],
        people=[
            person("waiter", roles=["FOH"]),
            person("cook", roles=["KIT"]),
        ],
    )
    response = solve(request)
    assert_valid(request, response)
    assert assigned_map(response) == {"p1": "cook"}


def test_h2_availability_whole_window() -> None:
    """Partial availability does not qualify — the whole window is required."""
    request = make_request(
        positions=[position("p1", day(0), "16:00", "22:00")],
        people=[
            person(
                "partial",
                availability=[{"date": day(0), "from": "16:00", "to": "20:00"}],
            ),
            person(
                "full",
                availability=[{"date": day(0), "from": "15:00", "to": "23:00"}],
            ),
        ],
    )
    response = solve(request)
    assert_valid(request, response)
    assert assigned_map(response) == {"p1": "full"}


def test_h3_no_overlap_single_person() -> None:
    """One person cannot hold two overlapping positions."""
    request = make_request(
        positions=[
            position("p1", day(0), "10:00", "18:00"),
            position("p2", day(0), "16:00", "22:00"),
        ],
        people=[person("only")],
        rules_in=rules(one_shift_per_day=False, min_rest_hours=0),
    )
    response = solve(request)
    assert_valid(request, response)
    assert len(response["assignments"]) == 1
    assert len(response["unfilled"]) == 1


def test_h3_no_overlap_across_midnight() -> None:
    """An overnight shift overlaps the next morning's early shift."""
    request = make_request(
        positions=[
            position("night", day(0), "22:00", "06:00", end_next_day=True),
            position("early", day(1), "05:00", "09:00"),
        ],
        people=[person("only", available_from="00:00", available_to="23:59")],
        rules_in=rules(
            one_shift_per_day=False,
            min_rest_hours=0,
            min_shift_hours=3,
            max_shift_hours=12,
        ),
    )
    response = solve(request)
    assert_valid(request, response)
    # 22:00-06:00 and 05:00-09:00 genuinely overlap by an hour.
    assert len(response["assignments"]) == 1


def test_h3_overnight_availability_is_merged() -> None:
    """A cross-midnight availability window covers a cross-midnight shift."""
    request = make_request(
        positions=[position("night", day(0), "22:00", "06:00", end_next_day=True)],
        people=[
            person(
                "owl",
                availability=[{"date": day(0), "from": "21:00", "to": "07:00"}],
            )
        ],
        rules_in=rules(max_shift_hours=12),
    )
    response = solve(request)
    assert_valid(request, response)
    assert assigned_map(response) == {"night": "owl"}


def test_h4_max_hours_week() -> None:
    """A 20-hour cap allows two 8-hour shifts, never three."""
    request = make_request(
        positions=[position(f"p{i}", day(i), "10:00", "18:00") for i in range(3)],
        people=[person("capped", max_hours_week=20)],
    )
    response = solve(request)
    assert_valid(request, response)
    assert response["stats"]["filled"] == 2
    assert response["stats"]["hours"] == 16.0
    assert len(response["unfilled"]) == 1


def test_h5_max_shifts_week() -> None:
    request = make_request(
        positions=[position(f"p{i}", day(i), "16:00", "20:00") for i in range(5)],
        people=[person("capped", max_shifts_week=2, max_hours_week=None)],
    )
    response = solve(request)
    assert_valid(request, response)
    assert response["stats"]["filled"] == 2


def test_h6_max_consecutive_days() -> None:
    """Three days in a row is the limit, so a 5-day run cannot be one person."""
    request = make_request(
        positions=[position(f"p{i}", day(i), "16:00", "20:00") for i in range(5)],
        people=[person("only", max_hours_week=None)],
        rules_in=rules(max_consecutive_days=3, min_rest_hours=0),
    )
    response = solve(request)
    assert_valid(request, response)
    days_worked = sorted(
        build_context(request).positions_by_id[a["position_id"]].day_index
        for a in response["assignments"]
    )
    # No run longer than three.
    run = best = 1
    for prev, cur in zip(days_worked, days_worked[1:]):
        run = run + 1 if cur == prev + 1 else 1
        best = max(best, run)
    assert best <= 3


def test_h7_min_rest_hours() -> None:
    """Close at 23:00 then open at 06:00 is 7 hours' rest — refused at 10."""
    request = make_request(
        positions=[
            position("close", day(0), "15:00", "23:00"),
            position("open", day(1), "06:00", "14:00"),
        ],
        people=[person("only", max_hours_week=None)],
        rules_in=rules(min_rest_hours=10, one_shift_per_day=True),
    )
    response = solve(request)
    assert_valid(request, response)
    assert len(response["assignments"]) == 1
    assert response["unfilled"][0]["reason"] == "min_rest_hours"


def test_h7_min_rest_satisfied_is_allowed() -> None:
    request = make_request(
        positions=[
            position("close", day(0), "15:00", "23:00"),
            position("open", day(1), "10:00", "18:00"),
        ],
        people=[person("only", max_hours_week=None)],
        rules_in=rules(min_rest_hours=10),
    )
    response = solve(request)
    assert_valid(request, response)
    assert response["stats"]["filled"] == 2


def test_h8_one_shift_per_day() -> None:
    request = make_request(
        positions=[
            position("lunch", day(0), "10:00", "14:00"),
            position("dinner", day(0), "17:00", "21:00"),
        ],
        people=[person("only", max_hours_week=None)],
        rules_in=rules(one_shift_per_day=True, min_rest_hours=0),
    )
    response = solve(request)
    assert_valid(request, response)
    assert len(response["assignments"]) == 1
    assert response["unfilled"][0]["reason"] == "one_shift_per_day"


def test_h8_disabled_allows_two_shifts_in_a_day() -> None:
    request = make_request(
        positions=[
            position("lunch", day(0), "10:00", "14:00"),
            position("dinner", day(0), "17:00", "21:00"),
        ],
        people=[person("only", max_hours_week=None)],
        rules_in=rules(one_shift_per_day=False, min_rest_hours=0),
    )
    response = solve(request)
    assert_valid(request, response)
    assert response["stats"]["filled"] == 2


def test_h9_location_eligibility() -> None:
    request = make_request(
        positions=[position("p1", day(0), "16:00", "22:00", location="L2")],
        people=[
            person("homebody", location="L1", can_work_other_locations=False),
            person("rover", location="L1", can_work_other_locations=True),
        ],
    )
    response = solve(request)
    assert_valid(request, response)
    assert assigned_map(response) == {"p1": "rover"}


def test_h10_required_level_is_a_minimum() -> None:
    request = make_request(
        positions=[
            position("needs_senior", day(0), "16:00", "22:00", required_level="senior")
        ],
        people=[person("junior", level="junior"), person("boss", level="senior")],
    )
    response = solve(request)
    assert_valid(request, response)
    assert assigned_map(response) == {"needs_senior": "boss"}


def test_h11_locked_assignment_holds_exactly() -> None:
    """The pinned pair survives, even though the cheaper person is available."""
    request = make_request(
        positions=[position("p1", day(0), "16:00", "22:00")],
        people=[person("cheap", pay_rate=20.0), person("pinned", pay_rate=90.0)],
        locked=[{"position_id": "p1", "user_id": "pinned"}],
        objective_priority=["cost", "fairness", "preferences", "consistency"],
    )
    response = solve(request)
    assert_valid(request, response)
    assert assigned_map(response) == {"p1": "pinned"}


def test_h12_exclusion_never_occurs() -> None:
    request = make_request(
        positions=[position("p1", day(0), "16:00", "22:00")],
        people=[person("blocked"), person("allowed")],
        excluded=[{"position_id": "p1", "user_id": "blocked"}],
    )
    response = solve(request)
    assert_valid(request, response)
    assert assigned_map(response) == {"p1": "allowed"}


def test_h13_inactive_staff_never_assigned() -> None:
    request = make_request(
        positions=[position("p1", day(0), "16:00", "22:00")],
        people=[person("gone", active=False)],
    )
    response = solve(request)
    assert_valid(request, response)
    assert response["assignments"] == []
    assert response["unfilled"][0]["reason"] == "no_eligible_person"


def test_h14_shift_length_is_refused_not_fixed() -> None:
    """A 14-hour position breaches max_shift_hours; the solver refuses it."""
    request = make_request(
        positions=[
            position("toolong", day(0), "08:00", "22:00"),
            position("fine", day(1), "16:00", "22:00"),
        ],
        people=[person("keen", max_hours_week=None)],
        rules_in=rules(max_shift_hours=12, min_shift_hours=3),
    )
    response = solve(request)
    assert_valid(request, response)
    assert assigned_map(response) == {"fine": "keen"}
    unfilled = {u["position_id"]: u for u in response["unfilled"]}
    assert "toolong" in unfilled
    assert "shift length" in unfilled["toolong"]["detail"]


def test_h14_too_short_is_refused() -> None:
    request = make_request(
        positions=[position("tooshort", day(0), "16:00", "17:00")],
        people=[person("keen")],
        rules_in=rules(min_shift_hours=3),
    )
    response = solve(request)
    assert_valid(request, response)
    assert response["assignments"] == []


def test_stale_lock_leaves_the_position_to_nobody_else() -> None:
    """A pin that can no longer hold is explained, not silently reassigned."""
    request = make_request(
        positions=[position("p1", day(0), "16:00", "22:00")],
        people=[
            person(
                "unavailable_now",
                availability=[{"date": day(0), "from": "09:00", "to": "12:00"}],
            ),
            person("someone_else"),
        ],
        locked=[{"position_id": "p1", "user_id": "unavailable_now"}],
    )
    response = solve(request)
    assert_valid(request, response)
    assert response["status"] == "partial"
    assert response["assignments"] == []  # never handed to someone else
    unfilled = response["unfilled"][0]
    assert unfilled["reason"] == "availability"
    assert "unavailable_now" in unfilled["detail"]


# --------------------------------------------------------------------------- #
# Randomised property test
# --------------------------------------------------------------------------- #


def _random_request(rng: random.Random) -> dict:
    """A messy but well-formed week: varied roles, levels, caps and gaps."""
    roles = ["KIT", "FOH", "BAR"]
    levels = ["junior", "mid", "senior"]
    locations = ["L1", "L2"]

    positions = []
    for i in range(rng.randint(8, 26)):
        d = rng.randrange(7)
        start_hour = rng.choice([7, 9, 11, 14, 16, 17, 20])
        length = rng.choice([4, 5, 6, 8])
        end_hour = start_hour + length
        crosses_midnight = end_hour >= 24
        positions.append(
            position(
                f"p{i}",
                day(d),
                f"{start_hour:02d}:00",
                f"{end_hour % 24:02d}:00",
                role=rng.choice(roles),
                location=rng.choice(locations),
                required_level=rng.choice([None, None, "mid", "senior"]),
                end_next_day=crosses_midnight,
            )
        )

    people = []
    for i in range(rng.randint(3, 9)):
        available_days = sorted(rng.sample(range(7), rng.randint(2, 7)))
        people.append(
            person(
                f"u{i}",
                roles=rng.sample(roles, rng.randint(1, 3)),
                level=rng.choice(levels),
                location=rng.choice(locations),
                can_work_other_locations=rng.random() < 0.3,
                pay_rate=rng.choice([25.0, 30.0, 35.0, 42.0]),
                max_hours_week=rng.choice([None, 20, 30, 38]),
                max_shifts_week=rng.choice([None, 2, 4, 5]),
                availability=[
                    {"date": day(d), "from": "06:00", "to": "23:59"}
                    for d in available_days
                ],
                active=rng.random() < 0.9,
            )
        )

    return make_request(
        positions=positions,
        people=people,
        rules_in=rules(
            max_consecutive_days=rng.choice([None, 3, 5, 6]),
            min_rest_hours=rng.choice([0, 8, 10, 12]),
            one_shift_per_day=rng.random() < 0.7,
            min_shift_hours=3,
            max_shift_hours=12,
        ),
        time_limit_seconds=5,
        seed=rng.randrange(1000),
    )


@pytest.mark.parametrize("trial", range(25))
def test_randomised_inputs_never_violate_a_hard_constraint(trial: int) -> None:
    rng = random.Random(1000 + trial)
    request = _random_request(rng)
    response = solve(request)
    assert response["status"] in ("ok", "partial"), response["diagnostics"]
    ctx = build_context(request)
    violations = verify_assignments(ctx, response["assignments"])
    assert violations == [], violations
