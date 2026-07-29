"""Timezones, DST and performance at target scale (MODULE_05 §8, §10).

Sydney's 2026 transitions: clocks go **forward** 02:00→03:00 on Sunday
5 October 2026 (a shift across it is short by an hour) and **back** 03:00→02:00
on Sunday 5 April 2026 (a shift across it is long by an hour). Durations must be
real elapsed time, never "always 8".
"""

from __future__ import annotations

import json
import time
from typing import Any

from conftest import day, make_request, person, position, rules

from app.lambda_handler import handler
from app.server import app as flask_app
from app.solve import solve


def dst_request(
    start_date: str,
    start_iso: str,
    end_iso: str,
    *,
    avail_from: str,
    avail_to: str,
    max_shift_hours: float = 12,
) -> dict[str, Any]:
    """A one-position roster spanning a DST boundary."""
    return {
        "roster": {"start_date": start_date, "days": 2, "timezone": "Australia/Sydney"},
        "positions": [
            {
                "id": "p1",
                "date": start_date,
                "location_id": "L1",
                "role_id": "KIT",
                "start": start_iso,
                "end": end_iso,
                "required_level": None,
            }
        ],
        "people": [
            {
                "id": "u1",
                "roles": ["KIT"],
                "level": "senior",
                "location_id": "L1",
                "can_work_other_locations": False,
                "pay_rate": 30.0,
                "max_hours_week": 38,
                "min_hours_week": 0,
                "max_shifts_week": None,
                "availability": [
                    {"date": start_date, "from": avail_from, "to": avail_to}
                ],
                "preferred_days": [],
                "preferred_time": "no_preference",
            }
        ],
        "rules": {
            "senior_coverage": {
                "enabled": False,
                "min_count": 1,
                "qualifying_levels": ["senior"],
                "open_hours": [],
            },
            "max_consecutive_days": 6,
            "min_rest_hours": 10,
            "max_shift_hours": max_shift_hours,
            "min_shift_hours": 3,
            "one_shift_per_day": True,
        },
        "locked": [],
        "excluded": [],
        "objective_priority": ["fairness", "cost", "preferences", "consistency"],
        "previous_roster": [],
        "time_limit_seconds": 10,
        "seed": 42,
    }


# --------------------------------------------------------------------------- #
# DST
# --------------------------------------------------------------------------- #


def test_spring_forward_shift_is_seven_hours_not_eight() -> None:
    """22:00 Sat → 06:00 Sun across the forward jump is 7 real hours."""
    request = dst_request(
        "2026-10-03",
        "2026-10-03T22:00:00+10:00",
        "2026-10-04T06:00:00+11:00",
        avail_from="21:00",
        avail_to="07:00",
    )
    response = solve(request)
    assert response["status"] == "ok"
    assert response["stats"]["hours"] == 7.0
    assert response["stats"]["estimated_cost"] == 210.0  # 7h x $30


def test_autumn_back_shift_is_nine_hours_not_eight() -> None:
    """22:00 Sat → 06:00 Sun across the backward jump is 9 real hours."""
    request = dst_request(
        "2026-04-04",
        "2026-04-04T22:00:00+11:00",
        "2026-04-05T06:00:00+10:00",
        avail_from="21:00",
        avail_to="07:00",
    )
    response = solve(request)
    assert response["status"] == "ok"
    assert response["stats"]["hours"] == 9.0
    assert response["stats"]["estimated_cost"] == 270.0  # 9h x $30


def test_max_shift_hours_uses_real_elapsed_time_across_dst() -> None:
    """The 9-hour autumn shift breaches an 8-hour cap; the 7-hour one does not."""
    long_one = dst_request(
        "2026-04-04",
        "2026-04-04T22:00:00+11:00",
        "2026-04-05T06:00:00+10:00",
        avail_from="21:00",
        avail_to="07:00",
        max_shift_hours=8,
    )
    assert solve(long_one)["assignments"] == []

    short_one = dst_request(
        "2026-10-03",
        "2026-10-03T22:00:00+10:00",
        "2026-10-04T06:00:00+11:00",
        avail_from="21:00",
        avail_to="07:00",
        max_shift_hours=8,
    )
    assert solve(short_one)["stats"]["filled"] == 1


