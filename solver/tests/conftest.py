"""Shared fixtures and request builders for the solver test suite.

All scenarios are anchored to Monday 2026-08-03 in Australia/Sydney (AEST,
+10:00), matching the examples in docs/SOLVER_CONTRACT.md.
"""

from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pytest

# Make the solver package importable when pytest is run from the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

START = "2026-08-03"  # a Monday
OFFSET = "+10:00"  # AEST — Australia/Sydney in August


def day(offset: int) -> str:
    """Calendar date ``offset`` days after the roster start."""
    return (date.fromisoformat(START) + timedelta(days=offset)).isoformat()


def at(date_str: str, hhmm: str) -> str:
    """An offset-aware ISO timestamp for the business timezone."""
    return f"{date_str}T{hhmm}:00{OFFSET}"


def position(
    pid: str,
    date_str: str,
    start_hhmm: str,
    end_hhmm: str,
    *,
    role: str = "KIT",
    location: str = "L1",
    required_level: str | None = None,
    end_next_day: bool = False,
) -> dict[str, Any]:
    """One position — i.e. one person needed (slot counts are pre-expanded)."""
    end_date = date_str
    if end_next_day:
        end_date = (date.fromisoformat(date_str) + timedelta(days=1)).isoformat()
    return {
        "id": pid,
        "date": date_str,
        "location_id": location,
        "role_id": role,
        "start": at(date_str, start_hhmm),
        "end": at(end_date, end_hhmm),
        "required_level": required_level,
    }


def person(
    uid: str,
    *,
    roles: list[str] | None = None,
    level: str | None = "mid",
    location: str | None = "L1",
    can_work_other_locations: bool = False,
    pay_rate: float = 30.0,
    max_hours_week: float | None = 38,
    min_hours_week: float = 0,
    max_shifts_week: int | None = None,
    availability: list[dict[str, str]] | None = None,
    available_days: int = 14,
    available_from: str = "00:00",
    available_to: str = "23:59",
    preferred_days: list[int] | None = None,
    preferred_time: str = "no_preference",
    active: bool = True,
) -> dict[str, Any]:
    """A person with wide-open availability by default.

    ``availability`` arrives pre-resolved from the app (M3 §6); the helper just
    fabricates plausible resolved windows.
    """
    if availability is None:
        availability = [
            {"date": day(d), "from": available_from, "to": available_to}
            for d in range(available_days)
        ]
    return {
        "id": uid,
        "roles": roles if roles is not None else ["KIT"],
        "level": level,
        "location_id": location,
        "can_work_other_locations": can_work_other_locations,
        "pay_rate": pay_rate,
        "max_hours_week": max_hours_week,
        "min_hours_week": min_hours_week,
        "max_shifts_week": max_shifts_week,
        "active": active,
        "availability": availability,
        "preferred_days": preferred_days or [],
        "preferred_time": preferred_time,
    }


def rules(
    *,
    senior_enabled: bool = False,
    senior_min_count: int = 1,
    qualifying_levels: list[str] | None = None,
    open_hours: list[dict[str, str]] | None = None,
    max_consecutive_days: int | None = 6,
    min_rest_hours: float | None = 10,
    max_shift_hours: float | None = 12,
    min_shift_hours: float | None = 3,
    one_shift_per_day: bool = True,
) -> dict[str, Any]:
    return {
        "senior_coverage": {
            "enabled": senior_enabled,
            "min_count": senior_min_count,
            "qualifying_levels": qualifying_levels or ["senior"],
            "open_hours": open_hours or [],
        },
        "max_consecutive_days": max_consecutive_days,
        "min_rest_hours": min_rest_hours,
        "max_shift_hours": max_shift_hours,
        "min_shift_hours": min_shift_hours,
        "one_shift_per_day": one_shift_per_day,
    }


def make_request(
    *,
    positions: list[dict[str, Any]],
    people: list[dict[str, Any]],
    days: int = 7,
    rules_in: dict[str, Any] | None = None,
    locked: list[dict[str, str]] | None = None,
    excluded: list[dict[str, str]] | None = None,
    objective_priority: list[str] | None = None,
    previous_roster: list[dict[str, str]] | None = None,
    time_limit_seconds: float = 10,
    seed: int = 42,
) -> dict[str, Any]:
    return {
        "roster": {"start_date": START, "days": days, "timezone": "Australia/Sydney"},
        "positions": positions,
        "people": people,
        "rules": rules_in if rules_in is not None else rules(),
        "locked": locked or [],
        "excluded": excluded or [],
        "objective_priority": objective_priority
        or ["fairness", "cost", "preferences", "consistency"],
        "previous_roster": previous_roster or [],
        "time_limit_seconds": time_limit_seconds,
        "seed": seed,
    }


@pytest.fixture
def simple_request() -> dict[str, Any]:
    """A comfortably staffable week: 5 evening kitchen shifts, 3 cooks."""
    positions = [
        position(f"p{i}", day(i), "16:00", "22:00") for i in range(5)
    ]
    people = [
        person("u1", pay_rate=30.0),
        person("u2", pay_rate=32.0),
        person("u3", pay_rate=28.0),
    ]
    return make_request(positions=positions, people=people)
