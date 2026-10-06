"""Signed upload links for the private photo buckets.

The path is built here from the verified user id, so a client can only ever
upload into their own folder. The buckets themselves (0008_storage.sql) also
enforce the 5 MB limit and image types, so a link can't be abused for
anything bigger or different.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime
from urllib.parse import parse_qs, quote, urlparse

import httpx
from fastapi import HTTPException, status

from app.config import Settings
from app.schemas import UploadUrlRequest, UploadUrlResult

BUCKETS = {"progress": "progress-photos", "meals": "meal-photos"}
EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
SIGNED_UPLOAD_SECONDS = 2 * 60 * 60  # Supabase signed upload links last two hours


def object_path(user_id: uuid.UUID, kind: str, content_type: str, now: datetime | None = None) -> str:
    day = (now or datetime.now(UTC)).date().isoformat()
    return f"{user_id}/{kind}/{day}-{secrets.token_hex(8)}.{EXTENSIONS[content_type]}"


async def create_upload_url(
    http: httpx.AsyncClient, settings: Settings, user_id: uuid.UUID, body: UploadUrlRequest
) -> UploadUrlResult:
    key = settings.supabase_service_role_key
    if key is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Photo uploads aren't set up yet.")

    bucket = BUCKETS[body.kind]
    path = object_path(user_id, body.kind, body.content_type)
    secret = key.get_secret_value()
    try:
        res = await http.post(
            f"{settings.supabase_base}/storage/v1/object/upload/sign/{bucket}/{quote(path)}",
            headers={"Authorization": f"Bearer {secret}", "apikey": secret},
            timeout=10,
        )
    except httpx.HTTPError as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Photo storage is unavailable.") from e
    if res.status_code != 200:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Photo storage is unavailable.")

    relative = res.json().get("url", "")  # "/object/upload/sign/<bucket>/<path>?token=…"
    token = parse_qs(urlparse(relative).query).get("token", [""])[0]
    if not relative.startswith("/object/upload/sign/") or not token:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Photo storage is unavailable.")
    return UploadUrlResult(
        bucket=bucket,
        path=path,
        signed_url=f"{settings.supabase_base}/storage/v1{relative}",
        token=token,
        expires_in=SIGNED_UPLOAD_SECONDS,
    )
