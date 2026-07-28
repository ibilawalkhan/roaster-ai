"""The always-returns-a-roster property (MODULE_05 §5.2, §11).

Demand is soft. A week nobody can staff comes back ``partial`` with explained
gaps — never an exception, and never ``failed``. ``failed`` is reserved for
malformed input and internal errors.
"""

from __future__ import annotations

from conftest import day, make_request, person, position, rules

from app.slugs import CLOSED_VOCABULARY
from app.solve import solve


def test_short_staffed_week_returns_partial() -> None:
    """Ten positions, one person: nine gaps, one roster, no exception."""
    request = make_request(
        positions=[
            position(f"p{i}", day(i // 2), f"{8 + 6 * (i % 2):02d}:00",
                     f"{14 + 6 * (i % 2):02d}:00")
            for i in range(10)
        ],
        people=[person("solo", max_hours_week=38)],
    )
    response = solve(request)
    assert response["status"] == "partial"
    assert len(response["unfilled"]) == 10 - response["stats"]["filled"]
    for entry in response["unfilled"]:
        assert entry["reason"] in CLOSED_VOCABULARY
        assert entry["detail"]


def test_everyone_unavailable_returns_all_unfilled_not_an_error() -> None:
    request = make_request(
        positions=[position(f"p{i}", day(i), "16:00", "22:00") for i in range(3)],
        people=[person("u1", availability=[]), person("u2", availability=[])],
    )
    response = solve(request)
    assert response["status"] == "partial"
    assert response["assignments"] == []
    assert len(response["unfilled"]) == 3
    assert {u["reason"] for u in response["unfilled"]} == {"availability"}


def test_no_staff_at_all_returns_all_unfilled() -> None:
    request = make_request(
        positions=[position("p1", day(0), "16:00", "22:00")],
        people=[],
    )
    response = solve(request)
    assert response["status"] == "partial"
    assert response["unfilled"][0]["reason"] == "no_eligible_person"
    assert response["unfilled"][0]["closest_candidates"] == []


def test_no_positions_is_a_clean_ok() -> None:
    request = make_request(positions=[], people=[person("u1")])
    response = solve(request)
    assert response["status"] == "ok"
    assert response["stats"]["positions"] == 0
    assert response["stats"]["hours"] == 0.0


def test_nobody_holds_the_role() -> None:
    request = make_request(
        positions=[position("p1", day(0), "16:00", "22:00", role="SOMMELIER")],
        people=[person("u1", roles=["KIT"]), person("u2", roles=["FOH"])],
    )
    response = solve(request)
    assert response["status"] == "partial"
    entry = response["unfilled"][0]
    assert entry["reason"] == "no_eligible_person"
    assert "SOMMELIER" in entry["detail"]


def test_demand_far_beyond_capacity_still_returns() -> None:
    """Every hard limit binding at once still yields a roster, not a failure."""
    request = make_request(
        positions=[
            position(f"p{d}_{s}", day(d), f"{8 + 6 * s:02d}:00", f"{14 + 6 * s:02d}:00")
            for d in range(7)
            for s in range(2)
        ],
        people=[
            person("u1", max_hours_week=12, max_shifts_week=2),
            person("u2", max_hours_week=12, max_shifts_week=2),
        ],
        rules_in=rules(max_consecutive_days=2, min_rest_hours=12),
    )
    response = solve(request)
    assert response["status"] == "partial"
    assert response["stats"]["filled"] <= 4
    assert response["unfilled"]


# --------------------------------------------------------------------------- #
# `failed` really is reserved for malformed input
# --------------------------------------------------------------------------- #


def test_malformed_request_returns_failed_not_an_exception() -> None:
    response = solve({"roster": {}})
    assert response["status"] == "failed"
    assert "malformed request" in response["diagnostics"]["error"]


def test_duplicate_position_id_is_malformed() -> None:
    request = make_request(
        positions=[
            position("dup", day(0), "16:00", "22:00"),
            position("dup", day(1), "16:00", "22:00"),
        ],
        people=[person("u1")],
    )
    response = solve(request)
    assert response["status"] == "failed"
    assert "duplicate position id" in response["diagnostics"]["error"]


def test_lock_referencing_an_unknown_person_is_malformed() -> None:
    request = make_request(
        positions=[position("p1", day(0), "16:00", "22:00")],
        people=[person("u1")],
        locked=[{"position_id": "p1", "user_id": "ghost"}],
    )
    response = solve(request)
    assert response["status"] == "failed"
    assert "ghost" in response["diagnostics"]["error"]


def test_position_ending_before_it_starts_is_malformed() -> None:
    bad = position("p1", day(0), "16:00", "22:00")
    bad["end"] = bad["start"]
    request = make_request(positions=[bad], people=[person("u1")])
    response = solve(request)
    assert response["status"] == "failed"


def test_failed_response_still_matches_the_contract_shape() -> None:
    response = solve({"nonsense": True})
    assert response["status"] == "failed"
    for key in ("assignments", "unfilled", "coverage_gaps", "stats", "diagnostics"):
        assert key in response
    assert set(response["stats"]) == {
        "positions",
        "filled",
        "hours",
        "estimated_cost",
        "solve_seconds",
        "hours_by_person",
    }
