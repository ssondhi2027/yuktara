"""Headers, CORS, size limit, rate limits and error responses."""

from __future__ import annotations

import logging
import uuid

from fastapi.testclient import TestClient

from app.main import create_app
from app.schemas import SubmitCheckin
from tests.conftest import bearer, make_settings, make_token


def test_security_headers_and_request_id(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
    for header in ("x-content-type-options", "x-frame-options", "content-security-policy", "referrer-policy"):
        assert header in r.headers
    assert r.headers["cache-control"] == "no-store"
    assert len(r.headers["x-request-id"]) >= 8


def test_valid_incoming_request_id_is_kept_and_junk_is_replaced(client):
    assert client.get("/health", headers={"X-Request-ID": "abc12345-req"}).headers["x-request-id"] == "abc12345-req"
    assert client.get("/health", headers={"X-Request-ID": "<script>"}).headers["x-request-id"] != "<script>"


def test_hsts_only_in_production():
    app = create_app(make_settings(env="production"), connect_db=False)
    with TestClient(app) as c:
        assert "strict-transport-security" in c.get("/health").headers
        assert c.get("/docs").status_code == 404  # no API browser in production


def test_cors_allows_only_listed_origins(client):
    ok = client.options("/health", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    bad = client.options("/health", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in bad.headers


def test_oversized_body_is_rejected(client):
    r = client.post("/photos/upload-url", content=b"x" * (70 * 1024), headers={"content-type": "application/json"})
    assert r.status_code == 413


def test_validation_errors_name_fields_but_never_echo_values(client):
    token = make_token(uuid.uuid4())
    r = client.post(
        "/photos/upload-url",
        json={"kind": "selfie", "content_type": "text/html", "size_bytes": 99_999_999},
        headers=bearer(token),
    )
    assert r.status_code == 422
    body = r.text
    assert "selfie" not in body and "text/html" not in body and "99999999" not in body
    assert set(r.json()["error"]["fields"]) >= {"kind", "content_type", "size_bytes"}


def test_clients_cannot_send_status_or_ids():
    # Unknown fields are refused, so a client can't mark their own check-in reviewed.
    for field in ("status", "client_id", "reviewed_by"):
        try:
            SubmitCheckin.model_validate({field: "x"})
        except ValueError:
            continue
        raise AssertionError(f"{field} was accepted")


def test_writes_are_rate_limited_with_retry_after(client):
    headers = bearer(make_token(uuid.uuid4()))
    body = {"kind": "progress", "content_type": "image/jpeg", "size_bytes": 1000}
    codes = [client.post("/photos/upload-url", json=body, headers=headers).status_code for _ in range(31)]
    assert codes[:30] == [503] * 30  # no service key in tests: past auth and the limit, storage not set up
    last = client.post("/photos/upload-url", json=body, headers=headers)
    assert last.status_code == 429
    assert int(last.headers["retry-after"]) >= 1


def test_rate_limits_are_per_user(client):
    body = {"kind": "progress", "content_type": "image/jpeg", "size_bytes": 1000}
    a = bearer(make_token(uuid.uuid4()))
    for _ in range(31):
        client.post("/photos/upload-url", json=body, headers=a)
    b = bearer(make_token(uuid.uuid4()))
    assert client.post("/photos/upload-url", json=body, headers=b).status_code == 503


def test_unhandled_errors_are_generic_and_not_logged_with_details(app_no_db, caplog):
    @app_no_db.get("/boom")
    async def boom():
        raise RuntimeError("weight 71.8 kg, injury: lower back")

    with TestClient(app_no_db, raise_server_exceptions=False) as c, caplog.at_level(logging.INFO):
        r = c.get("/boom")
    assert r.status_code == 500
    assert r.json()["error"] == {"code": "server_error", "message": "Something went wrong."}
    assert "71.8" not in r.text
    assert "71.8" not in caplog.text and "lower back" not in caplog.text
    assert "RuntimeError" in caplog.text  # the type is still there for debugging


def test_logs_never_contain_tokens(client, caplog):
    token = make_token(uuid.uuid4())
    with caplog.at_level(logging.INFO):
        client.post(f"/checkins/{uuid.uuid4()}/submit", json={"wins": "new best"}, headers=bearer(token))
    assert token not in caplog.text
    assert token.split(".")[1] not in caplog.text
    assert "new best" not in caplog.text
