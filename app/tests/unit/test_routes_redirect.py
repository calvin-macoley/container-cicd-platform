from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from shortener.metrics import Metrics
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


# --- HEAD /{code} ------------------------------------------------------------


async def test_head_redirect_same_response_without_counting(
    client: AsyncClient, repo: FakeLinkRepository
) -> None:
    await client.post("/api/links", json={"url": "https://example.com/dest", "alias": "peek"})
    get_response = await client.get("/peek")
    after_get = repo.links["peek"]
    assert after_get.click_count == 1

    head_response = await client.head("/peek")

    assert head_response.status_code == get_response.status_code == 307
    assert head_response.headers["location"] == get_response.headers["location"]
    assert head_response.headers["cache-control"] == "no-store"
    assert head_response.content == b""
    # HEAD changed nothing: same count, same last-click time.
    assert repo.links["peek"] == after_get


async def test_head_redirect_not_found(client: AsyncClient) -> None:
    assert (await client.head("/missing1")).status_code == 404


async def test_head_redirect_invalid_code_skips_lookup(
    client: AsyncClient, repo: FakeLinkRepository
) -> None:
    assert (await client.head("/favicon.ico")).status_code == 404
    assert repo.resolve_calls == []


async def test_head_redirect_expired_is_404(client: AsyncClient, repo: FakeLinkRepository) -> None:
    await client.post("/api/links", json={"url": "https://example.com", "alias": "gone1"})
    repo.links["gone1"] = replace(
        repo.links["gone1"], expires_at=datetime.now(UTC) - timedelta(seconds=1)
    )
    assert (await client.head("/gone1")).status_code == 404


async def test_head_labelled_by_route_template(app: FastAPI, client: AsyncClient) -> None:
    await client.post("/api/links", json={"url": "https://example.com", "alias": "hd1"})
    await client.head("/hd1")

    metrics: Metrics = app.state.metrics
    labels = {"method": "HEAD", "route": "/{code}", "status": "307"}
    assert metrics.registry.get_sample_value("http_requests_total", labels) == 1.0
