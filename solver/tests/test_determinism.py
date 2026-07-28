"""Determinism and reproducibility (MODULE_05 §8, contract §Invariants).

Identical request + seed ⇒ identical response. This is what makes "why is Omar
on Friday?" answerable months later by replaying the stored ``solve_run``.
"""

from __future__ import annotations

import copy
import json

from conftest import day, make_request, person, position, rules

from app.solve import solve


def _stable(response: dict) -> str:
    """The response minus the wall-clock timing, serialised for comparison."""
    trimmed = copy.deepcopy(response)
    trimmed["stats"].pop("solve_seconds", None)
    return json.dumps(trimmed, sort_keys=True)


def _busy_request(**overrides) -> dict:
    """A week with real choices in it, so a non-deterministic solver would show."""
    positions = [
        position(f"p{d}_{s}", day(d), f"{10 + 6 * s:02d}:00", f"{16 + 6 * s:02d}:00",
                 role="KIT" if s == 0 else "FOH")
        for d in range(7)
        for s in range(2)
    ]
    people = [
        person(f"u{i}", roles=["KIT", "FOH"], pay_rate=25.0 + i * 3, max_hours_week=30)
        for i in range(5)
    ]
    kwargs = {
        "positions": positions,
        "people": people,
        "rules_in": rules(one_shift_per_day=True, min_rest_hours=10),
    }
    kwargs.update(overrides)
    return make_request(**kwargs)


def test_identical_request_and_seed_gives_identical_output() -> None:
    request = _busy_request()
    first = solve(copy.deepcopy(request))
    second = solve(copy.deepcopy(request))
    assert _stable(first) == _stable(second)


def test_repeated_solves_are_stable_over_many_runs() -> None:
    request = _busy_request()
    baseline = _stable(solve(copy.deepcopy(request)))
    for _ in range(4):
        assert _stable(solve(copy.deepcopy(request))) == baseline


def test_seed_is_echoed_in_diagnostics() -> None:
    request = _busy_request(seed=1234)
    response = solve(request)
    assert response["diagnostics"]["seed"] == 1234
    assert response["diagnostics"]["time_limit_hit"] is False


def test_lock_and_regenerate_preserves_every_pin() -> None:
    """M5 §7: locks are how the manager steers a regeneration."""
    request = _busy_request()
    first = solve(copy.deepcopy(request))
    assert first["assignments"]

    pins = first["assignments"][:4]
    regenerated = solve(
        _busy_request(
            locked=[
                {"position_id": a["position_id"], "user_id": a["user_id"]} for a in pins
            ]
        )
    )
    assigned = {a["position_id"]: a["user_id"] for a in regenerated["assignments"]}
    for pin in pins:
        assert assigned[pin["position_id"]] == pin["user_id"]


def test_priority_ranking_changes_the_roster() -> None:
    """M5 §11: fairness-first spreads hours more evenly than cost-first."""
    positions = [position(f"p{d}", day(d), "10:00", "18:00") for d in range(6)]
    people = [
        person("cheap", pay_rate=20.0, max_hours_week=None),
        person("dear", pay_rate=45.0, max_hours_week=None),
    ]
    common = {
        "positions": positions,
        "people": people,
        "rules_in": rules(max_consecutive_days=None, min_rest_hours=10),
    }

    cost_first = solve(
        make_request(
            **common,
            objective_priority=["cost", "preferences", "consistency", "fairness"],
        )
    )
    fairness_first = solve(
        make_request(
            **common,
            objective_priority=["fairness", "cost", "preferences", "consistency"],
        )
    )

    def spread(response: dict) -> float:
        hours = response["stats"]["hours_by_person"]
        values = [hours.get("cheap", 0.0), hours.get("dear", 0.0)]
        return abs(values[0] - values[1])

    assert cost_first["stats"]["filled"] == fairness_first["stats"]["filled"] == 6
    # Cost-first loads the cheap person; fairness-first splits the week evenly.
    assert spread(fairness_first) < spread(cost_first)
    assert fairness_first["stats"]["estimated_cost"] > cost_first["stats"]["estimated_cost"]


def test_stats_are_internally_consistent() -> None:
    request = _busy_request()
    response = solve(request)
    stats = response["stats"]
    assert stats["filled"] == len(response["assignments"])
    assert stats["positions"] == len(request["positions"])
    assert stats["filled"] + len(response["unfilled"]) == stats["positions"]
    assert round(sum(stats["hours_by_person"].values()), 2) == stats["hours"]
    assert stats["estimated_cost"] > 0
