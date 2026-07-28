"""Reasons and details (MODULE_05 §6).

> *A gap the manager can't understand is a bug in the product, not a staffing
> problem.*

Every unfilled position and coverage gap must name which constraint blocked it
and, where possible, who came closest and why they were ruled out — using only
the contract's closed slug vocabulary.
"""

from __future__ import annotations

from conftest import day, make_request, person, position, rules

from app import constraints, slugs
from app.solve import solve


def unfilled_by_id(response: dict) -> dict[str, dict]:
    return {u["position_id"]: u for u in response["unfilled"]}


# --------------------------------------------------------------------------- #
# Vocabulary is closed
# --------------------------------------------------------------------------- #


def test_every_check_reports_a_slug_from_the_closed_vocabulary() -> None:
    for slug, _check in constraints.ALL_CHECKS:
        assert slug in slugs.CLOSED_VOCABULARY
        assert slug in slugs.SLUG_LABELS


def test_reasons_and_blocked_by_stay_inside_the_vocabulary() -> None:
    """A deliberately messy week — nothing may emit an off-contract slug."""
    request = make_request(
        positions=[
            position("role", day(0), "16:00", "22:00", role="SOMMELIER"),
            position("level", day(0), "16:00", "22:00", required_level="senior"),
            position("loc", day(1), "16:00", "22:00", location="L9"),
            position("busy", day(2), "16:00", "22:00"),
            position("excl", day(3), "16:00", "22:00"),
        ],
        people=[
            person("junior", level="junior", max_hours_week=6),
            person("mid", level="mid", max_hours_week=6),
        ],
        excluded=[
            {"position_id": "excl", "user_id": "junior"},
            {"position_id": "excl", "user_id": "mid"},
        ],
    )
    response = solve(request)
    assert response["status"] == "partial"
    for entry in response["unfilled"]:
        assert entry["reason"] in slugs.CLOSED_VOCABULARY
        for candidate in entry["closest_candidates"]:
            assert candidate["blocked_by"] in slugs.CLOSED_VOCABULARY


# --------------------------------------------------------------------------- #
# Shape and content of an unfilled entry
# --------------------------------------------------------------------------- #


def test_unfilled_entry_has_every_contract_field() -> None:
    request = make_request(
        positions=[position("p1", day(0), "16:00", "23:00", role="KIT")],
        people=[person("u1", roles=["FOH"])],
    )
    response = solve(request)
    entry = response["unfilled"][0]
    assert set(entry) == {
        "position_id",
        "date",
        "role_id",
        "start",
        "end",
        "reason",
        "detail",
        "closest_candidates",
    }
    assert entry["position_id"] == "p1"
    assert entry["date"] == day(0)
    assert entry["role_id"] == "KIT"
    # Local wall-clock times, rendered in the business timezone.
    assert entry["start"] == "16:00"
    assert entry["end"] == "23:00"


def test_hour_limit_is_named_as_the_reason_and_in_the_detail() -> None:
    """The contract's worked example: capable people, all out of hours."""
    request = make_request(
        positions=[position(f"p{i}", day(i), "10:00", "18:00") for i in range(4)],
        people=[
            person("u1", max_hours_week=8),
            person("u2", max_hours_week=8),
            person("u3", max_hours_week=8),
        ],
    )
    response = solve(request)
    assert response["stats"]["filled"] == 3
    entry = response["unfilled"][0]
    assert entry["reason"] == "max_hours_week"
    assert "can work KIT" in entry["detail"]
    assert "weekly hour limit" in entry["detail"]
    assert entry["closest_candidates"]
    assert all(
        c["blocked_by"] == "max_hours_week" for c in entry["closest_candidates"]
    )


def test_availability_is_named_when_that_is_the_blocker() -> None:
    request = make_request(
        positions=[position("p1", day(0), "16:00", "22:00")],
        people=[
            person("u1", availability=[{"date": day(0), "from": "08:00", "to": "12:00"}])
        ],
    )
    response = solve(request)
    entry = response["unfilled"][0]
    assert entry["reason"] == "availability"
    assert "not available" in entry["detail"]
    assert entry["closest_candidates"] == [
        {"user_id": "u1", "blocked_by": "availability"}
    ]


