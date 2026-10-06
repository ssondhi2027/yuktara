"""Signed upload links for progress and meal photos (the client)."""

from fastapi import APIRouter, Depends, Request

from app.core.auth import CurrentUser, get_current_user
from app.core.ratelimit import UPLOAD_LINKS, enforce
from app.schemas import UploadUrlRequest, UploadUrlResult
from app.services import photos

router = APIRouter(prefix="/photos", tags=["photos"])


@router.post("/upload-url", response_model=UploadUrlResult)
async def upload_url(
    body: UploadUrlRequest, request: Request, user: CurrentUser = Depends(get_current_user)
) -> UploadUrlResult:
    enforce(request, UPLOAD_LINKS)
    return await photos.create_upload_url(request.app.state.http, request.app.state.settings, user.id, body)
