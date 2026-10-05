from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from shortener.metrics import Metrics
from tests.fakes import FakeLinkRepository


def _future(**delta: float) -> str:
    return (datetime.now(UTC) + timedelta(**delta)).isoformat()


# --- POST /api/links ---------------------------------------------------------


async def test_create_link_success(client: AsyncClient) -> None:
    response = await client.post("/api/links", json={"url": "https://example.com/a?b=c"})

    assert response.status_code == 201
    body = response.json()
    assert body["target_url"] == "https://example.com/a?b=c"
    assert body["short_url"] == f"https://sho.rt/{body['code']}"
    assert body["click_count"] == 0
    assert body["is_expired"] is False
    assert body["expires_at"] is None
    assert response.headers["location"] == f"/api/links/{body['code']}"


async def test_create_link_with_alias_and_expiry(client: AsyncClient) -> None:
    expires = _future(hours=1)
    response = await client.post(
        "/api/links",
        json={"url": "https://example.com", "alias": "promo_2026", "expires_at": expires},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["code"] == "promo_2026"
    assert datetime.fromisoformat(body["expires_at"]) == datetime.fromisoformat(expires)


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"url": "not a url"},
        {"url": "ftp://example.com/file"},
        {"url": "javascript:alert(1)"},
        {"url": "https://example.com/" + "a" * 2048},
        {"url": "https://example.com", "alias": "ab"},
        {"url": "https://example.com", "alias": "a" * 33},
        {"url": "https://example.com", "alias": "has space"},
        {"url": "https://example.com", "alias": "slash/no"},
        {"url": "https://example.com", "expires_at": "2030-01-01T00:00:00"},  # naive
        {"url": "https://example.com", "unexpected": 1},
    ],
)
async def test_create_link_validation_error(
    client: AsyncClient, payload: dict[str, object]
) -> None:
    assert (await client.post("/api/links", json=payload)).status_code == 422


@pytest.mark.parametrize(
    ("payload", "detail"),
    [
        ({"url": "https://example.com", "alias": "healthz"}, "reserved"),
        ({"url": "https://sho.rt/loop"}, "must not point at this shortener"),
        ({"url": "https://example.com", "expires_at": "2000-01-01T00:00:00Z"}, "future"),
    ],
)
async def test_create_link_business_rule_violation(
    client: AsyncClient, payload: dict[str, object], detail: str
) -> None:
    response = await client.post("/api/links", json=payload)
    assert response.status_code == 422
    assert detail in response.json()["detail"]


async def test_create_link_alias_conflict(client: AsyncClient) -> None:
    payload = {"url": "https://example.com", "alias": "dup"}
    assert (await client.post("/api/links", json=payload)).status_code == 201

    response = await client.post("/api/links", json=payload)

    assert response.status_code == 409
    assert response.json() == {"detail": "Alias already in use"}


async def test_create_link_code_space_exhausted_returns_503(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("shortener.services.links.generate_code", lambda: "fixed01")
    assert (await client.post("/api/links", json={"url": "https://example.com"})).status_code == 201

    response = await client.post("/api/links", json={"url": "https://example.com"})

    assert response.status_code == 503
    assert response.json() == {"detail": "Could not allocate a short code; retry"}


# --- GET /api/links/{code} ---------------------------------------------------


async def test_get_link_success(client: AsyncClient) -> None:
    await client.post("/api/links", json={"url": "https://example.com", "alias": "info"})
    await client.get("/info")

    response = await client.get("/api/links/info")

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == "info"
    assert body["click_count"] == 1
    assert body["last_clicked_at"] is not None


async def test_get_link_expired_still_visible(
    client: AsyncClient, repo: FakeLinkRepository
) -> None:
    await client.post("/api/links", json={"url": "https://example.com", "alias": "old"})
    expired = datetime.now(UTC) - timedelta(seconds=1)
    repo.links["old"] = replace(repo.links["old"], expires_at=expired)

    response = await client.get("/api/links/old")

    assert response.status_code == 200
    assert response.json()["is_expired"] is True
    assert (await client.get("/old")).status_code == 404


async def test_get_link_not_found(client: AsyncClient) -> None:
    response = await client.get("/api/links/missing")
    assert response.status_code == 404
    assert response.json() == {"detail": "Link not found"}


async def test_get_link_method_not_allowed(client: AsyncClient) -> None:
    assert (await client.put("/api/links/x", json={})).status_code == 405


# --- DELETE /api/links/{code} ------------------------------------------------


async def test_delete_link_success(client: AsyncClient) -> None:
    await client.post("/api/links", json={"url": "https://example.com", "alias": "gone"})

    response = await client.delete("/api/links/gone")

    assert response.status_code == 204
    assert response.content == b""
    assert (await client.get("/api/links/gone")).status_code == 404
    assert (await client.get("/gone")).status_code == 404


async def test_delete_link_not_found(client: AsyncClient) -> None:
    assert (await client.delete("/api/links/missing")).status_code == 404


async def test_delete_collection_not_allowed(client: AsyncClient) -> None:
    assert (await client.delete("/api/links")).status_code == 405


# --- metrics and chaos on the real routes ------------------------------------


async def test_link_routes_labelled_by_template(app: FastAPI, client: AsyncClient) -> None:
    await client.post("/api/links", json={"url": "https://example.com", "alias": "m01"})
    await client.get("/api/links/m01")
    await client.get("/m01")
    await client.delete("/api/links/m01")

    metrics: Metrics = app.state.metrics
    for method, route, status in [
        ("POST", "/api/links", "201"),
        ("GET", "/api/links/{code}", "200"),
        ("GET", "/{code}", "307"),
        ("DELETE", "/api/links/{code}", "204"),
    ]:
        labels = {"method": method, "route": route, "status": status}
        assert metrics.registry.get_sample_value("http_requests_total", labels) == 1.0
    body = (await client.get("/metrics")).text
    assert 'route="/api/links/m01"' not in body
    assert 'route="/m01"' not in body


async def test_chaos_applies_to_link_api_only(app: FastAPI, client: AsyncClient) -> None:
    app.state.chaos.rate = 1.0
    app.state.chaos.rng = lambda: 0.0

    create = await client.post("/api/links", json={"url": "https://example.com"})
    redirect = await client.get("/whatever")

    assert create.status_code == 500
    assert create.json() == {"detail": "Injected failure (chaos)"}
    assert redirect.status_code == 404  # reached the handler, not chaos
