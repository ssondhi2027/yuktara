"""Verifies Supabase access tokens.

Every protected request must carry `Authorization: Bearer <access token>`.
The token is checked for signature, expiry, audience ("authenticated") and
issuer (<SUPABASE_URL>/auth/v1). Projects with signing keys are verified
against the public JWKS (cached); older projects fall back to the HS256
secret. The user id comes from the token's `sub` claim and nowhere else.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import httpx
import jwt
from fastapi import Depends, HTTPException, Request, status

from app.config import Settings, get_settings

ASYMMETRIC_ALGS = {"ES256", "RS256", "EdDSA"}
JWKS_TTL_SECONDS = 600
JWKS_MIN_REFRESH_SECONDS = 30  # unknown key ids can't make us hammer the JWKS endpoint
LEEWAY_SECONDS = 10


@dataclass(frozen=True)
class CurrentUser:
    id: uuid.UUID
    # Verified claims, passed to Postgres as request.jwt.claims so auth.uid() and RLS work.
    claims: dict[str, Any] = field(repr=False)


def unauthorized(detail: str = "Not signed in") -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail, headers={"WWW-Authenticate": "Bearer"})


class JWKSCache:
    """Fetches and caches the project's public signing keys."""

    def __init__(self, url: str, http: httpx.AsyncClient | None = None):
        self.url = url
        self._http = http
        self._keys: dict[str, jwt.PyJWK] = {}
        self._fetched_at = 0.0
        self._lock = asyncio.Lock()

    async def _refresh(self) -> None:
        client = self._http or httpx.AsyncClient(timeout=5)
        try:
            res = await client.get(self.url)
            res.raise_for_status()
            jwk_set = jwt.PyJWKSet.from_dict(res.json())
        finally:
            if self._http is None:
                await client.aclose()
        self._keys = {k.key_id: k for k in jwk_set.keys if k.key_id}
        self._fetched_at = time.monotonic()

    async def get(self, kid: str) -> jwt.PyJWK | None:
        age = time.monotonic() - self._fetched_at
        if kid in self._keys and age < JWKS_TTL_SECONDS:
            return self._keys[kid]
        async with self._lock:
            age = time.monotonic() - self._fetched_at
            stale = age >= JWKS_TTL_SECONDS
            if stale or (kid not in self._keys and age >= JWKS_MIN_REFRESH_SECONDS):
                try:
                    await self._refresh()
                except (httpx.HTTPError, jwt.PyJWKSetError, ValueError):
                    # Keep serving the keys we had; a missing kid fails below.
                    pass
            return self._keys.get(kid)


class TokenVerifier:
    def __init__(self, settings: Settings, jwks: JWKSCache | None = None):
        self.settings = settings
        self.jwks = jwks or JWKSCache(settings.jwks_url)
        secret = settings.supabase_jwt_secret
        self._hs_secret = secret.get_secret_value() if secret else None

    async def verify(self, token: str) -> CurrentUser:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as e:
            raise unauthorized("Invalid token") from e

        alg = header.get("alg")
        # The algorithm is chosen by the key type we hold, never by the token alone.
        if alg in ASYMMETRIC_ALGS:
            kid = header.get("kid")
            key = await self.jwks.get(kid) if isinstance(kid, str) else None
            if key is None:
                raise unauthorized("Invalid token")
            verify_key: Any = key.key
            algorithms = [alg]
        elif alg == "HS256" and self._hs_secret:
            verify_key = self._hs_secret
            algorithms = ["HS256"]
        else:
            raise unauthorized("Invalid token")

        try:
            claims = jwt.decode(
                token,
                verify_key,
                algorithms=algorithms,
                audience="authenticated",
                issuer=self.settings.jwt_issuer,
                leeway=LEEWAY_SECONDS,
                options={"require": ["exp", "iat", "sub", "aud", "iss"]},
            )
        except jwt.ExpiredSignatureError as e:
            raise unauthorized("Session expired") from e
        except jwt.PyJWTError as e:
            raise unauthorized("Invalid token") from e

        if claims.get("role") != "authenticated":
            raise unauthorized("Invalid token")
        try:
            user_id = uuid.UUID(str(claims["sub"]))
        except ValueError as e:
            raise unauthorized("Invalid token") from e
        return CurrentUser(id=user_id, claims=claims)


def get_verifier(request: Request) -> TokenVerifier:
    verifier = getattr(request.app.state, "verifier", None)
    if verifier is None:
        verifier = request.app.state.verifier = TokenVerifier(get_settings())
    return verifier


async def get_current_user(request: Request, verifier: TokenVerifier = Depends(get_verifier)) -> CurrentUser:
    auth = request.headers.get("authorization", "")
    scheme, _, token = auth.partition(" ")
    if scheme.lower() != "bearer" or not token or len(token) > 8192:
        raise unauthorized()
    user = await verifier.verify(token.strip())
    request.state.user_id = user.id  # for rate limiting; never logged
    return user
