"""The TTL cache, and signed upload links for photos."""

from __future__ import annotations

import re
import uuid

import httpx
from fastapi.testclient import TestClient

from app.core.cache import MemoryCache, shared_key, user_key
from app.main import create_app
from tests.conftest import SUPABASE_URL, bearer, make_settings, make_token


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def test_cache_entries_expire():
    clock = Clock()
    cache = MemoryCache(clock=clock)
    cache.set("k", 1, ttl_seconds=10)
    clock.t = 9.9
    assert cache.get("k") == 1
    clock.t = 10
    assert cache.get("k") is None


def test_cache_is_bounded():
    cache = MemoryCache(max_entries=2)
    for k in "abc":
        cache.set(k, k, 60)
    assert cache.get("a") is None and cache.get("c") == "c"


def test_user_keys_carry_the_user_id_and_clear_by_prefix():
    a, b = uuid.uuid4(), uuid.uuid4()
    cache = MemoryCache()
    cache.set(user_key(a, "home"), "A", 60)
    cache.set(user_key(b, "home"), "B", 60)
    cache.set(shared_key("exercise-library"), [], 60)
    assert str(a) in user_key(a, "home")
    cache.delete_prefix(user_key(a))  # a write by user A clears only A's entries
    assert cache.get(user_key(a, "home")) is None
    assert cache.get(user_key(b, "home")) == "B"
    assert cache.get(shared_key("exercise-library")) == []


# ---------- Photos ----------

SERVICE_KEY = "service-role-test-key"


def _photo_app(handler):
    app = create_app(make_settings(supabase_service_role_key=SERVICE_KEY), connect_db=False)
    client = TestClient(app)
    client.__enter__()
    app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return client


def test_upload_link_goes_to_the_users_own_folder():
    seen: list[httpx.Request] = []

    def storage(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        path = request.url.path.split("/object/upload/sign/", 1)[1]
        return httpx.Response(200, json={"url": f"/object/upload/sign/{path}?token=signed-token"})

    user = uuid.uuid4()
    client = _photo_app(storage)
    try:
        r = client.post(
            "/photos/upload-url",
            json={"kind": "progress", "content_type": "image/jpeg", "size_bytes": 2_000_000},
            headers=bearer(make_token(user)),
        )
    finally:
        client.__exit__(None, None, None)

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["bucket"] == "progress-photos"
    assert re.fullmatch(rf"{user}/progress/\d{{4}}-\d{{2}}-\d{{2}}-[0-9a-f]{{16}}\.jpg", body["path"])
    assert body["token"] == "signed-token"
    assert body["signed_url"].startswith(f"{SUPABASE_URL}/storage/v1/object/upload/sign/progress-photos/{user}/")
    assert SERVICE_KEY not in r.text  # the key goes to Supabase only
    assert seen[0].headers["authorization"] == f"Bearer {SERVICE_KEY}"


def test_meal_photos_use_their_bucket_and_type():
    def storage(request: httpx.Request) -> httpx.Response:
        path = request.url.path.split("/object/upload/sign/", 1)[1]
        return httpx.Response(200, json={"url": f"/object/upload/sign/{path}?token=t"})

    client = _photo_app(storage)
    try:
        r = client.post(
            "/photos/upload-url",
            json={"kind": "meals", "content_type": "image/webp", "size_bytes": 1000},
            headers=bearer(make_token(uuid.uuid4())),
        )
    finally:
        client.__exit__(None, None, None)
    assert r.status_code == 200
    assert r.json()["bucket"] == "meal-photos" and r.json()["path"].endswith(".webp")


def test_photos_over_5_mb_or_not_images_are_refused(client):
    headers = bearer(make_token(uuid.uuid4()))
    too_big = {"kind": "progress", "content_type": "image/jpeg", "size_bytes": 5 * 1024 * 1024 + 1}
    not_image = {"kind": "progress", "content_type": "application/pdf", "size_bytes": 1000}
    assert client.post("/photos/upload-url", json=too_big, headers=headers).status_code == 422
    assert client.post("/photos/upload-url", json=not_image, headers=headers).status_code == 422


def test_storage_failure_is_a_generic_503():
    client = _photo_app(lambda request: httpx.Response(500, text="internal storage details"))
    try:
        r = client.post(
            "/photos/upload-url",
            json={"kind": "progress", "content_type": "image/png", "size_bytes": 1000},
            headers=bearer(make_token(uuid.uuid4())),
        )
    finally:
        client.__exit__(None, None, None)
    assert r.status_code == 503
    assert "internal storage details" not in r.text
