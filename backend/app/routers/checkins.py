"""Check-in submission (the client)."""

import uuid

from fastapi import APIRouter, Depends, Request

from app.core.auth import CurrentUser, get_current_user
from app.core.db import Database, get_db
from app.core.ratelimit import WRITES, enforce
from app.schemas import SubmitCheckin, SubmitResult
from app.services import checkins

router = APIRouter(prefix="/checkins", tags=["check-ins"])


@router.post("/{check_in_id}/submit", response_model=SubmitResult)
async def submit_checkin(
    check_in_id: uuid.UUID,
    body: SubmitCheckin,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> SubmitResult:
    enforce(request, WRITES)
    async with db.as_user(user) as conn:
        return await checkins.submit(conn, user.id, check_in_id, body)
