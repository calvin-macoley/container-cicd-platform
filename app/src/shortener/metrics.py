"""Prometheus metric definitions.

Each app instance owns its registry, so building several apps (tests) never
collides on duplicate metric names.
"""

from __future__ import annotations

from prometheus_client import (
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    gc_collector,
    platform_collector,
    process_collector,
)
from starlette.types import Scope

from shortener.config import Settings

UNMATCHED_ROUTE = "unmatched"
_LABELS = ("method", "route", "status")


class Metrics:
    def __init__(self, settings: Settings) -> None:
        self.registry = CollectorRegistry()
        process_collector.ProcessCollector(registry=self.registry)
        platform_collector.PlatformCollector(registry=self.registry)
        gc_collector.GCCollector(registry=self.registry)

        self.requests = Counter(
            "http_requests_total",
            "HTTP requests handled, by method, route template and status code.",
            _LABELS,
            registry=self.registry,
        )
        self.latency = Histogram(
            "http_request_duration_seconds",
            "HTTP request latency in seconds, by method, route template and status code.",
            _LABELS,
            registry=self.registry,
            buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
        )
        build_info = Gauge(
            "app_build_info",
            "Always 1; labels identify the running build.",
            ("version", "git_sha", "environment"),
            registry=self.registry,
        )
        build_info.labels(
            version=settings.app_version,
            git_sha=settings.git_sha,
            environment=settings.app_env.value,
        ).set(1)
        chaos = Gauge(
            "app_chaos_error_rate",
            "Configured fraction of /api/* requests that fail on purpose (CHAOS_ERROR_RATE).",
            registry=self.registry,
        )
        chaos.set(settings.chaos_error_rate)

    def observe(self, method: str, route: str, status: int, seconds: float) -> None:
        labels = {"method": method, "route": route, "status": str(status)}
        self.requests.labels(**labels).inc()
        self.latency.labels(**labels).observe(seconds)


def route_template(scope: Scope) -> str:
    """The matched route's path template (e.g. ``/api/links/{code}``), never the raw path."""
    route = scope.get("route")
    path = getattr(route, "path", None)
    return path if isinstance(path, str) else UNMATCHED_ROUTE
