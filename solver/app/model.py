"""The CP-SAT model (MODULE_05 §5).

Decision variable ``x[person][position] ∈ {0,1}``. Two design choices carry the
whole module:

**Demand is soft.** Every position gets a penalised ``shortfall`` variable and
the balance constraint ``sum(x over people) + shortfall == 1``. Setting every
shortfall to 1 and every ``x`` to 0 is therefore always a feasible point, so the
solve *always returns a roster* — a short-staffed week comes back ``partial``
with explained gaps rather than infeasible (M5 §5.2).

**Senior coverage is a timeline constraint, not a per-shift one** (M5 §5.3).
Open hours are discretised into 15-minute blocks; each block requires
``min_count`` qualifying people on duty, with a penalised slack variable so an
uncovered window surfaces in ``coverage_gaps`` instead of failing the solve.

Safety and legality (H1-H14) stay hard. Nothing in the objective can buy a
violation.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ortools.sat.python import cp_model

from . import constraints, slugs
from .context import Context, Position

# --------------------------------------------------------------------------- #
# Objective weights
# --------------------------------------------------------------------------- #

# "Very high" penalties. An unfilled position costs more than any amount of
# unfairness, cost or preference-missing, so the solver never leaves work
# undone to look tidier.
W_UNFILLED = 1_000_000
W_SENIOR_GAP_BLOCK = 100_000  # per 15-min block, per missing head
W_BELOW_MIN_HOURS = 50  # per minute short of a guaranteed minimum ("medium")

# Base scales for the manager-rankable priorities. Multiplied by the rank
# multiplier below; the manager only ever sees plain-language ordering (M5 §5.2).
#
# The scales are chosen so that a *typical week's* worth of each term lands in
# the same order of magnitude — a few thousand units. The manager's ranking then
# genuinely decides the trade-off, rather than one unit of measure (dollars vs
# minutes) quietly dominating the others. All of them stay far below
# W_UNFILLED, so no combination of them ever buys leaving work undone.
BASE_SCALE: dict[str, int] = {
    "fairness": 1,  # per minute of spread between the busiest and quietest
    "cost": 1,  # per whole dollar of estimated labour cost
    "preferences": 50,  # per assignment outside a stated preference
    "consistency": 30,  # per assignment that breaks the previous pattern
}

# Rank 0 (most important) down to rank 3+; anything unranked keeps weight 1.
RANK_MULTIPLIERS: tuple[int, ...] = (8, 4, 2, 1)

# Granularity of the two numeric soft terms. Measuring workload to the minute
# and cost to the dollar gives CP-SAT an enormous lattice of near-identical
# objective values, and it spends the whole time budget proving that one of them
# is optimal: at target scale that was ~13s versus ~1.7s for the same roster.
# Half-hours and ten-dollar steps are well inside the noise of an *estimate*
# (costs are never payroll) and make the proof cheap. M5 §8 is explicit that
# "very good in seconds" beats "provably optimal in minutes".
FAIRNESS_UNIT_MINUTES = 30
COST_UNIT_DOLLARS = 10


def objective_weights(priority: tuple[str, ...]) -> dict[str, int]:
    """Derive integer weights from the business's ``objective_priority`` ranking."""
    weights: dict[str, int] = {}
    for name, scale in BASE_SCALE.items():
        if name in priority:
            rank = priority.index(name)
            multiplier = (
                RANK_MULTIPLIERS[rank]
                if rank < len(RANK_MULTIPLIERS)
                else RANK_MULTIPLIERS[-1]
            )
        else:
            multiplier = 1
        weights[name] = scale * multiplier
    return weights


def time_bucket(ctx: Context, position: Position) -> str:
    """Coarse time-of-day bucket for preference matching (M2 ``preferred_time``)."""
    hour = int(ctx.local_hhmm(position.start).split(":")[0])
    if 5 <= hour < 11:
        return "morning"
    if 11 <= hour < 17:
        return "afternoon"
    if 17 <= hour < 22:
        return "evening"
    return "night"


# --------------------------------------------------------------------------- #
# Coverage segments
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class CoverageSegment:
    """A contiguous run of blocks with an identical set of covering candidates.

    Grouping identical blocks keeps the model small and makes the reported gap
    windows naturally merged rather than a stutter of 15-minute rows.
    """

    start: int  # epoch minutes
    end: int  # epoch minutes
    blocks: int
    keys: tuple[tuple[int, int], ...]  # (person_idx, position_idx) pairs


