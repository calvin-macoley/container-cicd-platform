from __future__ import annotations

from collections.abc import Callable

from httpx import ASGITransport, AsyncClient

from shortener.config import Settings
from shortener.main import create_app


async def test_version_success(client: AsyncClient) -> None:
    response = await client.get("/version")

    assert response.status_code == 200
    assert response.json() == {"version": "1.2.3", "git_sha": "abc1234", "environment": "test"}


async def test_version_reflects_settings_exactly(make_settings: Callable[..., Settings]) -> None:
    settings = make_settings(
        app_env="staging", app_version="2.0.0-rc.1", git_sha="0123456789abcdef"
    )
    transport = ASGITransport(app=create_app(settings))
    async with AsyncClient(transport=transport, base_url="http://t") as client:
        response = await client.get("/version")

    assert response.json() == {
        "version": "2.0.0-rc.1",
        "git_sha": "0123456789abcdef",
        "environment": "staging",
    }


async def test_version_method_not_allowed(client: AsyncClient) -> None:
    assert (await client.delete("/version")).status_code == 405
