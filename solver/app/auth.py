"""Shared-secret authentication for the solver service.

A CP-SAT solve is expensive, so a publicly reachable endpoint is a
cost-amplification target: anyone who learns the URL can burn compute. The app
never calls this service from the browser — it goes through a server-side proxy
(``src/app/api/solve/route.ts``) which authenticates the manager and then adds
the shared secret below.

Configuration is deliberately fail-safe in both directions:

* ``SOLVER_SHARED_SECRET`` set   → every request must present a matching
  ``X-Solver-Key`` header, or it is refused.
* ``SOLVER_SHARED_SECRET`` unset → authentication is DISABLED, and a warning is
  logged. This keeps local development and the test suite frictionless, but it
  must never be the state of a deployed service.
"""

from __future__ import annotations

import hmac
import logging
import os

logger = logging.getLogger(__name__)

HEADER = "X-Solver-Key"


def expected_secret() -> str | None:
    """The configured secret, or None when authentication is switched off."""
    value = os.environ.get("SOLVER_SHARED_SECRET", "").strip()
    return value or None


def is_authorised(presented: str | None) -> bool:
    """True when the caller may use the solver.

    Compared with :func:`hmac.compare_digest` so a wrong key cannot be
    discovered a character at a time by timing the response.
    """
    secret = expected_secret()
    if secret is None:
        logger.warning(
            "SOLVER_SHARED_SECRET is not set — the solver is accepting "
            "unauthenticated requests. Never deploy in this state."
        )
        return True
    if not presented:
        return False
    return hmac.compare_digest(presented, secret)


def unauthorised_body() -> dict[str, str]:
    """A deliberately terse refusal: it reveals nothing about the service."""
    return {"error": "unauthorised"}