def test_no_eligible_person_when_nobody_is_even_capable() -> None:
    request = make_request(
        positions=[position("p1", day(0), "16:00", "22:00", required_level="senior")],
        people=[person("j", level="junior"), person("m", level="mid")],
    )
    response = solve(request)
    entry = response["unfilled"][0]
    assert entry["reason"] == slugs.NO_ELIGIBLE_PERSON
    assert "Nobody can work KIT" in entry["detail"]
    # Still names who was closest and what ruled them out.
    assert {c["blocked_by"] for c in entry["closest_candidates"]} == {"required_level"}


def test_excluded_person_is_named_as_excluded() -> None:
    request = make_request(
        positions=[position("p1", day(0), "16:00", "22:00")],
        people=[person("u1")],
        excluded=[{"position_id": "p1", "user_id": "u1"}],
    )
    response = solve(request)
    entry = response["unfilled"][0]
    assert entry["closest_candidates"] == [{"user_id": "u1", "blocked_by": "excluded"}]


def test_closest_candidates_are_ranked_by_how_far_they_got() -> None:
    """Someone blocked only on hours ranks above someone who lacks the role."""
    request = make_request(
        positions=[
            position("taken", day(0), "10:00", "18:00"),
            position("target", day(1), "10:00", "18:00"),
        ],
        people=[
            person("wrong_role", roles=["FOH"]),
            person("out_of_hours", roles=["KIT"], max_hours_week=8),
        ],
    )
    response = solve(request)
    # Only one of the two 8-hour positions fits inside the 8-hour cap; whichever
    # is left over must rank the out-of-hours cook above the wrong-role one.
    assert len(response["unfilled"]) == 1
    entry = response["unfilled"][0]
    assert entry["closest_candidates"][0]["user_id"] == "out_of_hours"
    assert entry["closest_candidates"][0]["blocked_by"] == "max_hours_week"


def test_closest_candidates_are_capped_and_deterministic() -> None:
    request = make_request(
        positions=[position("p1", day(0), "16:00", "22:00")],
        people=[person(f"u{i}", roles=["FOH"]) for i in range(8)],
    )
    first = solve(request)["unfilled"][0]["closest_candidates"]
    second = solve(request)["unfilled"][0]["closest_candidates"]
    assert len(first) <= 3
    assert first == second


def test_diagnostics_never_relax_a_rule() -> None:
    """Running diagnostics does not change the roster it explains."""
    request = make_request(
        positions=[position(f"p{i}", day(i), "10:00", "18:00") for i in range(4)],
        people=[person("u1", max_hours_week=8)],
    )
    response = solve(request)
    assert response["stats"]["filled"] == 1
    assert len(response["unfilled"]) == 3
    # The blocked people are still blocked after the explanation pass.
    for entry in response["unfilled"]:
        assert entry["reason"] != "ok"
        assert entry["closest_candidates"]


# --------------------------------------------------------------------------- #
# Coverage gap details
# --------------------------------------------------------------------------- #


def test_coverage_gap_entry_has_every_contract_field() -> None:
    request = make_request(
        positions=[position("p1", day(0), "10:00", "14:00")],
        people=[person("s1", level="senior")],
        rules_in=rules(
            senior_enabled=True,
            open_hours=[{"date": day(0), "from": "10:00", "to": "20:00"}],
        ),
    )
    response = solve(request)
    gap = response["coverage_gaps"][0]
    assert set(gap) == {"date", "from", "to", "rule", "detail"}
    assert gap["rule"] == "senior_coverage"
    assert gap["detail"].endswith(".")


def test_coverage_gap_explains_a_missing_position() -> None:
    request = make_request(
        positions=[position("p1", day(0), "10:00", "14:00")],
        people=[person("s1", level="senior")],
        rules_in=rules(
            senior_enabled=True,
            open_hours=[{"date": day(0), "from": "10:00", "to": "20:00"}],
        ),
    )
    response = solve(request)
    assert "No shift is rostered" in response["coverage_gaps"][0]["detail"]


def test_stats_disclose_hours_and_estimated_cost(simple_request: dict) -> None:
    """Costs are ESTIMATES — the app renders the disclaimer beside them."""
    response = solve(simple_request)
    stats = response["stats"]
    assert stats["hours"] == 30.0  # 5 shifts x 6 hours
    assert stats["estimated_cost"] > 0
    assert sum(stats["hours_by_person"].values()) == stats["hours"]
