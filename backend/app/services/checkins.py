"""Client check-in submission.

Runs as the client (RLS on). On top of RLS the code checks that the caller
owns the check-in and that it is still open ('due' or 'submitted').
"""

from __future__ import annotations

import re
import uuid
from decimal import Decimal

import asyncpg
from fastapi import HTTPException, status

from app.schemas import SubmitCheckin, SubmitResult

OPEN_STATUSES = {"due", "submitted"}


def _dec(x: float | None) -> Decimal | None:
    return None if x is None else Decimal(str(x))


async def submit(
    conn: asyncpg.Connection, user_id: uuid.UUID, check_in_id: uuid.UUID, body: SubmitCheckin
) -> SubmitResult:
    row = await conn.fetchrow(
        "select client_id, status::text as status from public.check_ins where id = $1 for update",
        check_in_id,
    )
    # A coach can read their client's check-in under RLS, but only the client may submit it.
    # Same 404 either way, so ids of other people's check-ins can't be probed.
    if row is None or row["client_id"] != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Check-in not found")
    if row["status"] not in OPEN_STATUSES:
        raise HTTPException(status.HTTP_409_CONFLICT, "This check-in is closed and can't be changed.")

    photo_path = re.compile(rf"^{re.escape(str(user_id))}/progress/[\w.-]+$")
    for p in body.photos:
        if not photo_path.match(p.path):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Photos must be uploaded to your own folder.")
    if len({p.pose for p in body.photos}) != len(body.photos):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "One photo per pose.")

    question_ids = [a.question_id for a in body.answers]
    if len(set(question_ids)) != len(question_ids):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Each question can be answered once.")
    if question_ids:
        # RLS shows the client only their own coach's active questions.
        known = await conn.fetchval(
            "select count(*) from public.checkin_questions where id = any($1::uuid[]) and is_active",
            question_ids,
        )
        if known != len(question_ids):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown check-in question.")

    saved = await conn.fetchrow(
        """
        update public.check_ins
        set avg_weight_kg = $2, waist_cm = $3, hips_cm = $4,
            energy = $5, sleep = $6, stress = $7, hunger = $8,
            wins = nullif($9, ''), struggles = nullif($10, ''), question = nullif($11, ''),
            status = 'submitted'
        where id = $1 and client_id = auth.uid()
        returning id, submitted_at
        """,
        check_in_id,
        _dec(body.avg_weight_kg),
        _dec(body.waist_cm),
        _dec(body.hips_cm),
        body.energy,
        body.sleep,
        body.stress,
        body.hunger,
        body.wins,
        body.struggles,
        body.question,
    )
    if saved is None:  # RLS refused the update
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Check-in not found")

    if body.answers:
        await conn.execute(
            """
            insert into public.checkin_answers (check_in_id, question_id, value_number, value_text)
            select $1, x.q, x.n, x.t from unnest($2::uuid[], $3::numeric[], $4::text[]) as x(q, n, t)
            on conflict (check_in_id, question_id)
            do update set value_number = excluded.value_number, value_text = excluded.value_text
            """,
            check_in_id,
            question_ids,
            [_dec(a.value_number) for a in body.answers],
            [a.value_text for a in body.answers],
        )

    if body.photos:
        await conn.execute(
            """
            insert into public.progress_photos (check_in_id, pose, photo_url, taken_on)
            select $1, x.pose::public.photo_pose, x.path, current_date
            from unnest($2::text[], $3::text[]) as x(pose, path)
            on conflict (check_in_id, pose) do update set photo_url = excluded.photo_url, taken_on = excluded.taken_on
            """,
            check_in_id,
            [p.pose for p in body.photos],
            [p.path for p in body.photos],
        )

    return SubmitResult(id=saved["id"], status="submitted", submitted_at=saved["submitted_at"])
