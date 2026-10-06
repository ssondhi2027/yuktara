"""A small cache with a time-to-live per entry.

Rules (see docs/api.md, "Caching"):
- Keys for data that belongs to one user must include that user's id
  (use `user_key`), and writes clear the matching entries.
- Never cache tokens, responses to write requests, or one user's data
  under a key another user could read.
- In memory for now (one Render instance). Redis (e.g. Upstash) is the
  upgrade path: implement the same `Cache` protocol.
"""

from __future__ import annotations

import time
import uuid
from collections import OrderedDict
from typing import Any, Protocol


class Cache(Protocol):
    def get(self, key: str) -> Any | None: ...
    def set(self, key: str, value: Any, ttl_seconds: float) -> None: ...
    def delete(self, key: str) -> None: ...
    def delete_prefix(self, prefix: str) -> None: ...


def user_key(user_id: uuid.UUID, *parts: str) -> str:
    """Key for data that belongs to one user: "user:<id>:<parts…>"."""
    return ":".join(["user", str(user_id), *parts])


def shared_key(*parts: str) -> str:
    """Key for reference data that is the same for everyone (e.g. the exercise library)."""
    return ":".join(["shared", *parts])


class MemoryCache:
    """In-process TTL cache with a size cap (oldest entries are evicted first)."""

    def __init__(self, max_entries: int = 1000, clock=time.monotonic):
        self._data: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._max = max_entries
        self._clock = clock

    def get(self, key: str) -> Any | None:
        item = self._data.get(key)
        if item is None:
            return None
        expires, value = item
        if self._clock() >= expires:
            del self._data[key]
            return None
        return value

    def set(self, key: str, value: Any, ttl_seconds: float) -> None:
        if ttl_seconds <= 0:
            return
        self._data[key] = (self._clock() + ttl_seconds, value)
        self._data.move_to_end(key)
        while len(self._data) > self._max:
            self._data.popitem(last=False)

    def delete(self, key: str) -> None:
        self._data.pop(key, None)

    def delete_prefix(self, prefix: str) -> None:
        for k in [k for k in self._data if k.startswith(prefix)]:
            del self._data[k]
