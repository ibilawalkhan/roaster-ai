"""AWS Lambda entry point (container image — TECH_STACK §3.3).

Accepts either a direct invocation (the request object as the event) or an API
Gateway / Function URL proxy event (the request in ``event["body"]``), and
answers in the matching shape. Both paths call the same :func:`app.solve.solve`
as the Flask server, so there is exactly one implementation of the contract.
"""

from __future__ import annotations

import base64
import json
from typing import Any

from .auth import HEADER as AUTH_HEADER, is_authorised, unauthorised_body
from .solve import solve


def _presented_key(event: dict) -> str | None:
    """Read the shared-secret header, case-insensitively.

    API Gateway and Function URLs lowercase header names; a direct console test
    invocation might not. Matching case-sensitively would refuse legitimate
    traffic depending on how it arrived.
    """
    headers = event.get("headers") or {}
    if not isinstance(headers, dict):
        return None
    wanted = AUTH_HEADER.lower()
    for name, value in headers.items():
        if isinstance(name, str) and name.lower() == wanted:
            return value if isinstance(value, str) else None
    return None


def _is_proxy_event(event: dict) -> bool:
    return "body" in event and (
        "requestContext" in event or "httpMethod" in event or "headers" in event
    )


def _read_body(event: dict) -> dict:
    body = event.get("body")
    if body is None:
        return {}
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8")
    if isinstance(body, (str, bytes)):
        return json.loads(body)
    return body


def handler(event: Any, context: Any = None) -> dict[str, Any]:
    """Lambda entry point."""
    if not isinstance(event, dict):
        return {"status": "failed", "diagnostics": {"error": "malformed request"}}

    if not _is_proxy_event(event):
        # Direct invocation: the event *is* the solver request. Reaching Lambda
        # directly already requires AWS IAM credentials, so the shared secret —
        # which exists to guard a public HTTP URL — is not additionally required
        # here. This is the path the test suite and `aws lambda invoke` use.
        return solve(event)

    # Anything arriving over HTTP (Function URL / API Gateway) is public-facing
    # and must present the shared secret.
    if not is_authorised(_presented_key(event)):
        return {
            "statusCode": 401,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(unauthorised_body()),
        }

    try:
        payload = _read_body(event)
    except (ValueError, TypeError) as exc:
        payload = None
        parse_error = f"malformed request: {exc}"
    else:
        parse_error = None

    if parse_error is not None or not isinstance(payload, dict):
        return {
            "statusCode": 400,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(
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
                        "error": parse_error
                        or "malformed request: body must be a JSON object",
                    },
                }
            ),
        }

    response = solve(payload)
    return {
        "statusCode": 400 if response["status"] == "failed" else 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(response),
    }
