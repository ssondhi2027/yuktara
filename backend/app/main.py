"""Yuktara API.

Handles the actions that change several tables at once. Reads and simple
writes go from the app straight to Supabase, protected by row-level security.
Run locally with `make dev` (uvicorn app.main:create_app --factory).
"""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import asyncpg
import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings, get_settings
from app.core.auth import TokenVerifier
from app.core.cache import MemoryCache
from app.core.db import create_pool
from app.core.http import RequestMiddleware, install_error_handlers
from app.core.ratelimit import RateLimiter
from app.routers import checkins, coach, health, photos, programs

log = logging.getLogger("yuktara.api")


def create_app(settings: Settings | None = None, *, connect_db: bool = True) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    # httpx logs every outgoing URL at INFO; storage URLs contain user ids.
    logging.getLogger("httpx").setLevel(logging.WARNING)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        app.state.http = httpx.AsyncClient(timeout=10)
        app.state.pool = None
        if connect_db:
            try:
                app.state.pool = await create_pool(settings)
            except (OSError, asyncpg.PostgresError, asyncpg.InterfaceError) as e:
                if settings.env == "production":
                    raise  # never serve production without a database
                # Local work without Supabase running: /health works, database endpoints answer 503.
                log.warning("database unreachable (%s); database endpoints will return 503", type(e).__name__)
        try:
            yield
        finally:
            if app.state.pool is not None:
                await app.state.pool.close()
            await app.state.http.aclose()

    production = settings.env == "production"
    app = FastAPI(
        title="Yuktara API",
        version="0.1.0",
        lifespan=lifespan,
        # No public API browser in production.
        docs_url=None if production else "/docs",
        redoc_url=None,
        openapi_url=None if production else "/openapi.json",
    )
    app.state.settings = settings
    app.state.verifier = TokenVerifier(settings)
    app.state.cache = MemoryCache()
    app.state.rate_limiter = RateLimiter()
    app.state.pool = None
    app.state.http = None

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=False,  # bearer tokens, no cookies
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID", "Retry-After"],
        max_age=600,
    )
    # Added last so it wraps everything: ids, headers and the size limit apply to every response.
    app.add_middleware(RequestMiddleware, max_body_bytes=settings.max_body_bytes, hsts=production)
    install_error_handlers(app)

    for r in (health, checkins, coach, programs, photos):
        app.include_router(r.router)
    return app
