from __future__ import annotations

from collections.abc import Callable

import pytest
from httpx import ASGITransport, AsyncClient

from shortener.config import Settings
from shortener.db import Database
from shortener.main import create_app

pytestmark = pytest.mark.integration


async def test_readyz_ready_with_real_database(client: AsyncClient) -> None:
    response = await client.get("/readyz")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


async def test_readyz_unavailable_when_database_unreachable(
    make_settings: Callable[..., Settings],
) -> None:
    # Port 1 on localhost: connection refused immediately.
    settings = make_settings(
        database_url="postgresql://u:p@127.0.0.1:1/none", readiness_timeout_seconds=1
    )
    app = create_app(settings)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
            response = await client.get("/readyz")
            liveness = await client.get("/healthz")
    finally:
        await app.state.db.dispose()

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}
    assert liveness.status_code == 200


async def test_ping_succeeds(settings: Settings) -> None:
    db = Database.from_settings(settings)
    try:
        assert await db.ping(within_seconds=2) is True
    finally:
        await db.dispose()


async def test_readyz_ready_while_request_pool_is_exhausted(
    make_settings: Callable[..., Settings], database_url: str
) -> None:
    settings = make_settings(database_url=database_url, db_pool_size=1, db_max_overflow=0)
    app = create_app(settings)
    try:
        # Hold the only pooled connection, as a busy replica would.
        async with app.state.db.engine.connect() as held:
            assert held is not None
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
                response = await client.get("/readyz")
    finally:
        await app.state.db.dispose()

    assert response.status_code == 200
