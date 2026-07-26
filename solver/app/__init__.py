"""Rosterly Module 5 — auto-scheduler service (Python + OR-Tools CP-SAT).

A stateless solver that turns demand (positions) plus supply (people, rules)
into a valid draft roster. Hard constraints H1-H14 are never violated; demand is
soft (penalised shortfall) so the solve always returns a roster. See
docs/SOLVER_CONTRACT.md (frozen v1) and updated_requirements/MODULE_05.
"""

from .solve import solve

__all__ = ["solve"]
