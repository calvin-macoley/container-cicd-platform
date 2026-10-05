"""Record Prometheus metrics and write one access log line per request."""

from __future__ import annotations

import logging
import time

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from shortener.metrics import Metrics, route_template

access_logger = logging.getLogger("shortener.access")

# Probe and scrape traffic is logged at DEBUG to keep INFO logs readable.
_QUIET_ROUTES = frozenset({"/healthz", "/readyz", "/metrics"})


class MetricsMiddleware:
    def __init__(self, app: ASGIApp, metrics: Metrics) -> None:
        self.app = app
        self.metrics = metrics

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        status = 500
        start = time.perf_counter()

        async def recording_send(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, recording_send)
        finally:
            duration = time.perf_counter() - start
            route = route_template(scope)
            method = scope["method"]
            self.metrics.observe(method, route, status, duration)
            access_logger.log(
                logging.DEBUG if route in _QUIET_ROUTES else logging.INFO,
                "request",
                extra={
                    "method": method,
                    "route": route,
                    "path": scope["path"],
                    "status": status,
                    "duration_ms": round(duration * 1000, 2),
                },
            )