def build_coverage_segments(
    ctx: Context, candidate_keys: set[tuple[int, int]]
) -> list[CoverageSegment]:
    """Discretise open hours into blocks and group them into segments.

    Overnight and 24-hour days are handled in :mod:`app.context`: the window's
    end is rolled past midnight, so ``22:00-06:00`` is one continuous run of
    blocks rather than two broken halves (M5 §5.3).
    """
    rule = ctx.rules.senior_coverage
    if not rule.enabled or rule.min_count <= 0:
        return []

    qualifying = {
        p.idx for p in ctx.people if (p.level or "") in rule.qualifying_levels
    }
    step = ctx.block_minutes
    segments: list[CoverageSegment] = []

    for window in sorted(rule.open_windows, key=lambda w: (w.start, w.end)):
        current_keys: tuple[tuple[int, int], ...] | None = None
        run_start = window.start
        run_blocks = 0
        t = window.start
        while t < window.end:
            block_end = min(t + step, window.end)
            keys = tuple(
                sorted(
                    (pi, si)
                    for (pi, si) in candidate_keys
                    if pi in qualifying
                    and ctx.positions[si].start <= t
                    and ctx.positions[si].end >= block_end
                )
            )
            if current_keys is None:
                current_keys, run_start, run_blocks = keys, t, 1
            elif keys == current_keys:
                run_blocks += 1
            else:
                segments.append(
                    CoverageSegment(run_start, t, run_blocks, current_keys)
                )
                current_keys, run_start, run_blocks = keys, t, 1
            t = block_end
        if current_keys is not None:
            segments.append(CoverageSegment(run_start, t, run_blocks, current_keys))

    return segments


# --------------------------------------------------------------------------- #
# Lock resolution (H11)
# --------------------------------------------------------------------------- #


def resolve_locks(ctx: Context) -> tuple[dict[int, int], dict[int, tuple[str, str]]]:
    """Split manager locks into those that can hold and those that cannot.

    A lock is the manager's explicit instruction, so it is applied as a hard
    equality. But a lock can go stale (M5 §10: the pinned person is later marked
    unavailable, or two locks collide). Forcing such a lock would make the model
    infeasible and return nothing, which is precisely the failure mode this
    module exists to avoid.

    So locks are validated first, in position order, against the same hard-
    constraint predicates. Surviving locks are mutually consistent by
    construction, which means the model is *provably* feasible. A rejected lock
    never causes someone else to be slotted into that position — the position is
    returned unfilled, naming the lock that conflicts.

    Returns ``(accepted, rejected)`` where accepted maps position index → person
    index, and rejected maps position index → (user_id, blocking slug).
    """
    accepted: dict[int, int] = {}
    rejected: dict[int, tuple[str, str]] = {}
    taken: dict[int, list[Position]] = {}  # person_idx -> positions already locked

    for position_id in sorted(
        ctx.locked,
        key=lambda pid: (
            ctx.positions_by_id[pid].idx if pid in ctx.positions_by_id else -1
        ),
    ):
        user_id = ctx.locked[position_id]
        position = ctx.positions_by_id.get(position_id)
        person = ctx.people_by_id.get(user_id)
        if position is None or person is None:
            continue  # unknown ids are surfaced by build_context validation
        if not constraints.position_length_ok(ctx, position):
            rejected[position.idx] = (user_id, slugs.NO_ELIGIBLE_PERSON)
            continue
        blocked = constraints.first_block(
            ctx, person, position, taken.get(person.idx, [])
        )
        if blocked is not None:
            rejected[position.idx] = (user_id, blocked)
            continue
        accepted[position.idx] = person.idx
        taken.setdefault(person.idx, []).append(position)

    return accepted, rejected


# --------------------------------------------------------------------------- #
# Greedy warm start
# --------------------------------------------------------------------------- #


