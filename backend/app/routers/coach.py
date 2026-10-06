"""Coach actions: reviewing check-ins and the coach's invite code."""

import uuid

from fastapi import APIRouter, Depends, Request

from app.core.auth import CurrentUser, get_current_user
from app.core.db import Database, get_db
from app.core.ratelimit import INVITE_ROTATE, MESSAGES, WRITES, enforce
from app.schemas import InviteCode, ReviewCheckin, ReviewResult
from app.services import coach

router = APIRouter(tags=["coach"])


@router.post("/checkins/{check_in_id}/review", response_model=ReviewResult)
async def review_checkin(
    check_in_id: uuid.UUID,
    body: ReviewCheckin,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> ReviewResult:
    enforce(request, WRITES, MESSAGES)  # sends a message to the client
    async with db.as_user(user) as conn:
        return await coach.review(conn, check_in_id, body)


@router.get("/coach/invite-code", response_model=InviteCode)
async def get_invite_code(user: CurrentUser = Depends(get_current_user), db: Database = Depends(get_db)) -> InviteCode:
    async with db.as_user(user) as conn:
        return await coach.get_invite_code(conn)


@router.post("/coach/invite-code", response_model=InviteCode)
async def rotate_invite_code(
    request: Request, user: CurrentUser = Depends(get_current_user), db: Database = Depends(get_db)
) -> InviteCode:
    enforce(request, WRITES, INVITE_ROTATE)
    async with db.as_user(user) as conn:
        return await coach.rotate_invite_code(conn)