def test_utc_input_is_rendered_in_the_business_timezone() -> None:
    """The app may send UTC; unfilled rows still read in Sydney local time."""
    request = dst_request(
        "2026-08-03",
        "2026-08-03T06:00:00Z",  # 16:00 AEST
        "2026-08-03T12:00:00Z",  # 22:00 AEST
        avail_from="09:00",
        avail_to="10:00",  # deliberately unavailable ⇒ unfilled
    )
    response = solve(request)
    entry = response["unfilled"][0]
    assert (entry["start"], entry["end"]) == ("16:00", "22:00")


# --------------------------------------------------------------------------- #
# Performance at target scale (M5 §8: 30 staff x 200 positions under 2 seconds)
# --------------------------------------------------------------------------- #


def test_target_scale_solves_in_under_two_seconds() -> None:
    roles = ["KIT", "FOH", "BAR"]
    positions = []
    n = 0
    for d in range(14):
        for slot, (start_h, end_h) in enumerate([("09:00", "15:00"), ("16:00", "22:00")]):
            for r, role in enumerate(roles * 3):  # ~9 people needed per slot
                positions.append(
                    position(f"p{n}", day(d), start_h, end_h, role=role)
                )
                n += 1
    assert len(positions) >= 200

    people = [
        person(
            f"u{i}",
            roles=[roles[i % 3], roles[(i + 1) % 3]],
            level=["junior", "mid", "senior"][i % 3],
            pay_rate=24.0 + (i % 7) * 2,
            max_hours_week=38,
            available_days=14,
        )
        for i in range(30)
    ]

    request = make_request(
        positions=positions,
        people=people,
        days=14,
        rules_in=rules(
            senior_enabled=True,
            open_hours=[
                {"date": day(d), "from": "09:00", "to": "22:00"} for d in range(14)
            ],
            one_shift_per_day=True,
            min_rest_hours=10,
            max_consecutive_days=6,
        ),
        time_limit_seconds=15,
    )

    started = time.perf_counter()
    response = solve(request)
    elapsed = time.perf_counter() - started

    assert response["status"] in ("ok", "partial")
    assert elapsed < 2.0, f"target-scale solve took {elapsed:.2f}s"
    assert response["diagnostics"]["time_limit_hit"] is False
    assert response["stats"]["filled"] > 0


# --------------------------------------------------------------------------- #
# Entry points — both must return exactly what solve() returns
# --------------------------------------------------------------------------- #


def test_lambda_direct_invocation(simple_request: dict) -> None:
    """The Lambda entry point must return exactly what solve() returns.

    `stats.solve_seconds` is wall-clock elapsed time and so differs between any
    two invocations — comparing it made this test flaky (it passed only when the
    two runs happened to round to the same value). Everything that is supposed
    to be deterministic is compared; the timing is asserted as a shape instead.
    """
    via_handler = handler(simple_request)
    direct = solve(simple_request)

    def without_timing(response: dict) -> dict:
        stats = {k: v for k, v in response["stats"].items() if k != "solve_seconds"}
        return {**response, "stats": stats}

    assert without_timing(via_handler) == without_timing(direct)
    assert isinstance(via_handler["stats"]["solve_seconds"], (int, float))


def test_lambda_proxy_invocation(simple_request: dict) -> None:
    event = {
        "requestContext": {"http": {"method": "POST"}},
        "headers": {"content-type": "application/json"},
        "body": json.dumps(simple_request),
        "isBase64Encoded": False,
    }
    result = handler(event)
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["status"] == "ok"


def test_lambda_proxy_rejects_a_bad_body() -> None:
    event = {"requestContext": {}, "headers": {}, "body": "not json"}
    result = handler(event)
    assert result["statusCode"] == 400
    assert json.loads(result["body"])["status"] == "failed"


def test_flask_solve_endpoint(simple_request: dict) -> None:
    client = flask_app.test_client()
    response = client.post("/solve", json=simple_request)
    assert response.status_code == 200
    assert response.get_json()["status"] == "ok"


def test_flask_health() -> None:
    client = flask_app.test_client()
    assert client.get("/health").get_json() == {"status": "ok"}


def test_flask_rejects_a_non_object_body() -> None:
    client = flask_app.test_client()
    response = client.post("/solve", json=[1, 2, 3])
    assert response.status_code == 400
    assert response.get_json()["status"] == "failed"
