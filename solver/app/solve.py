"""Top-level orchestrator: contract in → CP-SAT → contract out.

``solve(request) -> response`` implements docs/SOLVER_CONTRACT.md (frozen v1)
exactly. It is pure and deterministic: no network calls, no clock-dependent
behaviour beyond the reported ``solve_seconds``, and identical output for an
identical request and seed.

Status semantics (contract §Invariants):

* ``ok``      — every position filled and no senior-coverage gap;
* ``partial`` — a short-staffed or under-covered week, explained;
* ``failed``  — malformed input or an internal error, and nothing else. A week
  that simply cannot be staffed is **never** a failure.
"""

from __future__ import annotations

import time
from typing import Any

from ortools.sat.python import cp_model

from . import constraints, diagnostics
from .context import Context, build_context
from .model import build_model


def _empty_response(request: dict, status: str) -> dict[str, Any]:
    return {
        "status": status,
        "assignments": [],
        "unfilled": [],
        "coverage_gaps": [],
        "stats": {
            "positions": len(request.get("positions", []) or []),
            "filled": 0,
            "hours": 0.0,
            "estimated_cost": 0.0,
            "solve_seconds": 0.0,
            "hours_by_person": {},
        },
        "diagnostics": {
            "objective_value": 0,
            "seed": int(request.get("seed", 42) or 42),
            "time_limit_hit": False,
        },
    }


def _failed(request: dict, error: str, started: float) -> dict[str, Any]:
    """The failure envelope.

    Keeps the contract's response shape; the explanation rides in
    ``diagnostics.error`` so the app has something to show and to log rather
    than a bare status.
    """
    response = _empty_response(request, "failed")
    response["stats"]["solve_seconds"] = round(time.perf_counter() - started, 3)
    response["diagnostics"]["error"] = error
    return response


def _validate(request: dict, ctx: Context) -> None:
    """Reject malformed input up front. Raises ``ValueError``."""
    if ctx.days <= 0:
        raise ValueError("roster.days must be positive")

    seen_positions: set[str] = set()
    for position in ctx.positions:
        if position.id in seen_positions:
            raise ValueError(f"duplicate position id {position.id!r}")
        seen_positions.add(position.id)
        if position.end <= position.start:
            raise ValueError(f"position {position.id!r} ends before it starts")

    seen_people: set[str] = set()
    for person in ctx.people:
        if person.id in seen_people:
            raise ValueError(f"duplicate person id {person.id!r}")
        seen_people.add(person.id)

    locked_raw = request.get("locked", []) or []
    locked_positions: set[str] = set()
    for lock in locked_raw:
        position_id, user_id = lock["position_id"], lock["user_id"]
        if position_id in locked_positions:
            raise ValueError(f"position {position_id!r} is locked more than once")
        locked_positions.add(position_id)
        if position_id not in ctx.positions_by_id:
            raise ValueError(f"locked position {position_id!r} is not in the roster")
        if user_id not in ctx.people_by_id:
            raise ValueError(f"locked user {user_id!r} is not in the request")

    for excl in request.get("excluded", []) or []:
        if excl["position_id"] not in ctx.positions_by_id:
            raise ValueError(
                f"excluded position {excl['position_id']!r} is not in the roster"
            )
        if excl["user_id"] not in ctx.people_by_id:
            raise ValueError(f"excluded user {excl['user_id']!r} is not in the request")


def solve(request: dict) -> dict[str, Any]:
    """Solve one roster. Never raises for a short-staffed week."""
    started = time.perf_counter()

    try:
        ctx = build_context(request)
        _validate(request, ctx)
    except Exception as exc:  # noqa: BLE001 — any parse problem is malformed input
        return _failed(request, f"malformed request: {exc}", started)

    try:
        built = build_model(ctx)

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = ctx.time_limit_seconds
        solver.parameters.random_seed = ctx.seed
        # Single worker: CP-SAT's portfolio search is non-deterministic under a
        # wall-clock limit, and reproducibility is a contract invariant (M5 §8).
        solver.parameters.num_workers = 1
        solver.parameters.log_search_progress = False

        status = solver.Solve(built.model)

        if status in (cp_model.INFEASIBLE, cp_model.MODEL_INVALID):
            # Unreachable by construction: all-shortfall is always feasible.
            return _failed(
                request,
                f"internal error: model reported {solver.StatusName(status)}",
                started,
            )

        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            # No solution found inside the limit. Still return a roster: the
            # seeded, wholly unfilled one, explained (contract §App-side).
            return _degenerate(ctx, request, built, started)

        return _extract(ctx, request, built, solver, status, started)

    except Exception as exc:  # noqa: BLE001 — never leak a stack trace to the app
        return _failed(request, f"internal error: {exc}", started)


