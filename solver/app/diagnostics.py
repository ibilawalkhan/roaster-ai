"""Explaining the gaps (MODULE_05 §6).

> *A gap the manager can't understand is a bug in the product, not a staffing
> problem.*

For every unfilled position and every coverage gap we re-check each hard
constraint per person and report the first that failed, using the closed slug
vocabulary in :mod:`app.slugs`. This pass is **diagnostic only** — it never
relaxes a rule and never changes an assignment.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence

from . import constraints, slugs
from .context import Context, Interval, Person, Position
from .model import CoverageSegment

MAX_CLOSEST_CANDIDATES = 3


# --------------------------------------------------------------------------- #
# Sentence helpers (Australian English)
# --------------------------------------------------------------------------- #


def _people_count(n: int) -> str:
    return "1 person" if n == 1 else f"{n} people"


def _clause(n: int, label: str) -> str:
    """e.g. ``2 are at their weekly hour limit``."""
    verb = "is" if n == 1 else "are"
    return f"{n} {verb} {label}"


def _join(parts: Sequence[str]) -> str:
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    return ", ".join(parts[:-1]) + " and " + parts[-1]


def _blocked_summary(blocks: Counter[str]) -> str:
    """Group blocking slugs into a readable clause, most common first.

    Ties break on the check order so the sentence is deterministic.
    """
    ordered = sorted(
        blocks.items(), key=lambda kv: (-kv[1], constraints.check_index(kv[0]), kv[0])
    )
    return _join([_clause(count, slugs.SLUG_LABELS[slug]) for slug, count in ordered])


# --------------------------------------------------------------------------- #
# Unfilled positions
# --------------------------------------------------------------------------- #


def _blocks_for_position(
    ctx: Context,
    position: Position,
    assigned_by_person: dict[str, list[Position]],
) -> list[tuple[Person, str]]:
    """(person, first failing slug) for everyone who cannot fill this position.

    Dynamic checks run against the roster the solver actually produced, so
    "they're at their weekly hour limit" means it in *this* week, which is the
    fact the manager can act on.
    """
    out: list[tuple[Person, str]] = []
    for person in ctx.people:
        assigned = assigned_by_person.get(person.id, [])
        others = [p for p in assigned if p.idx != position.idx]
        blocked = constraints.first_block(ctx, person, position, others)
        if blocked is not None:
            out.append((person, blocked))
    return out


def explain_unfilled(
    ctx: Context,
    position: Position,
    assigned_by_person: dict[str, list[Position]],
    rejected_locks: dict[int, tuple[str, str]],
    oversized: set[int],
) -> dict:
    """Build one ``unfilled`` entry with ``reason``, ``detail`` and candidates."""
    entry: dict = {
        "position_id": position.id,
        "date": position.date,
        "role_id": position.role_id,
        "start": ctx.local_hhmm(position.start),
        "end": ctx.local_hhmm(position.end),
    }

    # H14 — the position itself breaches the shift-length rule (M4's job to fix).
    if position.idx in oversized:
        hours = position.duration_min / 60.0
        bounds: list[str] = []
        if ctx.rules.min_shift_hours is not None:
            bounds.append(f"min {ctx.rules.min_shift_hours:g}h")
        if ctx.rules.max_shift_hours is not None:
            bounds.append(f"max {ctx.rules.max_shift_hours:g}h")
        entry["reason"] = slugs.NO_ELIGIBLE_PERSON
        entry["detail"] = (
            f"This position is {hours:g}h, outside the allowed shift length "
            f"({_join(bounds)}). Fix it in the week template, not here."
        )
        entry["closest_candidates"] = []
        return entry

    # H11 — the manager's pin cannot hold. Nobody else was slotted in.
    if position.idx in rejected_locks:
        user_id, blocked = rejected_locks[position.idx]
        entry["reason"] = blocked
        entry["detail"] = (
            f"Locked to {user_id}, but they {slugs.SLUG_LABELS[blocked]}. "
            "Release the lock or pin someone else."
        )
        entry["closest_candidates"] = [{"user_id": user_id, "blocked_by": blocked}]
        return entry

    blocked_people = _blocks_for_position(ctx, position, assigned_by_person)
    capable = [
        (person, slug)
        for person, slug in blocked_people
        if slug not in constraints.CAPABILITY_SLUGS
    ]

    if not capable:
        entry["reason"] = slugs.NO_ELIGIBLE_PERSON
        entry["detail"] = (
            f"Nobody can work {position.role_label} at {position.location_label} — "
            "no active staff hold that role at that location with the required "
            "level."
        )
    else:
        counts = Counter(slug for _person, slug in capable)
        # The reason is the dominant blocker among people who *could* do the job.
        entry["reason"] = sorted(
            counts.items(),
            key=lambda kv: (-kv[1], constraints.check_index(kv[0]), kv[0]),
        )[0][0]
        entry["detail"] = (
            f"{_people_count(len(capable))} can work {position.role_label}; "
            f"{_blocked_summary(counts)}."
        )

    # Closest = got furthest through the ordered check list. Stable tie-break on
    # request order so the same input always names the same people.
    ranked = sorted(
        blocked_people,
        key=lambda pair: (-constraints.check_index(pair[1]), pair[0].idx),
    )
    entry["closest_candidates"] = [
        {"user_id": person.id, "blocked_by": slug}
        for person, slug in ranked[:MAX_CLOSEST_CANDIDATES]
    ]
    return entry


# --------------------------------------------------------------------------- #
# Senior coverage gaps
# --------------------------------------------------------------------------- #


def merge_gap_segments(
    segments: Sequence[CoverageSegment], gaps: Sequence[int]
) -> list[Interval]:
    """Merge touching segments that both have an uncovered slack value.

    A 30-minute hole should read as one 20:00-20:30 row, not two 15-minute ones.
    """
    windows: list[Interval] = []
    for segment, gap in zip(segments, gaps):
        if gap <= 0:
            continue
        if windows and windows[-1].end == segment.start:
            windows[-1] = Interval(windows[-1].start, segment.end)
        else:
            windows.append(Interval(segment.start, segment.end))
    return windows


def explain_coverage_gap(
    ctx: Context,
    window: Interval,
    assigned_by_person: dict[str, list[Position]],
) -> dict:
    """Build one ``coverage_gaps`` entry for an uncovered senior window."""
    rule = ctx.rules.senior_coverage
    levels = _join(sorted(rule.qualifying_levels)) or "senior"
    qualifying = [p for p in ctx.people if (p.level or "") in rule.qualifying_levels]

    # Which positions could have carried a senior through this window at all?
    covering = [
        p
        for p in ctx.positions
        if p.start <= window.start and p.end >= window.end
    ]

    if not qualifying:
        detail = (
            f"No {levels} staff exist for this business, so this window can "
            "never be covered. Promote or hire someone at that level."
        )
    elif not covering:
        detail = (
            f"No shift is rostered across this whole window, so no {levels} can "
            "be on duty for it. Add or extend a position in the week template."
        )
    else:
        blocks: Counter[str] = Counter()
        for person in qualifying:
            assigned = assigned_by_person.get(person.id, [])
            # The best case for this person across any covering position.
            best: str | None = None
            best_rank = -2
            for position in covering:
                others = [p for p in assigned if p.idx != position.idx]
                blocked = constraints.first_block(ctx, person, position, others)
                if blocked is None:
                    best, best_rank = None, 10_000
                    break
                rank = constraints.check_index(blocked)
                if rank > best_rank:
                    best, best_rank = blocked, rank
            if best is not None:
                blocks[best] += 1
        if blocks:
            detail = (
                f"No {levels} on duty. "
                f"{_people_count(len(qualifying))} qualify; "
                f"{_blocked_summary(blocks)}."
            )
        else:
            # Everyone was individually able — the shortfall is one of headcount
            # against min_count, or the covering shifts went to other roles.
            detail = (
                f"Fewer than {rule.min_count} {levels} could be rostered across "
                "this window with the positions available."
            )

    return {
        "date": ctx.local_date(window.start),
        "from": ctx.local_hhmm(window.start),
        "to": ctx.local_hhmm(window.end),
        "rule": "senior_coverage",
        "detail": detail,
    }
