"""Request ids, logging, security headers, a body-size limit and generic errors.

Logs carry: request id, method, route template, status and duration. They
never carry tokens, request bodies, query strings or health data (weights,
photos, injuries, check-in answers). Database errors are logged by SQLSTATE
only, because Postgres error details can include row values.
"""

from __future__ import annotations

import json
import logging
import re
import time
import traceback
import uuid

import asyncpg
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

log = logging.getLogger("yuktara.api")

REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Resource-Policy": "same-site",
    "Cache-Control": "no-store",
}


def error_body(code: str, message: str, request: Request) -> dict:
    return {"error": {"code": code, "message": message}, "request_id": getattr(request.state, "request_id", None)}


class BodyTooLarge(Exception):
    pass


class RequestMiddleware:
    """Pure ASGI middleware: request id, size limit, security headers, access log."""

    def __init__(self, app: ASGIApp, max_body_bytes: int, hsts: bool):
        self.app = app
        self.max_body = max_body_bytes
        self.hsts = hsts

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        incoming = headers.get("x-request-id", "")
        request_id = incoming if REQUEST_ID_RE.match(incoming) else uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id
        started = time.perf_counter()
        status_code = 500
        response_started = False

        async def send_wrapped(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                nonlocal response_started
                response_started = True
                status_code = message["status"]
                raw = list(message.get("headers", []))
                raw.append((b"x-request-id", request_id.encode()))
                for k, v in SECURITY_HEADERS.items():
                    raw.append((k.lower().encode(), v.encode()))
                if self.hsts:
                    raw.append((b"strict-transport-security", b"max-age=63072000; includeSubDomains"))
                message["headers"] = raw
            await send(message)

        async def reject(code: int, err: str, msg: str) -> None:
            body = json.dumps({"error": {"code": err, "message": msg}, "request_id": request_id}).encode()
            await send_wrapped(
                {
                    "type": "http.response.start",
                    "status": code,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
                }
            )
            await send_wrapped({"type": "http.response.body", "body": body})

        length = headers.get("content-length")
        if length is not None and (not length.isdigit() or int(length) > self.max_body):
            await reject(413, "payload_too_large", "Request is too large.")
            self._log(scope, 413, started, request_id)
            return

        received = 0

        async def receive_limited() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body:
                    raise BodyTooLarge
            return message

        try:
            await self.app(scope, receive_limited, send_wrapped)
        except BodyTooLarge:
            if not response_started:
                await reject(413, "payload_too_large", "Request is too large.")
            status_code = 413
        except Exception as exc:
            # Type and code location only: messages and tracebacks can contain user data.
            frame = traceback.extract_tb(exc.__traceback__)[-1] if exc.__traceback__ else None
            where = f"{frame.filename.rsplit('/', 1)[-1].rsplit(chr(92), 1)[-1]}:{frame.lineno}" if frame else "-"
            log.error("unhandled id=%s type=%s at=%s", request_id, type(exc).__name__, where)
            if not response_started:
                await reject(500, "server_error", "Something went wrong.")
            status_code = 500
        finally:
            self._log(scope, status_code, started, request_id)

    @staticmethod
    def _log(scope: Scope, status_code: int, started: float, request_id: str) -> None:
        route = scope.get("route")
        path = getattr(route, "path", None) or "unmatched"  # template like /checkins/{check_in_id}/submit
        log.info(
            "request id=%s method=%s route=%s status=%s ms=%.0f",
            request_id,
            scope.get("method"),
            path,
            status_code,
            (time.perf_counter() - started) * 1000,
        )


# Postgres SQLSTATE → (HTTP status, code, safe message)
PG_ERRORS: dict[str, tuple[int, str, str]] = {
    "42501": (403, "forbidden", "You don't have access to that."),  # insufficient privilege / RLS
    "23505": (409, "conflict", "That already exists."),
    "23503": (422, "invalid_reference", "Something referenced doesn't exist."),
    "23514": (422, "invalid_value", "A value is out of range."),
    "23502": (422, "invalid_value", "A required value is missing."),
    "22P02": (422, "invalid_value", "A value has the wrong format."),
    "57014": (503, "timeout", "The database took too long. Try again."),
}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        code = {
            400: "bad_request",
            401: "unauthorized",
            403: "forbidden",
            404: "not_found",
            405: "method_not_allowed",
            409: "conflict",
            413: "payload_too_large",
            422: "invalid_request",
            429: "rate_limited",
            503: "unavailable",
        }.get(exc.status_code, "error")
        message = exc.detail if isinstance(exc.detail, str) else "Request failed."
        return JSONResponse(error_body(code, message, request), status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Field locations only. Never echo submitted values: they can be health data.
        fields = sorted({".".join(str(p) for p in e.get("loc", ()) if p != "body") for e in exc.errors()})
        body = error_body("invalid_request", "Some fields are missing or invalid.", request)
        body["error"]["fields"] = [f for f in fields if f][:20]
        return JSONResponse(body, status_code=422)

    @app.exception_handler(asyncpg.PostgresError)
    async def db_error(request: Request, exc: asyncpg.PostgresError) -> JSONResponse:
        sqlstate = getattr(exc, "sqlstate", "") or ""
        if sqlstate == "P0001":
            # Raised by our own triggers (0005, 0007, 0010); their messages are written for people.
            log.info("db rule id=%s sqlstate=P0001", request.state.request_id)
            return JSONResponse(
                error_body("not_allowed", str(exc.args[0] if exc.args else "Not allowed."), request), status_code=409
            )
        status_code, code, message = PG_ERRORS.get(sqlstate, (500, "server_error", "Something went wrong."))
        log.warning("db error id=%s sqlstate=%s type=%s", request.state.request_id, sqlstate, type(exc).__name__)
        return JSONResponse(error_body(code, message, request), status_code=status_code)
