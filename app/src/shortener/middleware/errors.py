"""Turn unhandled exceptions into a logged, JSON 500 response.

Starlette's own last-resort handler sits outside user middleware, so the
request ID, access log and metrics would never see the failure. This
middleware is installed innermost so they do.
"""

from __future__ import annotations

import logging

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger(__name__)


class UnhandledErrorMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except Exception:
            logger.exception("unhandled error")
            if response_started:
                raise
            response = JSONResponse({"detail": "Internal Server Error"}, status_code=500)
            await response(scope, receive, send)
