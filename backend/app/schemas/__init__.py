"""Request and response models.

Every request model forbids unknown fields (so nobody can slip in `status`,
`client_id` or `reviewed_by`) and bounds every number and string.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


Text = Annotated[str, StringConstraints(max_length=2000)]
ShortText = Annotated[str, StringConstraints(max_length=1000)]
Score = Annotated[int, Field(ge=1, le=5)]
Pose = Literal["front", "side", "back"]

# ---------- Check-ins (client) ----------


class Answer(Strict):
    question_id: uuid.UUID
    value_number: float | None = Field(default=None, ge=-1_000_000, le=1_000_000)
    value_text: Text | None = None


class PhotoRef(Strict):
    pose: Pose
    # Storage path from POST /photos/upload-url, e.g. <user id>/progress/2026-10-04-ab12cd34.jpg
    path: Annotated[str, StringConstraints(max_length=200, pattern=r"^[0-9a-f-]{36}/progress/[\w.-]+$")]


class SubmitCheckin(Strict):
    avg_weight_kg: float | None = Field(default=None, ge=20, le=400)
    waist_cm: float | None = Field(default=None, ge=30, le=300)
    hips_cm: float | None = Field(default=None, ge=30, le=300)
    energy: Score | None = None
    sleep: Score | None = None
    stress: Score | None = None
    hunger: Score | None = None
    wins: Text = ""
    struggles: Text = ""
    question: ShortText = ""
    answers: list[Answer] = Field(default_factory=list, max_length=30)
    photos: list[PhotoRef] = Field(default_factory=list, max_length=3)


class SubmitResult(BaseModel):
    id: uuid.UUID
    status: Literal["submitted"]
    submitted_at: datetime | None


# ---------- Review (coach) ----------


class Targets(Strict):
    """Same fields as `Targets` in frontend/src/lib/api.ts."""

    calories: int = Field(ge=800, le=8000)
    protein_g: int = Field(ge=0, le=500)
    carbs_g: int = Field(ge=0, le=1000)
    fat_g: int = Field(ge=0, le=400)
    water_ml: int | None = Field(default=None, ge=0, le=10000)
    steps: int | None = Field(default=None, ge=0, le=100_000)
    sleep_h: float | None = Field(default=None, ge=3, le=14)


class ReviewCheckin(Strict):
    message: Annotated[str, StringConstraints(min_length=1, max_length=5000)]
    mark_reviewed: bool = True
    targets: Targets | None = None


class ReviewResult(BaseModel):
    next_id: uuid.UUID | None


class InviteCode(BaseModel):
    invite_code: str | None


# ---------- Programs (coach) ----------


class SwapExercise(Strict):
    template_exercise_id: uuid.UUID
    to_exercise_id: uuid.UUID
    from_week: int = Field(ge=1, le=52)
    to_week: int = Field(ge=1, le=52)
    check_in_id: uuid.UUID | None = None  # the question that led to the swap, if any


class SwapResult(BaseModel):
    ok: Literal[True] = True
    swap_id: uuid.UUID


class LibraryExercise(BaseModel):
    id: uuid.UUID
    name: str
    level: str
    equipment: str | None
    cue: str | None
    primary: list[str]
    secondary: list[str]


# ---------- Photos (client) ----------

MAX_PHOTO_BYTES = 5 * 1024 * 1024


class UploadUrlRequest(Strict):
    kind: Literal["progress", "meals"]
    content_type: Literal["image/jpeg", "image/png", "image/webp"]
    size_bytes: int = Field(ge=1, le=MAX_PHOTO_BYTES)


class UploadUrlResult(BaseModel):
    bucket: str
    path: str
    signed_url: str
    token: str
    expires_in: int
