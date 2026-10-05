from __future__ import annotations

from httpx import ASGITransport, AsyncClient
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from shortener.logging import request_id_var
from shortener.middleware.request_id import RequestIdMiddleware, resolve_request_id


async def _echo(request: Request) -> JSONResponse:
    return JSONResponse({"ctx": request_id_var.get(), "state": request.state.request_id})


def _client() -> AsyncClient:
    app = Starlette(routes=[Route("/", _echo)])
    app.add_middleware(RequestIdMiddleware)
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def test_generates_id_when_missing() -> None:
    async with _client() as client:
        response = await client.get("/")

    rid = response.headers["x-request-id"]
    assert len(rid) == 32
    assert response.json() == {"ctx": rid, "state": rid}
    assert request_id_var.get() is None


async def test_propagates_valid_incoming_id() -> None:
    async with _client() as client:
        response = await client.get("/", headers={"X-Request-ID": "abc-123.def_4"})

    assert response.headers["x-request-id"] == "abc-123.def_4"
    assert response.json()["ctx"] == "abc-123.def_4"


async def test_replaces_unsafe_incoming_id() -> None:
    async with _client() as client:
        response = await client.get("/", headers={"X-Request-ID": 'bad"id {}'})

    assert response.headers["x-request-id"] != 'bad"id {}'
    assert len(response.headers["x-request-id"]) == 32


def test_resolve_rejects_overlong_id() -> None:
    assert resolve_request_id("a" * 129) != "a" * 129
    assert resolve_request_id("a" * 128) == "a" * 128
    assert resolve_request_id("") != ""
