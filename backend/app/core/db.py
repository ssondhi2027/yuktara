"""Database access.

The default is to run as the signed-in user: every request gets one
transaction that switches to the `authenticated` role and sets
request.jwt.claims, exactly as Supabase's own API does. auth.uid() then
returns the token's user and every row-level security rule applies.

`Database.as_admin()` bypasses RLS. Use it only where nothing else works,
and only after checking permissions in code (for example is_coach_of).
Always use parameterised SQL ($1, $2, …); never format values into SQL.

Transactions are opened inside the endpoint (not in a yield dependency) so
the commit finishes before the response is sent.
"""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from dataclasses import dataclass

import asyncpg
from fastapi import HTTPException, Request, status

from app.config import Settings
from app.core.auth import CurrentUser


async def create_pool(settings: Settings) -> asyncpg.Pool:
    return await asyncpg.create_pool(
        dsn=settings.database_url.get_secret_value(),
        min_size=settings.db_pool_min,
        max_size=settings.db_pool_max,
        command_timeout=settings.statement_timeout_ms / 1000 + 2,
        max_inactive_connection_lifetime=300,
        server_settings={"application_name": "yuktara-api"},
    )


async def _start(conn: asyncpg.Connection, timeout_ms: int) -> None:
    # set_config(..., true) is the parameterised form of SET LOCAL.
    await conn.execute("select set_config('statement_timeout', $1, true)", f"{int(timeout_ms)}ms")
    await conn.execute("select set_config('idle_in_transaction_session_timeout', '15s', true)")


@dataclass(frozen=True)
class Database:
    pool: asyncpg.Pool
    timeout_ms: int

    @asynccontextmanager
    async def as_user(self, user: CurrentUser) -> AsyncGenerator[asyncpg.Connection]:
        """One transaction run as `user`, with RLS in force. Rolls back on any error."""
        async with self.pool.acquire() as conn, conn.transaction():
            await _start(conn, self.timeout_ms)
            await conn.execute("set local role authenticated")
            await conn.execute("select set_config('request.jwt.claims', $1, true)", json.dumps(user.claims))
            yield conn

    @asynccontextmanager
    async def as_admin(self, *, reason: str) -> AsyncGenerator[asyncpg.Connection]:
        """A transaction that BYPASSES row-level security.

        Check permissions in code before calling. `reason` documents the call
        site and is required so admin access is always deliberate.
        """
        if not reason:
            raise ValueError("as_admin needs a reason")
        async with self.pool.acquire() as conn, conn.transaction():
            await _start(conn, self.timeout_ms)
            yield conn


def get_db(request: Request) -> Database:
    pool = getattr(request.app.state, "pool", None)
    if pool is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Database unavailable")
    settings: Settings = request.app.state.settings
    return Database(pool=pool, timeout_ms=settings.statement_timeout_ms)


async def ensure_coach(conn: asyncpg.Connection) -> None:
    """Only coaches. The role is read from public.users, never from the token."""
    role = await conn.fetchval("select role::text from public.users where id = auth.uid()")
    if role != "coach":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Coaches only")
