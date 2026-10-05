from __future__ import annotations

import logging
from collections.abc import Callable

import pytest
from fastapi import APIRouter, Depends, FastAPI
from httpx import ASGITransport, AsyncClient

from shortener.chaos import CHAOS_DETAIL, ChaosInjector, inject_chaos
from shortener.config import Settings
from shortener.main import create_app
from shortener.metrics import Metrics


def _app_with_api_route(settings: Settings, rng: Callable[[], float]) -> FastAPI:
    app = create_app(settings)
    app.state.chaos = ChaosInjector(settings.chaos_error_rate, rng=rng)
    api = APIRouter(prefix="/api", dependencies=[Depends(inject_chaos)])

    @api.get("/things/{thing_id}")
    async def thing(thing_id: str) -> dict[str, str]:
        return {"id": thing_id}

    app.include_router(api)
    return app


async def _get(app: FastAPI, path: str) -> tuple[int, dict[str, object]]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        response = await client.get(path)
    return response.status_code, response.json()


async def test_failure_injected_below_rate(
    make_settings: Callable[..., Settings], caplog: pytest.LogCaptureFixture
) -> None:
    app = _app_with_api_route(make_settings(chaos_error_rate=0.5), rng=lambda: 0.49)

    with caplog.at_level(logging.WARNING, logger="shortener.chaos"):
        status, body = await _get(app, "/api/things/1")

    assert status == 500
    assert body == {"detail": CHAOS_DETAIL}
    assert any(r.__dict__.get("chaos") is True for r in caplog.records)
    metrics: Metrics = app.state.metrics
    labels = {"method": "GET", "route": "/api/things/{thing_id}", "status": "500"}
    assert metrics.registry.get_sample_value("http_requests_total", labels) == 1.0


async def test_no_failure_at_or_above_rate(make_settings: Callable[..., Settings]) -> None:
    app = _app_with_api_route(make_settings(chaos_error_rate=0.5), rng=lambda: 0.5)
    assert await _get(app, "/api/things/1") == (200, {"id": "1"})


async def test_zero_rate_never_fails(make_settings: Callable[..., Settings]) -> None:
    app = _app_with_api_route(make_settings(), rng=lambda: 0.0)
    assert (await _get(app, "/api/things/1"))[0] == 200


async def test_non_api_routes_unaffected(make_settings: Callable[..., Settings]) -> None:
    app = _app_with_api_route(make_settings(chaos_error_rate=1.0), rng=lambda: 0.0)
    for path in ("/healthz", "/version", "/metrics"):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
            assert (await client.get(path)).status_code == 200


async def test_startup_warns_when_enabled(
    make_settings: Callable[..., Settings], caplog: pytest.LogCaptureFixture
) -> None:
    app = create_app(make_settings(chaos_error_rate=0.25))
    with caplog.at_level(logging.WARNING, logger="shortener"):
        async with app.router.lifespan_context(app):
            pass
    assert any("chaos enabled" in r.getMessage() for r in caplog.records)


def test_injector_rate_one_always_fails() -> None:
    assert ChaosInjector(1.0).should_fail()
    assert not ChaosInjector(0.0).should_fail()
