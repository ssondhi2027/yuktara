"""Token checks: only valid Supabase access tokens get through."""

from __future__ import annotations

import asyncio
import json
import time
import uuid

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException

from app.core.auth import JWKSCache, TokenVerifier
from tests.conftest import ISSUER, SECRET, bearer, make_settings, make_token

URL = f"/checkins/{uuid.uuid4()}/submit"  # any protected endpoint
USER = uuid.uuid4()


def post(client, headers=None):
    return client.post(URL, json={}, headers=headers or {})


def test_missing_token_is_rejected(client):
    r = post(client)
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize("value", ["Basic abc", "Bearer", "Bearer ", "token-without-scheme"])
def test_malformed_header_is_rejected(client, value):
    assert post(client, {"Authorization": value}).status_code == 401


def test_expired_token_is_rejected(client):
    r = post(client, bearer(make_token(USER, expires_in=-120)))
    assert r.status_code == 401
    assert r.json()["error"]["message"] == "Session expired"


def test_wrong_audience_is_rejected(client):
    assert post(client, bearer(make_token(USER, aud="anon"))).status_code == 401


def test_wrong_issuer_is_rejected(client):
    assert post(client, bearer(make_token(USER, iss="https://evil.example/auth/v1"))).status_code == 401


def test_wrong_secret_is_rejected(client):
    assert post(client, bearer(make_token(USER, secret="x" * 40))).status_code == 401


def test_tampered_token_is_rejected(client):
    header, payload, signature = make_token(USER).split(".")
    claims = json.loads(jwt.utils.base64url_decode(payload))
    claims["sub"] = str(uuid.uuid4())  # try to become someone else
    forged = jwt.utils.base64url_encode(json.dumps(claims).encode()).decode()
    assert post(client, bearer(f"{header}.{forged}.{signature}")).status_code == 401


def test_unsigned_token_is_rejected(client):
    now = int(time.time())
    claims = {
        "sub": str(USER),
        "aud": "authenticated",
        "iss": ISSUER,
        "role": "authenticated",
        "iat": now,
        "exp": now + 60,
    }
    token = jwt.encode(claims, key=None, algorithm="none")
    assert post(client, bearer(token)).status_code == 401


def test_anon_role_is_rejected(client):
    assert post(client, bearer(make_token(USER, role="anon"))).status_code == 401


def test_service_role_token_is_rejected(client):
    # A leaked service key must not work as a user session either.
    assert post(client, bearer(make_token(USER, role="service_role"))).status_code == 401


def test_non_uuid_subject_is_rejected(client):
    assert post(client, bearer(make_token("not-a-uuid"))).status_code == 401


def test_missing_expiry_is_rejected(client):
    claims = {"sub": str(USER), "aud": "authenticated", "iss": ISSUER, "role": "authenticated", "iat": int(time.time())}
    assert post(client, bearer(jwt.encode(claims, SECRET, algorithm="HS256"))).status_code == 401


def test_valid_token_passes_auth(client):
    # No database in unit tests: getting past auth means the next step (the database) answers 503.
    assert post(client, bearer(make_token(USER))).status_code == 503


# ---------- Signing keys (JWKS) ----------


def _ec_key():
    private = ec.generate_private_key(ec.SECP256R1())
    jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(private.public_key()))
    return private, jwk


def _verifier(jwks: dict, **settings_overrides) -> tuple[TokenVerifier, list[int]]:
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(200, json=jwks)

    settings = make_settings(**settings_overrides)
    cache = JWKSCache(settings.jwks_url, http=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    return TokenVerifier(settings, cache), calls


def _es256(private, kid: str, **kw) -> str:
    return make_token(USER, secret=private, algorithm="ES256", headers={"kid": kid}, **kw)


def test_jwks_token_is_accepted_and_keys_are_cached():
    private, jwk = _ec_key()
    verifier, calls = _verifier({"keys": [{**jwk, "kid": "k1", "alg": "ES256", "use": "sig"}]})
    user = asyncio.run(verifier.verify(_es256(private, "k1")))
    assert user.id == USER
    asyncio.run(verifier.verify(_es256(private, "k1")))
    assert len(calls) == 1  # second check used the cached keys


def test_jwks_token_signed_by_another_key_is_rejected():
    _, jwk = _ec_key()
    attacker, _ = _ec_key()
    verifier, _ = _verifier({"keys": [{**jwk, "kid": "k1", "alg": "ES256", "use": "sig"}]})
    with pytest.raises(HTTPException) as e:
        asyncio.run(verifier.verify(_es256(attacker, "k1")))
    assert e.value.status_code == 401


def test_unknown_key_id_is_rejected():
    private, jwk = _ec_key()
    verifier, _ = _verifier({"keys": [{**jwk, "kid": "k1", "alg": "ES256", "use": "sig"}]})
    with pytest.raises(HTTPException):
        asyncio.run(verifier.verify(_es256(private, "other-kid")))


def test_hs256_token_is_rejected_when_no_secret_is_configured():
    # Projects on signing keys don't set SUPABASE_JWT_SECRET; then HS256 tokens never verify.
    verifier, _ = _verifier({"keys": []}, supabase_jwt_secret=None)
    with pytest.raises(HTTPException):
        asyncio.run(verifier.verify(make_token(USER)))
