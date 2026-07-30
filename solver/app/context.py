"""Request parsing and the immutable solve context.

Everything time-related is normalised to **integer minutes since the Unix epoch
in UTC** here, once, so the rest of the solver reasons about real elapsed time.
This is what makes overlap, minimum-rest and DST all correct: a shift spanning
the spring-forward boundary is genuinely 7 hours, not "8 on the clock".

Business-local wall-clock strings (availability, open hours) are localised with
``zoneinfo`` using the roster timezone, so the correct DST offset is chosen for
each date. Positions arrive as ISO-8601 with an explicit offset and are simply
converted to UTC.

Availability arrives **pre-resolved** by the app (M3 §6); we never re-derive
pattern/exception logic here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date as date_cls
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

# Ordinal ranking for staff levels; ``required_level`` is treated as a *minimum*
# (a senior may cover a junior slot). Documented in constraints.check_required_level.
LEVEL_RANK: dict[str, int] = {"junior": 1, "mid": 2, "senior": 3}


def _to_epoch_min(dt: datetime) -> int:
    """Return whole minutes between ``dt`` and the Unix epoch (UTC)."""
    return round((dt.astimezone(timezone.utc) - _EPOCH).total_seconds() / 60)


def _parse_iso(value: str, tz: ZoneInfo) -> int:
    """Parse an ISO-8601 position timestamp to epoch minutes.

    Accepts a trailing ``Z`` and offset-aware strings. A naive string (no
    offset) is interpreted in the business timezone.
    """
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=tz)
    return _to_epoch_min(dt)


def _parse_wall(date_str: str, hhmm: str, tz: ZoneInfo) -> int:
    """Parse a business-local ``YYYY-MM-DD`` + ``HH:MM`` to epoch minutes."""
    y, m, d = (int(p) for p in date_str.split("-"))
    hh, mm = (int(p) for p in hhmm.split(":"))
    local = datetime(y, m, d, hh, mm, tzinfo=tz)
    return _to_epoch_min(local)


def _next_day(date_str: str) -> str:
    """The calendar date after ``date_str``."""
    return (date_cls.fromisoformat(date_str) + timedelta(days=1)).isoformat()


def _local_hhmm(epoch_min: int, tz: ZoneInfo) -> str:
    dt = (_EPOCH + timedelta(minutes=epoch_min)).astimezone(tz)
    return dt.strftime("%H:%M")


def _local_date(epoch_min: int, tz: ZoneInfo) -> str:
    dt = (_EPOCH + timedelta(minutes=epoch_min)).astimezone(tz)
    return dt.strftime("%Y-%m-%d")


def _local_weekday_sun0(epoch_min: int, tz: ZoneInfo) -> int:
    """Weekday with 0=Sunday..6=Saturday (the contract's convention)."""
    dt = (_EPOCH + timedelta(minutes=epoch_min)).astimezone(tz)
    return dt.isoweekday() % 7  # isoweekday: Mon=1..Sun=7 → Sun=0


# --------------------------------------------------------------------------- #
# Value objects
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class Interval:
    """A half-open-ish [start, end] window in epoch minutes (inclusive end)."""

    start: int
    end: int

    def covers(self, s: int, e: int) -> bool:
        return self.start <= s and self.end >= e

    def overlaps(self, other: "Interval") -> bool:
        return self.start < other.end and other.start < self.end


@dataclass(frozen=True)
class Position:
    id: str
    date: str  # anchor calendar date (business local), from the request
    location_id: str
    role_id: str
    # Human labels for diagnostics ONLY (M5 §6). Optional so an older caller
    # still works; they fall back to the ids. A manager cannot act on a UUID —
    # "Nobody can work 00000000-…-c1" is a bug, not a staffing message.
    role_name: str | None
    location_name: str | None
    required_level: str | None
    start: int  # epoch minutes (UTC)
    end: int  # epoch minutes (UTC)
    day_index: int  # 0-based day within the roster period (by anchor date)
    week_index: int  # 0-based week within the roster period
    weekday: int  # 0=Sun..6=Sat, local
    idx: int  # position in the ordered positions list

    @property
    def role_label(self) -> str:
        """Human role name when the caller supplied one, else the raw id."""
        return self.role_name or self.role_id

    @property
    def location_label(self) -> str:
        return self.location_name or self.location_id

    @property
    def duration_min(self) -> int:
        return self.end - self.start


@dataclass(frozen=True)
class Person:
    id: str
    roles: frozenset[str]
    level: str | None
    location_id: str | None
    can_work_other_locations: bool
    pay_rate: float
    max_hours_week: float | None
    min_hours_week: float
    max_shifts_week: int | None
    active: bool
    availability: tuple[Interval, ...]
    preferred_days: frozenset[int]
    preferred_time: str
    idx: int


@dataclass(frozen=True)
class SeniorCoverage:
    enabled: bool
    min_count: int
    qualifying_levels: frozenset[str]
    open_windows: tuple[Interval, ...]  # in epoch minutes


@dataclass(frozen=True)
class Rules:
    senior_coverage: SeniorCoverage
    max_consecutive_days: int | None
    min_rest_hours: float | None
    max_shift_hours: float | None
    min_shift_hours: float | None
    one_shift_per_day: bool


@dataclass(frozen=True)
class Context:
    tz: ZoneInfo
    start_date: date_cls
    days: int
    positions: tuple[Position, ...]
    people: tuple[Person, ...]
    rules: Rules
    locked: dict[str, str]  # position_id -> user_id (H11)
    excluded: frozenset[tuple[str, str]]  # (position_id, user_id) pairs (H12)
    objective_priority: tuple[str, ...]
    prev_person_weekdays: dict[str, frozenset[int]]  # user_id -> weekdays worked
    time_limit_seconds: float
    seed: int
    block_minutes: int = 15

    # Convenience lookups (populated in build_context).
    positions_by_id: dict[str, Position] = field(default_factory=dict)
    people_by_id: dict[str, Person] = field(default_factory=dict)

    def local_hhmm(self, epoch_min: int) -> str:
        return _local_hhmm(epoch_min, self.tz)

    def local_date(self, epoch_min: int) -> str:
        return _local_date(epoch_min, self.tz)


# --------------------------------------------------------------------------- #
# Builder
# --------------------------------------------------------------------------- #


def _merge_intervals(raw: list[Interval]) -> tuple[Interval, ...]:
    """Merge overlapping/adjacent availability windows so coverage checks are
    robust to windows the app split across midnight."""
    if not raw:
        return ()
    ordered = sorted(raw, key=lambda iv: (iv.start, iv.end))
    merged: list[Interval] = [ordered[0]]
    for iv in ordered[1:]:
        last = merged[-1]
        if iv.start <= last.end:  # overlapping or touching
            merged[-1] = Interval(last.start, max(last.end, iv.end))
        else:
            merged.append(iv)
    return tuple(merged)


# "23:59" is the universal end-of-day sentinel in availability data. Taken
# literally it leaves a one-minute hole at midnight, which would wrongly rule
# somebody out of an overnight shift and would stop two consecutive all-day
# windows merging into one continuous run. Treat it as midnight.
_END_OF_DAY = "23:59"


def _window_bounds(date_str: str, from_hhmm: str, to_hhmm: str, tz: ZoneInfo) -> Interval:
    """Resolve a business-local window, rolling past midnight where needed.

    The end is resolved against the **next calendar date**, not by adding 1440
    minutes, so a window spanning a DST change is the real elapsed 7 or 9 hours
    (M5 §10) rather than always 8.
    """
    start = _parse_wall(date_str, from_hhmm, tz)
    if to_hhmm == _END_OF_DAY:
        end = _parse_wall(_next_day(date_str), "00:00", tz)
    else:
        end = _parse_wall(date_str, to_hhmm, tz)
        if end <= start:  # overnight / 24-hour day → one continuous run
            end = _parse_wall(_next_day(date_str), to_hhmm, tz)
    return Interval(start, end)


def _availability_intervals(entries: list[dict], tz: ZoneInfo) -> tuple[Interval, ...]:
    raw = [
        _window_bounds(a["date"], a["from"], a["to"], tz) for a in entries or []
    ]
    return _merge_intervals(raw)


def _open_windows(entries: list[dict], tz: ZoneInfo) -> tuple[Interval, ...]:
    return tuple(
        _window_bounds(o["date"], o["from"], o["to"], tz) for o in entries or []
    )


def build_context(request: dict) -> Context:
    """Parse a raw request dict into an immutable :class:`Context`.

    Raises ``KeyError`` / ``ValueError`` on malformed input; the orchestrator
    turns those into a ``failed`` response.
    """
    roster = request["roster"]
    tz = ZoneInfo(roster.get("timezone", "Australia/Sydney"))
    start_date = date_cls.fromisoformat(roster["start_date"])
    days = int(roster["days"])

    # --- positions -------------------------------------------------------- #
    positions: list[Position] = []
    for i, p in enumerate(request.get("positions", [])):
        start = _parse_iso(p["start"], tz)
        end = _parse_iso(p["end"], tz)
        anchor = date_cls.fromisoformat(p["date"])
        day_index = (anchor - start_date).days
        positions.append(
            Position(
                id=p["id"],
                date=p["date"],
                location_id=p["location_id"],
                role_id=p["role_id"],
                role_name=p.get("role_name"),
                location_name=p.get("location_name"),
                required_level=p.get("required_level"),
                start=start,
                end=end,
                day_index=day_index,
                week_index=day_index // 7,
                weekday=_local_weekday_sun0(start, tz),
                idx=i,
            )
        )

    # --- people ----------------------------------------------------------- #
    people: list[Person] = []
    for i, u in enumerate(request.get("people", [])):
        people.append(
            Person(
                id=u["id"],
                roles=frozenset(u.get("roles", [])),
                level=u.get("level"),
                location_id=u.get("location_id"),
                can_work_other_locations=bool(u.get("can_work_other_locations", False)),
                pay_rate=float(u.get("pay_rate", 0.0)),
                max_hours_week=(
                    None
                    if u.get("max_hours_week") is None
                    else float(u["max_hours_week"])
                ),
                min_hours_week=float(u.get("min_hours_week", 0) or 0),
                max_shifts_week=(
                    None
                    if u.get("max_shifts_week") is None
                    else int(u["max_shifts_week"])
                ),
                # H13: default active; the app may omit the flag for active staff.
                active=bool(u.get("active", True)),
                availability=_availability_intervals(u.get("availability", []), tz),
                preferred_days=frozenset(int(d) for d in u.get("preferred_days", [])),
                preferred_time=u.get("preferred_time", "no_preference"),
                idx=i,
            )
        )

    # --- rules ------------------------------------------------------------ #
    rules_in = request.get("rules", {})
    sc_in = rules_in.get("senior_coverage", {}) or {}
    senior = SeniorCoverage(
        enabled=bool(sc_in.get("enabled", False)),
        min_count=int(sc_in.get("min_count", 1)),
        qualifying_levels=frozenset(sc_in.get("qualifying_levels", ["senior"])),
        open_windows=_open_windows(sc_in.get("open_hours", []), tz),
    )
    rules = Rules(
        senior_coverage=senior,
        max_consecutive_days=(
            None
            if rules_in.get("max_consecutive_days") is None
            else int(rules_in["max_consecutive_days"])
        ),
        min_rest_hours=(
            None
            if rules_in.get("min_rest_hours") is None
            else float(rules_in["min_rest_hours"])
        ),
        max_shift_hours=(
            None
            if rules_in.get("max_shift_hours") is None
            else float(rules_in["max_shift_hours"])
        ),
        min_shift_hours=(
            None
            if rules_in.get("min_shift_hours") is None
            else float(rules_in["min_shift_hours"])
        ),
        one_shift_per_day=bool(rules_in.get("one_shift_per_day", False)),
    )

    locked = {
        lk["position_id"]: lk["user_id"] for lk in request.get("locked", []) or []
    }
    excluded = frozenset(
        (ex["position_id"], ex["user_id"]) for ex in request.get("excluded", []) or []
    )

    # Previous roster reduced to which weekdays each person worked (consistency).
    prev: dict[str, set[int]] = {}
    for entry in request.get("previous_roster", []) or []:
        uid = entry["user_id"]
        wd = _local_weekday_sun0(_parse_iso(entry["start"], tz), tz)
        prev.setdefault(uid, set()).add(wd)
    prev_person_weekdays = {k: frozenset(v) for k, v in prev.items()}

    ctx = Context(
        tz=tz,
        start_date=start_date,
        days=days,
        positions=tuple(positions),
        people=tuple(people),
        rules=rules,
        locked=locked,
        excluded=excluded,
        objective_priority=tuple(request.get("objective_priority", [])),
        prev_person_weekdays=prev_person_weekdays,
        time_limit_seconds=float(request.get("time_limit_seconds", 15)),
        seed=int(request.get("seed", 42)),
    )
    ctx.positions_by_id.update({p.id: p for p in positions})
    ctx.people_by_id.update({u.id: u for u in people})
    return ctx
