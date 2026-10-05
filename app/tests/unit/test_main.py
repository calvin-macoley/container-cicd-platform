from __future__ import annotations

import logging

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient


def _add_crashing_route(app: FastAPI) -> None:
    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("kaboom")


async def test_unhandled_error_returns_json_500_with_request_id(
    app: FastAPI, caplog: pytest.LogCaptureFixture
) -> None:
    _add_crashing_route(app)
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://t") as client:
        with caplog.at_level(logging.ERROR):
            response = await client.get("/boom", headers={"X-Request-ID": "trace-me"})

    assert response.status_code == 500
    assert response.json() == {"detail": "Internal Server Error"}
    assert response.headers["x-request-id"] == "trace-me"
    assert any("kaboom" in (r.exc_text or "") or r.exc_info for r in caplog.records)


async def test_lifespan_logs_start_and_stop(app: FastAPI, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO, logger="shortener"):
        async with app.router.lifespan_context(app):
            pass

    messages = [r.getMessage() for r in caplog.records]
    assert "starting" in messages
    assert "stopped" in messages


async def test_unknown_path_is_404(client: AsyncClient) -> None:
    assert (await client.get("/does/not/exist")).status_code == 404
