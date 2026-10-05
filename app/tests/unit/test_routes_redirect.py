from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from shortener.services.links import RESERVED_CODES
from tests.fakes import FakeLinkRepository


async def test_redirect_success(client: AsyncClient, repo: FakeLinkRepository) -> None:
    await client.post("/api/links", json={"url": "https://example.com/dest", "alias": "goto"})

    response = await client.get("/goto")

    assert response.status_code == 307
    assert response.headers["location"] == "https://example.com/dest"
    assert response.headers["cache-control"] == "no-store"
    assert repo.links["goto"].click_count == 1


@pytest.mark.parametrize("path", ["/favicon.ico", "/ab", "/" + "a" * 33, "/api", "/docs-x.y"])
async def test_redirect_invalid_code_is_404_without_lookup(
    client: AsyncClient, repo: FakeLinkRepository, path: str
) -> None:
    response = await client.get(path)
    assert response.status_code == 404
    assert repo.resolve_calls == []


async def test_redirect_not_found(client: AsyncClient) -> None:
    response = await client.get("/missing1")
    assert response.status_code == 404
    assert response.json() == {"detail": "Link not found"}


async def test_redirect_expired_is_404(client: AsyncClient, repo: FakeLinkRepository) -> None:
    await client.post("/api/links", json={"url": "https://example.com", "alias": "stale"})
    repo.links["stale"] = replace(
        repo.links["stale"], expires_at=datetime.now(UTC) - timedelta(seconds=1)
    )

    assert (await client.get("/stale")).status_code == 404
    assert repo.links["stale"].click_count == 0


async def test_reserved_paths_still_reach_their_endpoints(client: AsyncClient) -> None:
    for path in ("/healthz", "/version", "/metrics", "/openapi.json"):
        assert (await client.get(path)).status_code == 200, path


def test_reserved_codes_cover_every_top_level_route(app: FastAPI) -> None:
    """A new top-level route must be added to RESERVED_CODES, or a link could shadow it."""
    first_segments = {
        path.strip("/").split("/")[0]
        for route in app.routes
        if (path := getattr(route, "path", "")) and not path.startswith("/{")
    }
    assert first_segments <= RESERVED_CODES, first_segments - RESERVED_CODES