def greedy_assignment(
    ctx: Context,
    candidates: dict[int, list[int]],
    accepted_locks: dict[int, int],
) -> dict[int, int]:
    """A fast, feasible roster used as a CP-SAT solution hint.

    The solver runs single-threaded so that results are reproducible (M5 §8),
    which costs it the portfolio search that would normally find a good
    incumbent quickly. At target scale that showed up as a 15-second timeout
    with ten positions still unfilled. Handing CP-SAT a decent starting point
    fixes that without giving up determinism.

    Deliberately built from :mod:`app.constraints` predicates, so the hint is
    guaranteed to satisfy H1-H14 and cannot smuggle in an invalid pairing.
    Scarcest positions are filled first; ties go to the least-loaded person, then
    to request order, so the hint itself is deterministic.
    """
    assigned: dict[int, list[Position]] = {}
    result: dict[int, int] = {}

    for position_idx, person_idx in sorted(accepted_locks.items()):
        result[position_idx] = person_idx
        assigned.setdefault(person_idx, []).append(ctx.positions[position_idx])

    order = sorted(
        (
            p
            for p in ctx.positions
            if p.idx not in result and candidates.get(p.idx)
        ),
        key=lambda p: (len(candidates[p.idx]), p.start, p.idx),
    )

    for position in order:
        best: tuple[tuple[int, int], int] | None = None
        for person_idx in candidates[position.idx]:
            already = assigned.get(person_idx, ())
            if constraints.first_block(
                ctx, ctx.people[person_idx], position, already
            ) is not None:
                continue
            load = sum(o.duration_min for o in already)
            key = (load, person_idx)
            if best is None or key < best[0]:
                best = (key, person_idx)
        if best is not None:
            result[position.idx] = best[1]
            assigned.setdefault(best[1], []).append(position)

    return result


# --------------------------------------------------------------------------- #
# The model
# --------------------------------------------------------------------------- #


@dataclass
class BuiltModel:
    model: cp_model.CpModel
    x: dict[tuple[int, int], cp_model.IntVar]
    shortfall: dict[int, cp_model.IntVar]
    segments: list[CoverageSegment]
    gap_vars: list[cp_model.IntVar]
    candidates: dict[int, list[int]] = field(default_factory=dict)
    rejected_locks: dict[int, tuple[str, str]] = field(default_factory=dict)
    oversized: set[int] = field(default_factory=set)
    accepted_locks: dict[int, int] = field(default_factory=dict)


