"""Shared test helpers: settings, token minting and app factories.

Unit tests run without a database. Tests marked `db` need a local Supabase
(`supabase start` + `supabase db reset`) and TEST_DATABASE_URL, e.g.
postgresql://postgres:postgres@127.0.0.1:54322/postgres. CI provides both.
"""

from __future__ import annotations

import os
import time
import uuid
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

SECRET = "test-jwt-secret-that-is-at-least-32-characters-long"
SUPABASE_URL = "http://127.0.0.1:54321"
ISSUER = f"{SUPABASE_URL}/auth/v1"
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "env": "test",
        "database_url": TEST_DATABASE_URL or "postgresql://nobody:none@127.0.0.1:1/none",
        "supabase_url": SUPABASE_URL,
        "supabase_jwt_secret": SECRET,
        "allowed_origins": ["http://localhost:5173"],
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


def make_token(
    sub: uuid.UUID | str,
    *,
    expires_in: int = 3600,
    aud: str = "authenticated",
    iss: str = ISSUER,
    role: str = "authenticated",
    secret: str = SECRET,
    algorithm: str = "HS256",
    headers: dict[str, Any] | None = None,
    **extra: Any,
) -> str:
    now = int(time.time())
    claims = {"sub": str(sub), "aud": aud, "iss": iss, "role": role, "iat": now, "exp": now + expires_in, **extra}
    return jwt.encode(claims, secret, algorithm=algorithm, headers=headers)


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def app_no_db():
    return create_app(make_settings(), connect_db=False)


@pytest.fixture
def client(app_no_db):
    with TestClient(app_no_db) as c:
        yield c
