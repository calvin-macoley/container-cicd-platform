from __future__ import annotations

import logging

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from shortener.config import Settings
from shortener.metrics import UNMATCHED_ROUTE, Metrics, route_template


def _sample(app: FastAPI, name: str, labels: dict[str, str]) -> float | None:
    metrics: Metrics = app.state.metrics
    return metrics.registry.get_sample_value(name, labels)


async def test_metrics_endpoint_exposes_prometheus_text(client: AsyncClient) -> None:
    await client.get("/healthz")
    response = await client.get("/metrics")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    body = response.text
    assert "http_requests_total" in body
    assert "http_request_duration_seconds_bucket" in body
    assert 'app_build_info{environment="test",git_sha="abc1234",version="1.2.3"} 1.0' in body
    assert "app_chaos_error_rate 0.0" in body


async def test_request_counted_by_route_template(app: FastAPI, client: AsyncClient) -> None:
    @app.get("/items/{item_id}")
    async def item(item_id: str) -> dict[str, str]:
        return {"id": item_id}

    await client.get("/items/one")
    await client.get("/items/two")

    labels = {"method": "GET", "route": "/items/{item_id}", "status": "200"}
    assert _sample(app, "http_requests_total", labels) == 2.0
    assert _sample(app, "http_request_duration_seconds_count", labels) == 2.0
    body = (await client.get("/metrics")).text
    assert "/items/one" not in body


async def test_unmatched_paths_share_one_label(app: FastAPI, client: AsyncClient) -> None:
    await client.get("/random/a")
    await client.get("/random/b")

    labels = {"method": "GET", "route": UNMATCHED_ROUTE, "status": "404"}
    assert _sample(app, "http_requests_total", labels) == 2.0


async def test_method_not_allowed_keeps_template(app: FastAPI, client: AsyncClient) -> None:
    await client.post("/version")
    labels = {"method": "POST", "route": "/version", "status": "405"}
    assert _sample(app, "http_requests_total", labels) == 1.0


async def test_unhandled_error_recorded_as_500(app: FastAPI) -> None:
    @app.get("/boom/{x}")
    async def boom(x: str) -> None:
        raise RuntimeError(x)

    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://t") as client:
        await client.get("/boom/1")

    labels = {"method": "GET", "route": "/boom/{x}", "status": "500"}
    assert _sample(app, "http_requests_total", labels) == 1.0


async def test_access_log_line(client: AsyncClient, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.DEBUG, logger="shortener.access"):
        await client.get("/version")
        await client.get("/healthz")

    records = {r.__dict__["route"]: r for r in caplog.records if r.name == "shortener.access"}
    assert records["/version"].levelno == logging.INFO
    assert records["/version"].__dict__["status"] == 200
    assert records["/healthz"].levelno == logging.DEBUG


def test_route_template_without_route() -> None:
    assert route_template({"type": "http"}) == UNMATCHED_ROUTE


def test_separate_apps_have_separate_registries(settings: Settings) -> None:
    assert Metrics(settings).registry is not Metrics(settings).registry
