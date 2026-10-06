"""Program changes (the coach) and the shared exercise library."""

from fastapi import APIRouter, Depends, Request

from app.core.auth import CurrentUser, get_current_user
from app.core.db import Database, get_db
from app.core.ratelimit import WRITES, enforce
from app.schemas import LibraryExercise, SwapExercise, SwapResult
from app.services import programs

router = APIRouter(prefix="/programs", tags=["programs"])


@router.post("/swap", response_model=SwapResult)
async def swap_exercise(
    body: SwapExercise,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> SwapResult:
    enforce(request, WRITES)
    async with db.as_user(user) as conn:
        return await programs.swap_exercise(conn, body)


@router.get("/exercise-library", response_model=list[LibraryExercise])
async def exercise_library(
    request: Request, user: CurrentUser = Depends(get_current_user), db: Database = Depends(get_db)
) -> list[LibraryExercise]:
    cached = request.app.state.cache
    async with db.as_user(user) as conn:
        return await programs.exercise_library(conn, cached)
