"""Coach actions: reviewing a check-in and managing their invite code.

Runs as the coach (RLS on). The code also checks the caller is a coach and
that the check-in's client is theirs (public.is_coach_of).
"""

from __future__ import annotations

import re
import secrets
import uuid
from decimal import Decimal

import asyncpg
from fastapi import HTTPException, status

from app.core.db import ensure_coach
from app.schemas import InviteCode, ReviewCheckin, ReviewResult, Targets

CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I/L


async def review(conn: asyncpg.Connection, check_in_id: uuid.UUID, body: ReviewCheckin) -> ReviewResult:
    await ensure_coach(conn)
    row = await conn.fetchrow(
        """
        select c.client_id, c.status::text as status, u.timezone
        from public.check_ins c
        join public.users u on u.id = c.client_id
        where c.id = $1 and public.is_coach_of(c.client_id)
        for update of c
        """,
        check_in_id,
    )
    if row is None:  # not theirs, or doesn't exist: same answer
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Check-in not found")
    if row["status"] not in ("submitted", "reviewed"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This check-in hasn't been submitted yet.")
    client_id: uuid.UUID = row["client_id"]

    await conn.execute(
        "insert into public.messages (client_id, sender_id, check_in_id, body) values ($1, auth.uid(), $2, $3)",
        client_id,
        check_in_id,
        body.message,
    )

    if body.mark_reviewed:
        await conn.execute(
            """
            update public.check_ins
            set status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now()
            where id = $1
            """,
            check_in_id,
        )

    if body.targets is not None:
        await _set_targets(conn, client_id, row["timezone"], body.targets)

    await conn.execute("delete from public.review_drafts where check_in_id = $1", check_in_id)

    next_id = await conn.fetchval(
        """
        select c.id from public.check_ins c
        where c.status = 'submitted' and c.id <> $1 and public.is_coach_of(c.client_id)
        order by c.submitted_at nulls last
        limit 1
        """,
        check_in_id,
    )
    return ReviewResult(next_id=next_id)


async def _set_targets(conn: asyncpg.Connection, client_id: uuid.UUID, timezone: str, t: Targets) -> None:
    """New targets start next Monday in the client's timezone; unchanged targets add no row."""
    tz_ok = await conn.fetchval("select exists (select 1 from pg_timezone_names where name = $1)", timezone)
    starts = await conn.fetchval(
        "select (date_trunc('week', now() at time zone $1)::date + 7)", timezone if tz_ok else "UTC"
    )
    sleep = None if t.sleep_h is None else Decimal(str(round(t.sleep_h, 1)))
    current = await conn.fetchrow(
        "select calories, protein_g, carbs_g, fat_g, water_ml, steps, sleep_hours from public.targets_on($1, $2)",
        client_id,
        starts,
    )
    new = (t.calories, t.protein_g, t.carbs_g, t.fat_g, t.water_ml, t.steps, sleep)
    if current is not None and tuple(current) == new:
        return
    await conn.execute(
        """
        insert into public.nutrition_targets
          (client_id, effective_from, calories, protein_g, carbs_g, fat_g, water_ml, steps, sleep_hours, set_by)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, auth.uid())
        on conflict (client_id, effective_from) do update set
          calories = excluded.calories, protein_g = excluded.protein_g, carbs_g = excluded.carbs_g,
          fat_g = excluded.fat_g, water_ml = excluded.water_ml, steps = excluded.steps,
          sleep_hours = excluded.sleep_hours, set_by = excluded.set_by
        """,
        client_id,
        starts,
        *new,
    )


async def get_invite_code(conn: asyncpg.Connection) -> InviteCode:
    await ensure_coach(conn)
    code = await conn.fetchval("select invite_code::text from public.users where id = auth.uid()")
    return InviteCode(invite_code=code)


def _new_code(full_name: str) -> str:
    first = (full_name.split() or ["COACH"])[0]
    prefix = re.sub(r"[^A-Z]", "", first.upper())[:6] or "COACH"
    return f"{prefix}-{''.join(secrets.choice(CODE_ALPHABET) for _ in range(4))}"


async def rotate_invite_code(conn: asyncpg.Connection) -> InviteCode:
    """Replaces the coach's code. The old one stops working at once."""
    await ensure_coach(conn)
    name = await conn.fetchval("select full_name from public.users where id = auth.uid()") or ""
    for _ in range(8):
        code = _new_code(name)
        try:
            async with conn.transaction():  # savepoint, so a clash can be retried
                await conn.execute("update public.users set invite_code = $1 where id = auth.uid()", code)
            return InviteCode(invite_code=code)
        except asyncpg.UniqueViolationError:
            continue
    raise HTTPException(status.HTTP_409_CONFLICT, "Couldn't make a unique code. Try again.")
