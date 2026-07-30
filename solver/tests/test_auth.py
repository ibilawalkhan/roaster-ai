"""Shared-secret authentication (see app/auth.py).

The solver is expensive to run, so an unauthenticated public endpoint is a
cost-amplification target. These tests pin the behaviour in both configured and
unconfigured states.
"""

from __future__ import annotations

import json

import pytest

from app.auth import is_authorised
from app.lambda_handler import handler


@pytest.fixture
def secret(monkeypatch: pytest.MonkeyPatch) -> str:
    monkeypatch.setenv("SOLVER_SHARED_SECRET", "correct-horse-battery-staple")
    return "correct-horse-battery-staple"


def test_accepts_the_matching_key(secret: str) -> None:
    assert is_authorised(secret) is True


def test_refuses_a_wrong_key(secret: str) -> None:
    assert is_authorised("wrong") is False


def test_refuses_a_missing_key(secret: str) -> None:
    assert is_authorised(None) is False
    assert is_authorised("") is False


def test_disabled_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    """No secret configured ⇒ open, so local dev and tests are frictionless."""
    monkeypatch.delenv("SOLVER_SHARED_SECRET", raising=False)
    assert is_authorised(None) is True


def _proxy_event(body: dict, key: str | None) -> dict:
    headers = {"content-type": "application/json"}
    if key is not None:
        headers["x-solver-key"] = key
    return {
        "requestContext": {"http": {"method": "POST"}},
        "headers": headers,
        "body": json.dumps(body),
        "isBase64Encoded": False,
    }


def test_http_invocation_without_the_key_is_refused(
    secret: str, simple_request: dict
) -> None:
    result = handler(_proxy_event(simple_request, None))
    assert result["statusCode"] == 401
    assert json.loads(result["body"]) == {"error": "unauthorised"}


def test_http_invocation_with_the_key_succeeds(secret: str, simple_request: dict) -> None:
    result = handler(_proxy_event(simple_request, secret))
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["status"] == "ok"


def test_header_name_is_case_insensitive(secret: str, simple_request: dict) -> None:
    """Gateways lowercase headers; a console test invocation may not."""
    event = _proxy_event(simple_request, secret)
    event["headers"]["X-Solver-Key"] = event["headers"].pop("x-solver-key")
    assert handler(event)["statusCode"] == 200


def test_direct_invocation_needs_no_key(secret: str, simple_request: dict) -> None:
    """Invoking Lambda directly already requires AWS IAM credentials."""
    assert handler(simple_request)["status"] in ("ok", "partial")
