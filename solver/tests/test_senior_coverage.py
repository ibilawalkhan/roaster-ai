"""Senior coverage as a timeline constraint (MODULE_05 §5.3).

Coverage is required over *time*, not per shift: a senior 10:00-17:00 and
another 16:00-23:00 cover a 10:00-23:00 open day between them. Gaps are
penalised slack, so they surface in ``coverage_gaps`` and never fail the solve.
"""

from __future__ import annotations

from conftest import day, make_request, person, position, rules

from app.solve import solve


def open_hours(*windows: tuple[int, str, str]) -> list[dict[str, str]]:
    return [{"date": day(d), "from": f, "to": t} for d, f, t in windows]


def gaps_on(response: dict, date_str: str) -> list[dict]:
    return [g for g in response["coverage_gaps"] if g["date"] == date_str]


# --------------------------------------------------------------------------- #


def test_two_overlapping_seniors_cover_the_day_between_them() -> None:
    """No requirement that every individual shift contains a senior."""
    request = make_request(
        positions=[
            position("early", day(0), "10:00", "17:00"),
            position("late", day(0), "16:00", "23:00"),
        ],
        people=[
            person("s1", level="senior", max_hours_week=None),
            person("s2", level="senior", max_hours_week=None),
        ],
        rules_in=rules(
            senior_enabled=True,
            open_hours=open_hours((0, "10:00", "23:00")),
            one_shift_per_day=True,
            min_rest_hours=0,
        ),
    )
    response = solve(request)
    assert response["status"] == "ok"
    assert response["coverage_gaps"] == []
    assert response["stats"]["filled"] == 2


def test_uncovered_tail_is_reported_as_a_gap_not_a_failure() -> None:
    """Open until 22:30, but the only shift ends at 20:00."""
    request = make_request(
        positions=[position("p1", day(0), "10:00", "20:00")],
        people=[person("s1", level="senior", max_hours_week=None)],
        rules_in=rules(
            senior_enabled=True,
            open_hours=open_hours((0, "10:00", "22:30")),
            max_shift_hours=12,
        ),
    )
    response = solve(request)
    assert response["status"] == "partial"
    gaps = gaps_on(response, day(0))
    assert len(gaps) == 1
    assert gaps[0]["from"] == "20:00"
    assert gaps[0]["to"] == "22:30"
    assert gaps[0]["rule"] == "senior_coverage"
    assert gaps[0]["detail"]


def test_gap_granularity_is_fifteen_minutes() -> None:
    """Open to 22:30 with cover to 22:15 leaves exactly one 15-minute block."""
    request = make_request(
        positions=[position("p1", day(0), "12:00", "22:15")],
        people=[person("s1", level="senior", max_hours_week=None)],
        rules_in=rules(
            senior_enabled=True,
            open_hours=open_hours((0, "12:00", "22:30")),
            max_shift_hours=12,
        ),
    )
    response = solve(request)
    gaps = gaps_on(response, day(0))
    assert len(gaps) == 1
    assert (gaps[0]["from"], gaps[0]["to"]) == ("22:15", "22:30")


def test_no_senior_exists_reports_the_whole_window() -> None:
    request = make_request(
        positions=[position("p1", day(0), "10:00", "18:00")],
        people=[person("m1", level="mid", max_hours_week=None)],
        rules_in=rules(
            senior_enabled=True, open_hours=open_hours((0, "10:00", "18:00"))
        ),
    )
    response = solve(request)
    assert response["status"] == "partial"
    gaps = gaps_on(response, day(0))
    assert len(gaps) == 1
    assert (gaps[0]["from"], gaps[0]["to"]) == ("10:00", "18:00")
    assert "never be covered" in gaps[0]["detail"]


def test_qualifying_levels_are_honoured() -> None:
    """A business may count mids towards the cover requirement."""
    request = make_request(
        positions=[position("p1", day(0), "10:00", "18:00")],
        people=[person("m1", level="mid", max_hours_week=None)],
        rules_in=rules(
            senior_enabled=True,
            qualifying_levels=["senior", "mid"],
            open_hours=open_hours((0, "10:00", "18:00")),
        ),
    )
    response = solve(request)
    assert response["status"] == "ok"
    assert response["coverage_gaps"] == []


def test_min_count_of_two_requires_two_seniors_on_duty() -> None:
    request = make_request(
        positions=[
            position("a", day(0), "10:00", "18:00"),
            position("b", day(0), "10:00", "18:00"),
        ],
        people=[
            person("s1", level="senior", max_hours_week=None),
            person("s2", level="senior", max_hours_week=None),
        ],
        rules_in=rules(
            senior_enabled=True,
            senior_min_count=2,
            open_hours=open_hours((0, "10:00", "18:00")),
        ),
    )
    response = solve(request)
    assert response["status"] == "ok"
    assert response["coverage_gaps"] == []


