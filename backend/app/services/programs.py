"""Program changes by the coach, and the shared exercise library."""

from __future__ import annotations

import asyncpg
from fastapi import HTTPException, status

from app.core.cache import Cache, shared_key
from app.core.db import ensure_coach
from app.schemas import LibraryExercise, SwapExercise, SwapResult

LIBRARY_TTL = 24 * 60 * 60  # the library only changes with a migration or seed


async def swap_exercise(conn: asyncpg.Connection, body: SwapExercise) -> SwapResult:
    """Swaps one exercise for another in a client's workout, for some weeks only."""
    await ensure_coach(conn)
    if body.from_week > body.to_week:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "from_week must be on or before to_week.")

    row = await conn.fetchrow(
        """
        select x.exercise_id, p.weeks, p.client_id
        from public.template_exercises x
        join public.workout_templates t on t.id = x.workout_template_id
        join public.programs p on p.id = t.program_id
        where x.id = $1 and p.coach_id = auth.uid() and p.client_id is not null
        """,
        body.template_exercise_id,
    )
    if row is None:  # not this coach's client program
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workout exercise not found")
    if body.to_week > row["weeks"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"This program has {row['weeks']} weeks.")
    if body.to_exercise_id == row["exercise_id"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Pick a different exercise.")

    # RLS: the shared library plus the coach's own exercises.
    if not await conn.fetchval("select exists (select 1 from public.exercises where id = $1)", body.to_exercise_id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown exercise.")
    if body.check_in_id is not None and not await conn.fetchval(
        "select exists (select 1 from public.check_ins where id = $1 and client_id = $2)",
        body.check_in_id,
        row["client_id"],
    ):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That check-in isn't from this client.")

    swap_id = await conn.fetchval(
        """
        insert into public.exercise_swaps
          (template_exercise_id, from_exercise_id, to_exercise_id, from_week, to_week, check_in_id, created_by)
        values ($1, $2, $3, $4, $5, $6, auth.uid())
        returning id
        """,
        body.template_exercise_id,
        row["exercise_id"],
        body.to_exercise_id,
        body.from_week,
        body.to_week,
        body.check_in_id,
    )
    return SwapResult(swap_id=swap_id)


async def exercise_library(conn: asyncpg.Connection, cache: Cache) -> list[LibraryExercise]:
    """The shared library (created_by is null): the same for every user, so one shared cache entry."""
    key = shared_key("exercise-library")
    cached = cache.get(key)
    if cached is not None:
        return cached
    rows = await conn.fetch(
        """
        select e.id, e.name, e.level::text as level, e.equipment, e.cue,
               coalesce(array_agg(m.muscle::text order by m.muscle)
                        filter (where m.role = 'primary'), '{}') as primary,
               coalesce(array_agg(m.muscle::text order by m.muscle)
                        filter (where m.role = 'secondary'), '{}') as secondary
        from public.exercises e
        left join public.exercise_muscles m on m.exercise_id = e.id
        where e.created_by is null
        group by e.id
        order by e.name
        """
    )
    library = [LibraryExercise(**dict(r)) for r in rows]
    cache.set(key, library, LIBRARY_TTL)
    return library
