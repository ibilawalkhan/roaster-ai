"""Hard constraints H1-H14 (MODULE_05 §5.1) — never violated.

Each constraint is expressed **twice, from one definition**:

* as a pure predicate ``(ctx, person, position, assigned) -> slug | None`` used
  for candidate pruning, for the diagnostics pass (M5 §6 ``closest_candidates``)
  and by the test suite's independent verifier; and
* as CP-SAT structure added in :mod:`app.model` for the constraints that couple
  several decision variables (overlap, rest, weekly caps, consecutive days).

Keeping the predicate as the single definition is what stops the solver and the
explanation disagreeing about the same shift (TECH_STACK §7).

All times are integer minutes since the Unix epoch (UTC), so overlap, rest and
duration are real elapsed time — correct across midnight and across DST.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence

from . import slugs
from .context import LEVEL_RANK, Context, Person, Position

# A check returns the blocking slug, or None when the person passes.
Check = Callable[[Context, Person, Position, Sequence[Position]], "str | None"]


# --------------------------------------------------------------------------- #
# Static checks — depend only on the (person, position) pair
# --------------------------------------------------------------------------- #


def check_excluded(
    ctx: Context, person: Person, position: Position, assigned: Sequence[Position]
) -> str | None:
    """H12 — manager-blocked person↔position pairs must not occur."""
    if (position.id, person.id) in ctx.excluded:
        return slugs.EXCLUDED
    return None


def check_active(
    ctx: Context, person: Person, position: Position, assigned: Sequence[Position]
) -> str | None:
    """H13 — deactivated people are never assigned.

    Reported as ``role``: from the manager's point of view an inactive person is
    simply not part of the roster, and the closed vocabulary has no slug of its
    own for it.
    """
    if not person.active:
        return slugs.ROLE
    return None


def check_role(
    ctx: Context, person: Person, position: Position, assigned: Sequence[Position]
) -> str | None:
    """H1 — a person may only fill a position whose role they hold."""
    if position.role_id not in person.roles:
        return slugs.ROLE
    return None


def check_location(
    ctx: Context, person: Person, position: Position, assigned: Sequence[Position]
) -> str | None:
    """H9 — home location only, unless ``can_work_other_locations``."""
    if person.can_work_other_locations:
        return None
    if person.location_id is None:
        return None  # no home location recorded ⇒ not location-restricted
    if person.location_id != position.location_id:
        return slugs.LOCATION
    return None


def check_required_level(
    ctx: Context, person: Person, position: Position, assigned: Sequence[Position]
) -> str | None:
    """H10 — a position's ``required_level`` is a *minimum*.

    A senior may cover a slot that requires a junior; the reverse is blocked.
    An unrecognised level never qualifies.
    """
    if position.required_level is None:
        return None
    need = LEVEL_RANK.get(position.required_level)
    if need is None:
        return None  # unknown level in the request ⇒ treated as no requirement
    have = LEVEL_RANK.get(person.level or "")
    if have is None or have < need:
        return slugs.REQUIRED_LEVEL
    return None


def check_availability(
    ctx: Context, person: Person, position: Position, assigned: Sequence[Position]
) -> str | None:
    """H2 — available for the *whole* position window.

    Windows arrive pre-resolved from the app's single availability resolver
    (M3 §6); they are merged in :mod:`app.context`, so a window the app split at
    midnight still covers an overnight shift.
    """
    for window in person.availability:
        if window.covers(position.start, position.end):
            return None
    return slugs.AVAILABILITY


# --------------------------------------------------------------------------- #
# Dynamic checks — depend on what else the person is already working
# --------------------------------------------------------------------------- #


def check_one_shift_per_day(
    ctx: Context, person: Person, position: Position, assigned: Sequence[Position]
) -> str | None:
    """H8 — one shift per day, when enabled.

    An overnight position is anchored to its start date (M5 §10), which is the
    ``day_index`` computed in :mod:`app.context`.
    """
    if not ctx.rules.one_shift_per_day:
        return None
    for other in assigned:
        if other.day_index == position.day_index:
            return slugs.ONE_SHIFT_PER_DAY
    return None


def check_overlap(
    ctx: Context, person: Person, position: Position, assigned: Sequence[Position]
) -> str | None:
    """H3 — never in two positions whose times overlap.

    Epoch-minute comparison, so this holds across midnight and across locations.
    """
    for other in assigned:
        if position.start < other.end and other.start < position.end:
            return slugs.OVERLAP
    return None


def check_min_rest(
    ctx: Context, person: Person, position: Position, assigned: Sequence[Position]
) -> str | None:
    """H7 — at least N hours between the end of one shift and the start of the
    next. This is what prevents a close-then-open."""
    if ctx.rules.min_rest_hours is None:
        return None
    min_rest = round(ctx.rules.min_rest_hours * 60)
    if min_rest <= 0:
        return None
    for other in assigned:
        if position.start < other.end and other.start < position.end:
            continue  # already an overlap; H3 reports that
        gap = (
            position.start - other.end
            if position.start >= other.end
            else other.start - position.end
        )
        if gap < min_rest:
            return slugs.MIN_REST_HOURS
    return None


def check_max_shifts_week(
    ctx: Context, person: Person, position: Position, assigned: Sequence[Position]
) -> str | None:
    """H5 — max shifts per week, if set for that person."""
    if person.max_shifts_week is None:
        return None
    count = sum(1 for o in assigned if o.week_index == position.week_index)
    if count + 1 > person.max_shifts_week:
        return slugs.MAX_SHIFTS_WEEK
    return None


def check_max_hours_week(
    ctx: Context, person: Person, position: Position, assigned: Sequence[Position]
) -> str | None:
    """H4 — max hours per rostered week.

    Break time is excluded by construction: the contract's positions carry no
    break, so a position's duration *is* its paid time. If breaks are ever added
    to the wire format, subtract them in ``Position.duration_min`` only.
    """
    if person.max_hours_week is None:
        return None
    cap = round(person.max_hours_week * 60)
    used = sum(o.duration_min for o in assigned if o.week_index == position.week_index)
    if used + position.duration_min > cap:
        return slugs.MAX_HOURS_WEEK
    return None


def _longest_run_containing(days: set[int], day: int) -> int:
    """Length of the consecutive-day run through ``day`` in ``days``."""
    length = 1
    d = day - 1
    while d in days:
        length += 1
        d -= 1
    d = day + 1
    while d in days:
        length += 1
        d += 1
    return length


def check_max_consecutive_days(
    ctx: Context, person: Person, position: Position, assigned: Sequence[Position]
) -> str | None:
    """H6 — no run of worked days longer than the configured limit.

    Evaluated over the roster period; the previous roster is a soft consistency
    signal only (M5 §4), not a source of hard history.
    """
    limit = ctx.rules.max_consecutive_days
    if limit is None or limit <= 0:
        return None
    days = {o.day_index for o in assigned}
    days.add(position.day_index)
    if _longest_run_containing(days, position.day_index) > limit:
        return slugs.MAX_CONSECUTIVE_DAYS
    return None


# --------------------------------------------------------------------------- #
# Ordered check lists
# --------------------------------------------------------------------------- #

# Order matters: diagnostics report the *first* failure, and the most
# explanatory facts (this person simply cannot do this job) come before the
# incidental ones (they ran out of hours this particular week).
STATIC_CHECKS: tuple[tuple[str, Check], ...] = (
    (slugs.EXCLUDED, check_excluded),
    (slugs.ROLE, check_active),
    (slugs.ROLE, check_role),
    (slugs.LOCATION, check_location),
    (slugs.REQUIRED_LEVEL, check_required_level),
    (slugs.AVAILABILITY, check_availability),
)

DYNAMIC_CHECKS: tuple[tuple[str, Check], ...] = (
    (slugs.ONE_SHIFT_PER_DAY, check_one_shift_per_day),
    (slugs.OVERLAP, check_overlap),
    (slugs.MIN_REST_HOURS, check_min_rest),
    (slugs.MAX_SHIFTS_WEEK, check_max_shifts_week),
    (slugs.MAX_HOURS_WEEK, check_max_hours_week),
    (slugs.MAX_CONSECUTIVE_DAYS, check_max_consecutive_days),
)

ALL_CHECKS: tuple[tuple[str, Check], ...] = STATIC_CHECKS + DYNAMIC_CHECKS

# The "capability" gate: failing any of these means the person could never fill
# this position regardless of how the week is arranged.
CAPABILITY_SLUGS: frozenset[str] = frozenset(
    {slugs.EXCLUDED, slugs.ROLE, slugs.LOCATION, slugs.REQUIRED_LEVEL}
)

_NO_ASSIGNMENTS: tuple[Position, ...] = ()


def static_block(ctx: Context, person: Person, position: Position) -> str | None:
    """First failing static check, or None if the pair is statically feasible."""
    for _slug, check in STATIC_CHECKS:
        blocked = check(ctx, person, position, _NO_ASSIGNMENTS)
        if blocked is not None:
            return blocked
    return None


def first_block(
    ctx: Context,
    person: Person,
    position: Position,
    assigned: Sequence[Position] = _NO_ASSIGNMENTS,
) -> str | None:
    """First failing hard constraint across the full ordered check list.

    Diagnostic only — this never relaxes a rule (M5 §6).
    """
    for _slug, check in ALL_CHECKS:
        blocked = check(ctx, person, position, assigned)
        if blocked is not None:
            return blocked
    return None


def check_index(slug: str) -> int:
    """How far through the check list a person got — higher means closer."""
    for i, (name, _check) in enumerate(ALL_CHECKS):
        if name == slug:
            return i
    return -1


def candidates_for(ctx: Context, position: Position) -> list[Person]:
    """Statically feasible people for a position, in stable request order."""
    return [p for p in ctx.people if static_block(ctx, p, position) is None]


def position_length_ok(ctx: Context, position: Position) -> bool:
    """H14 — min/max shift length.

    Positions breaching these are rejected at template time (M4). The solver
    does not silently fix them: it refuses to staff such a position and reports
    it as unfilled with an explanatory detail.
    """
    hours = position.duration_min / 60.0
    if ctx.rules.max_shift_hours is not None and hours > ctx.rules.max_shift_hours:
        return False
    if ctx.rules.min_shift_hours is not None and hours < ctx.rules.min_shift_hours:
        return False
    return True


def conflicting_position_pairs(ctx: Context) -> list[tuple[int, int]]:
    """Position index pairs that no single person may hold together (H3 + H7).

    Only genuinely conflicting pairs are returned, so the model stays small:
    positions on distant days never produce a constraint.
    """
    min_rest = (
        0
        if ctx.rules.min_rest_hours is None
        else max(0, round(ctx.rules.min_rest_hours * 60))
    )
    ordered = sorted(ctx.positions, key=lambda p: (p.start, p.end, p.idx))
    pairs: list[tuple[int, int]] = []
    for i, a in enumerate(ordered):
        for b in ordered[i + 1 :]:
            if b.start >= a.end + min_rest and b.start >= a.end:
                # Sorted by start: every later position is further away still.
                break
            if a.start < b.end and b.start < a.end:
                pairs.append((min(a.idx, b.idx), max(a.idx, b.idx)))
                continue
            gap = b.start - a.end if b.start >= a.end else a.start - b.end
            if gap < min_rest:
                pairs.append((min(a.idx, b.idx), max(a.idx, b.idx)))
    return sorted(set(pairs))


# --------------------------------------------------------------------------- #
# Independent verifier (used by the test suite and as a safety net)
# --------------------------------------------------------------------------- #


def verify_assignments(ctx: Context, assignments: Iterable[dict]) -> list[str]:
    """Re-check every hard constraint against a finished roster.

    Returns a list of human-readable violations; an empty list means the roster
    honours H1-H14. This deliberately re-derives everything from the response
    rather than trusting the model, so the tests prove the *output*, not the
    encoding.
    """
    violations: list[str] = []
    by_person: dict[str, list[Position]] = {}
    seen_positions: set[str] = set()

    for a in assignments:
        pid, uid = a["position_id"], a["user_id"]
        if pid in seen_positions:
            violations.append(f"position {pid} assigned more than once")
            continue
        seen_positions.add(pid)
        position = ctx.positions_by_id.get(pid)
        person = ctx.people_by_id.get(uid)
        if position is None:
            violations.append(f"unknown position {pid}")
            continue
        if person is None:
            violations.append(f"unknown person {uid}")
            continue
        by_person.setdefault(uid, []).append(position)

    for uid, positions in by_person.items():
        person = ctx.people_by_id[uid]
        for position in positions:
            others = [p for p in positions if p.idx != position.idx]
            blocked = first_block(ctx, person, position, others)
            if blocked is not None:
                violations.append(
                    f"{uid} on {position.id}: violates {blocked}"
                )
            if not position_length_ok(ctx, position):
                violations.append(
                    f"{position.id}: breaches min/max shift length (H14)"
                )

    # H11 — every lock that was honoured must hold exactly, and a locked
    # position must never be given to somebody else.
    assigned_by_position = {a["position_id"]: a["user_id"] for a in assignments}
    for position_id, user_id in ctx.locked.items():
        actual = assigned_by_position.get(position_id)
        if actual is not None and actual != user_id:
            violations.append(
                f"locked position {position_id} assigned to {actual}, not {user_id}"
            )

    return violations
