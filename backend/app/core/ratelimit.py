"""Rate limits for writes and for anything that sends messages or email.

A sliding window per (bucket, user). Kept in memory, which is right for a
single Render instance; move it to Redis together with the cache when the
API runs on more than one instance. Over the limit → 429 with Retry-After.
"""

from __future__ import annotations

import math
import time
from collections import defaultdict, deque
from dataclasses import dataclass

from fastapi import HTTPException, Request, status


@dataclass(frozen=True)
class Limit:
    bucket: str
    max_calls: int
    per_seconds: float


# Tuned for a coaching app: generous for normal use, tight where a loop could spam someone.
WRITES = Limit("writes", 30, 60)
MESSAGES = Limit("messages", 20, 60 * 10)  # coach feedback sends a message to the client
UPLOAD_LINKS = Limit("upload-links", 30, 60)
INVITE_ROTATE = Limit("invite-rotate", 5, 60 * 60)


class RateLimiter:
    def __init__(self, clock=time.monotonic, max_keys: int = 10_000):
        self._hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._clock = clock
        self._max_keys = max_keys

    def hit(self, limit: Limit, who: str) -> float | None:
        """Records a call. Returns seconds to wait if over the limit, else None."""
        now = self._clock()
        q = self._hits[(limit.bucket, who)]
        while q and now - q[0] >= limit.per_seconds:
            q.popleft()
        if len(q) >= limit.max_calls:
            return limit.per_seconds - (now - q[0])
        q.append(now)
        if len(self._hits) > self._max_keys:  # drop idle keys so memory stays bounded
            for k in [k for k, v in self._hits.items() if not v][: self._max_keys // 10]:
                del self._hits[k]
        return None


def enforce(request: Request, *limits: Limit) -> None:
    """Call after authentication; keys on the user id from the verified token."""
    limiter: RateLimiter = request.app.state.rate_limiter
    who = str(getattr(request.state, "user_id", None) or (request.client.host if request.client else "unknown"))
    for limit in limits:
        wait = limiter.hit(limit, who)
        if wait is not None:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Too many requests. Try again shortly.",
                headers={"Retry-After": str(max(1, math.ceil(wait)))},
            )
