"""Flask entry point — ``POST /solve`` for local and dev use.

Deliberately thin: parse JSON, hand it to :func:`app.solve.solve`, serialise the
result. All behaviour lives in the solver so the HTTP and Lambda entry points
cannot drift apart.
"""

from __future__ import annotations

import os
from typing import Any

from flask import Flask, jsonify, request

from .solve import solve

app = Flask(__name__)


@app.get("/health")
def health() -> Any:
    """Liveness probe — no solving, no dependencies."""
    return jsonify({"status": "ok"})


@app.post("/solve")
def solve_endpoint() -> Any:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        # Mirrors the solver's own failure envelope so the app has one shape to
        # handle whatever went wrong.
        return (
            jsonify(
                {
                    "status": "failed",
                    "assignments": [],
                    "unfilled": [],
                    "coverage_gaps": [],
                    "stats": {
                        "positions": 0,
                        "filled": 0,
                        "hours": 0.0,
                        "estimated_cost": 0.0,
                        "solve_seconds": 0.0,
                        "hours_by_person": {},
                    },
                    "diagnostics": {
                        "objective_value": 0,
                        "seed": 0,
                        "time_limit_hit": False,
                        "error": "malformed request: body must be a JSON object",
                    },
                }
            ),
            400,
        )

    response = solve(payload)
    return jsonify(response), (400 if response["status"] == "failed" else 200)


def main() -> None:
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))


if __name__ == "__main__":
    main()