def test_min_count_of_two_with_one_senior_leaves_a_gap() -> None:
    request = make_request(
        positions=[
            position("a", day(0), "10:00", "18:00"),
            position("b", day(0), "10:00", "18:00"),
        ],
        people=[
            person("s1", level="senior", max_hours_week=None),
            person("m1", level="mid", max_hours_week=None),
        ],
        rules_in=rules(
            senior_enabled=True,
            senior_min_count=2,
            open_hours=open_hours((0, "10:00", "18:00")),
        ),
    )
    response = solve(request)
    assert response["status"] == "partial"
    assert len(gaps_on(response, day(0))) == 1


# --------------------------------------------------------------------------- #
# Overnight and 24-hour trading days
# --------------------------------------------------------------------------- #


def test_overnight_window_is_one_continuous_run_of_blocks() -> None:
    """22:00-06:00 is one window, not two broken halves (M5 §5.3)."""
    request = make_request(
        positions=[position("night", day(0), "22:00", "06:00", end_next_day=True)],
        people=[
            person(
                "owl",
                level="senior",
                max_hours_week=None,
                availability=[{"date": day(0), "from": "21:00", "to": "07:00"}],
            )
        ],
        rules_in=rules(
            senior_enabled=True,
            open_hours=open_hours((0, "22:00", "06:00")),
            max_shift_hours=12,
        ),
    )
    response = solve(request)
    assert response["status"] == "ok"
    assert response["coverage_gaps"] == []
    assert response["stats"]["filled"] == 1


def test_overnight_window_gap_spans_midnight_as_one_row() -> None:
    """Cover ends at 02:00 on an overnight window; the hole is 02:00-06:00."""
    request = make_request(
        positions=[position("night", day(0), "22:00", "02:00", end_next_day=True)],
        people=[
            person(
                "owl",
                level="senior",
                max_hours_week=None,
                availability=[{"date": day(0), "from": "21:00", "to": "03:00"}],
            )
        ],
        rules_in=rules(
            senior_enabled=True,
            open_hours=open_hours((0, "22:00", "06:00")),
            max_shift_hours=12,
        ),
    )
    response = solve(request)
    assert response["status"] == "partial"
    assert response["stats"]["filled"] == 1
    # One merged row, reported on the following calendar day where it falls.
    assert len(response["coverage_gaps"]) == 1
    gap = response["coverage_gaps"][0]
    assert (gap["from"], gap["to"]) == ("02:00", "06:00")
    assert gap["date"] == day(1)


def test_twenty_four_hour_day() -> None:
    """``00:00`` to ``00:00`` is a full 96-block day, covered by three shifts."""
    request = make_request(
        positions=[
            position("a", day(0), "00:00", "08:00"),
            position("b", day(0), "08:00", "16:00"),
            position("c", day(0), "16:00", "00:00", end_next_day=True),
        ],
        people=[
            person(f"s{i}", level="senior", max_hours_week=None) for i in range(3)
        ],
        rules_in=rules(
            senior_enabled=True,
            open_hours=open_hours((0, "00:00", "00:00")),
            one_shift_per_day=False,
            min_rest_hours=0,
            max_shift_hours=12,
        ),
    )
    response = solve(request)
    assert response["status"] == "ok"
    assert response["coverage_gaps"] == []
    assert response["stats"]["filled"] == 3


def test_twenty_four_hour_day_with_a_hole_in_the_middle() -> None:
    request = make_request(
        positions=[
            position("a", day(0), "00:00", "08:00"),
            position("c", day(0), "16:00", "00:00", end_next_day=True),
        ],
        people=[
            person(f"s{i}", level="senior", max_hours_week=None) for i in range(2)
        ],
        rules_in=rules(
            senior_enabled=True,
            open_hours=open_hours((0, "00:00", "00:00")),
            one_shift_per_day=False,
            min_rest_hours=0,
            max_shift_hours=12,
        ),
    )
    response = solve(request)
    assert response["status"] == "partial"
    assert len(response["coverage_gaps"]) == 1
    gap = response["coverage_gaps"][0]
    assert (gap["from"], gap["to"]) == ("08:00", "16:00")


def test_coverage_disabled_produces_no_gaps() -> None:
    request = make_request(
        positions=[position("p1", day(0), "10:00", "14:00")],
        people=[person("m1", level="mid")],
        rules_in=rules(senior_enabled=False, open_hours=open_hours((0, "08:00", "23:00"))),
    )
    response = solve(request)
    assert response["status"] == "ok"
    assert response["coverage_gaps"] == []


def test_senior_at_hour_limit_is_explained_in_the_gap_detail() -> None:
    """The gap must name *why* — this is what turns a gap into a hiring decision."""
    request = make_request(
        positions=[
            position("d0", day(0), "10:00", "20:00"),
            position("d1", day(1), "10:00", "20:00"),
        ],
        people=[
            # Ten hours of cap: enough for one day only.
            person("s1", level="senior", max_hours_week=10),
            person("m1", level="mid", max_hours_week=None),
        ],
        rules_in=rules(
            senior_enabled=True,
            open_hours=open_hours((0, "10:00", "20:00"), (1, "10:00", "20:00")),
            max_shift_hours=12,
        ),
    )
    response = solve(request)
    assert response["status"] == "partial"
    assert len(response["coverage_gaps"]) == 1
    detail = response["coverage_gaps"][0]["detail"]
    assert "weekly hour limit" in detail