def _degenerate(ctx: Context, request: dict, built, started: float) -> dict[str, Any]:
    """Everything unfilled — used only when the solver found nothing in time."""
    response = _empty_response(request, "partial")
    response["unfilled"] = [
        diagnostics.explain_unfilled(
            ctx, position, {}, built.rejected_locks, built.oversized
        )
        for position in ctx.positions
    ]
    response["stats"]["solve_seconds"] = round(time.perf_counter() - started, 3)
    response["diagnostics"]["seed"] = ctx.seed
    response["diagnostics"]["time_limit_hit"] = True
    return response


def _extract(
    ctx: Context,
    request: dict,
    built,
    solver: cp_model.CpSolver,
    status: int,
    started: float,
) -> dict[str, Any]:
    """Map the solved model back onto the response contract."""
    # Ordered by position index so the response is byte-stable across runs.
    assignments: list[dict[str, str]] = []
    assigned_by_person: dict[str, list] = {}
    for (person_idx, position_idx), var in sorted(
        built.x.items(), key=lambda kv: (kv[0][1], kv[0][0])
    ):
        if solver.Value(var):
            person = ctx.people[person_idx]
            position = ctx.positions[position_idx]
            assignments.append({"position_id": position.id, "user_id": person.id})
            assigned_by_person.setdefault(person.id, []).append(position)

    # Safety net: the promise of this module is that a returned roster cannot
    # breach a hard constraint. Verify independently rather than trust the
    # encoding; a breach is an internal error, not something we ship.
    violations = constraints.verify_assignments(ctx, assignments)
    if violations:
        return _failed(
            request,
            "internal error: hard constraint violated — " + "; ".join(violations[:5]),
            started,
        )

    unfilled = [
        diagnostics.explain_unfilled(
            ctx, position, assigned_by_person, built.rejected_locks, built.oversized
        )
        for position in ctx.positions
        if solver.Value(built.shortfall[position.idx])
    ]

    gap_values = [solver.Value(g) for g in built.gap_vars]
    coverage_gaps = [
        diagnostics.explain_coverage_gap(ctx, window, assigned_by_person)
        for window in diagnostics.merge_gap_segments(built.segments, gap_values)
    ]

    total_minutes = 0
    total_cost = 0.0
    hours_by_person: dict[str, float] = {}
    for person in ctx.people:
        positions = assigned_by_person.get(person.id)
        if not positions:
            continue
        minutes = sum(p.duration_min for p in positions)
        total_minutes += minutes
        total_cost += (minutes / 60.0) * person.pay_rate
        hours_by_person[person.id] = round(minutes / 60.0, 2)

    return {
        "status": "ok" if not unfilled and not coverage_gaps else "partial",
        "assignments": assignments,
        "unfilled": unfilled,
        "coverage_gaps": coverage_gaps,
        "stats": {
            "positions": len(ctx.positions),
            "filled": len(assignments),
            "hours": round(total_minutes / 60.0, 2),
            # ESTIMATE only — never payroll (REQUIREMENTS.md §0).
            "estimated_cost": round(total_cost, 2),
            "solve_seconds": round(time.perf_counter() - started, 3),
            "hours_by_person": hours_by_person,
        },
        "diagnostics": {
            "objective_value": int(round(solver.ObjectiveValue())),
            "seed": ctx.seed,
            "time_limit_hit": status == cp_model.FEASIBLE,
        },
    }