def build_model(ctx: Context) -> BuiltModel:
    """Assemble the CP-SAT model for one solve."""
    model = cp_model.CpModel()
    weights = objective_weights(ctx.objective_priority)

    accepted_locks, rejected_locks = resolve_locks(ctx)

    # --- candidate pairs (H1, H2, H9, H10, H12, H13 applied by pruning) ---- #
    oversized: set[int] = set()
    candidates: dict[int, list[int]] = {}
    for position in ctx.positions:
        if not constraints.position_length_ok(ctx, position):
            # H14 — refused, never silently fixed.
            oversized.add(position.idx)
            candidates[position.idx] = []
            continue
        if position.idx in rejected_locks:
            # The manager's pin cannot hold; nobody else may take this slot.
            candidates[position.idx] = []
            continue
        if position.idx in accepted_locks:
            candidates[position.idx] = [accepted_locks[position.idx]]
            continue
        candidates[position.idx] = [
            p.idx for p in constraints.candidates_for(ctx, position)
        ]

    x: dict[tuple[int, int], cp_model.IntVar] = {}
    for position_idx in sorted(candidates):
        for person_idx in candidates[position_idx]:
            x[(person_idx, position_idx)] = model.NewBoolVar(
                f"x_{person_idx}_{position_idx}"
            )

    # --- demand balance: soft, via a penalised shortfall (M5 §5.2) --------- #
    shortfall: dict[int, cp_model.IntVar] = {}
    for position in ctx.positions:
        var = model.NewBoolVar(f"shortfall_{position.idx}")
        shortfall[position.idx] = var
        assigned = [
            x[(pi, position.idx)] for pi in candidates.get(position.idx, [])
        ]
        # Exactly one of: somebody works it, or it is recorded as a shortfall.
        model.Add(sum(assigned) + var == 1)

    # --- H11: locks hold exactly ------------------------------------------ #
    for position_idx, person_idx in accepted_locks.items():
        model.Add(x[(person_idx, position_idx)] == 1)

    # --- H3 + H7: no overlap, and minimum rest between shifts -------------- #
    # Only genuinely conflicting pairs get a constraint. When one-shift-per-day
    # is on, the day-level AddAtMostOne below already subsumes every same-day
    # pair, and emitting both was measured to cost seconds at target scale.
    for a_idx, b_idx in constraints.conflicting_position_pairs(ctx):
        if (
            ctx.rules.one_shift_per_day
            and ctx.positions[a_idx].day_index == ctx.positions[b_idx].day_index
        ):
            continue
        for person in ctx.people:
            va = x.get((person.idx, a_idx))
            vb = x.get((person.idx, b_idx))
            if va is not None and vb is not None:
                model.AddAtMostOne([va, vb])

    # --- per-person day / week aggregates ---------------------------------- #
    positions_by_day: dict[int, list[Position]] = {}
    positions_by_week: dict[int, list[Position]] = {}
    for position in ctx.positions:
        positions_by_day.setdefault(position.day_index, []).append(position)
        positions_by_week.setdefault(position.week_index, []).append(position)

    hours_terms: dict[int, list[tuple[int, cp_model.IntVar]]] = {
        p.idx: [] for p in ctx.people
    }
    for (person_idx, position_idx), var in x.items():
        hours_terms[person_idx].append((ctx.positions[position_idx].duration_min, var))

    works_day: dict[tuple[int, int], cp_model.IntVar] = {}
    below_min_terms: list[cp_model.IntVar] = []

    for person in ctx.people:
        # H8 — one shift per day.
        if ctx.rules.one_shift_per_day:
            for day, day_positions in sorted(positions_by_day.items()):
                day_vars = [
                    x[(person.idx, p.idx)]
                    for p in day_positions
                    if (person.idx, p.idx) in x
                ]
                if len(day_vars) > 1:
                    model.AddAtMostOne(day_vars)

        for week, week_positions in sorted(positions_by_week.items()):
            week_vars = [
                x[(person.idx, p.idx)]
                for p in week_positions
                if (person.idx, p.idx) in x
            ]
            if not week_vars:
                continue
            # H5 — max shifts per week.
            if person.max_shifts_week is not None:
                model.Add(sum(week_vars) <= person.max_shifts_week)
            # H4 — max hours per week (break time excluded; see constraints.py).
            if person.max_hours_week is not None:
                model.Add(
                    sum(
                        ctx.positions[p.idx].duration_min * x[(person.idx, p.idx)]
                        for p in week_positions
                        if (person.idx, p.idx) in x
                    )
                    <= round(person.max_hours_week * 60)
                )
            # Soft: below a guaranteed weekly minimum is penalised, not forbidden.
            if person.min_hours_week > 0:
                target = round(person.min_hours_week * 60)
                deficit = model.NewIntVar(0, target, f"below_min_{person.idx}_{week}")
                model.Add(
                    sum(
                        ctx.positions[p.idx].duration_min * x[(person.idx, p.idx)]
                        for p in week_positions
                        if (person.idx, p.idx) in x
                    )
                    + deficit
                    >= target
                )
                below_min_terms.append(deficit)

        # H6 — max consecutive days, via day indicators and a sliding window.
        limit = ctx.rules.max_consecutive_days
        if limit is not None and limit > 0 and positions_by_day:
            for day, day_positions in sorted(positions_by_day.items()):
                day_vars = [
                    x[(person.idx, p.idx)]
                    for p in day_positions
                    if (person.idx, p.idx) in x
                ]
                if not day_vars:
                    continue
                indicator = model.NewBoolVar(f"works_{person.idx}_{day}")
                works_day[(person.idx, day)] = indicator
                # Only the "forced on when working" direction is needed: nothing
                # in the objective rewards the indicator, so it settles to 0.
                # Stated as implications rather than `indicator >= var`, which
                # presolve expands into one enforced linear constraint each.
                for var in day_vars:
                    model.AddImplication(var, indicator)
            all_days = sorted(positions_by_day)
            if all_days:
                lo, hi = all_days[0], all_days[-1]
                for start in range(lo, hi - limit + 1):
                    window = [
                        works_day[(person.idx, d)]
                        for d in range(start, start + limit + 1)
                        if (person.idx, d) in works_day
                    ]
                    if len(window) > limit:
                        model.Add(sum(window) <= limit)

    # Note on symmetry: the week template expands "3 cooks at 16:00" into three
    # identical positions, so a canonical-ordering constraint over those groups
    # looks like an obvious win. It was tried and measured, and it is a trap —
    # the rank variables it needs are dense linear equalities over every
    # candidate, and at target scale they took the solve from "optimal in ~10s"
    # to "no solution at all inside 15s". Left out deliberately.

    # --- senior coverage: penalised slack over 15-min blocks (M5 §5.3) ----- #
    segments = build_coverage_segments(ctx, set(x.keys()))
    gap_vars: list[cp_model.IntVar] = []
    min_count = ctx.rules.senior_coverage.min_count
    for i, segment in enumerate(segments):
        gap = model.NewIntVar(0, min_count, f"coverage_gap_{i}")
        gap_vars.append(gap)
        model.Add(sum(x[key] for key in segment.keys) + gap >= min_count)

    # --- objective --------------------------------------------------------- #
    terms: list[cp_model.LinearExpr] = []

    terms.append(W_UNFILLED * sum(shortfall.values()))

    for segment, gap in zip(segments, gap_vars):
        terms.append(W_SENIOR_GAP_BLOCK * segment.blocks * gap)

    if below_min_terms:
        terms.append(W_BELOW_MIN_HOURS * sum(below_min_terms))

    # Fairness — every person's deviation from an even share of the week.
    #
    # The share is a *constant* (total demand ÷ headcount), deliberately. The
    # obvious alternative, minimising the max-min spread, couples every person
    # to one shared pair of variables; measured on a 14-position/5-person week
    # that turned a 0.03s solve into a 10s timeout, because CP-SAT burns its
    # whole budget proving optimality over a huge lattice of near-equal
    # objectives. Summed deviations give the same "spread the hours" behaviour,
    # penalise everyone rather than only the extremes, and solve instantly.
    if weights["fairness"] and len(ctx.people) > 1:
        horizon = (
            sum(p.duration_min for p in ctx.positions) // FAIRNESS_UNIT_MINUTES
        ) or 1
        target = horizon // len(ctx.people)
        deviations: list[cp_model.IntVar] = []
        for person in ctx.people:
            expr = sum(
                (coeff // FAIRNESS_UNIT_MINUTES) * var
                for coeff, var in hours_terms[person.idx]
            )
            deviation = model.NewIntVar(0, horizon, f"fairness_dev_{person.idx}")
            model.Add(deviation >= expr - target)
            model.Add(deviation >= target - expr)
            deviations.append(deviation)
        terms.append(weights["fairness"] * sum(deviations))

    # Cost — estimated labour dollars. An ESTIMATE only, never payroll.
    if weights["cost"]:
        cost_terms = [
            (
                round(
                    ctx.people[person_idx].pay_rate
                    * ctx.positions[position_idx].duration_min
                    / 60.0
                    / COST_UNIT_DOLLARS
                ),
                var,
            )
            for (person_idx, position_idx), var in sorted(x.items())
        ]
        if cost_terms:
            terms.append(
                weights["cost"] * sum(coeff * var for coeff, var in cost_terms)
            )

    # Preferences — assigned outside preferred days or preferred time of day.
    if weights["preferences"]:
        pref_vars: list[cp_model.IntVar] = []
        for (person_idx, position_idx), var in sorted(x.items()):
            person = ctx.people[person_idx]
            position = ctx.positions[position_idx]
            miss = False
            if person.preferred_days and position.weekday not in person.preferred_days:
                miss = True
            if (
                person.preferred_time
                and person.preferred_time != "no_preference"
                and time_bucket(ctx, position) != person.preferred_time
            ):
                miss = True
            if miss:
                pref_vars.append(var)
        if pref_vars:
            terms.append(weights["preferences"] * sum(pref_vars))

    # Consistency — a different pattern from the previous roster.
    if weights["consistency"] and ctx.prev_person_weekdays:
        inconsistent: list[cp_model.IntVar] = []
        for (person_idx, position_idx), var in sorted(x.items()):
            person = ctx.people[person_idx]
            previous = ctx.prev_person_weekdays.get(person.id)
            if previous is not None and ctx.positions[position_idx].weekday not in previous:
                inconsistent.append(var)
        if inconsistent:
            terms.append(weights["consistency"] * sum(inconsistent))

    model.Minimize(sum(terms))

    # --- warm start -------------------------------------------------------- #
    hint = greedy_assignment(ctx, candidates, accepted_locks)
    for (person_idx, position_idx), var in sorted(x.items()):
        model.AddHint(var, 1 if hint.get(position_idx) == person_idx else 0)
    for position_idx, var in sorted(shortfall.items()):
        model.AddHint(var, 0 if position_idx in hint else 1)

    return BuiltModel(
        model=model,
        x=x,
        shortfall=shortfall,
        segments=segments,
        gap_vars=gap_vars,
        candidates=candidates,
        rejected_locks=rejected_locks,
        oversized=oversized,
        accepted_locks=accepted_locks,
    )
