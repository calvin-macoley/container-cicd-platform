"""Build metadata and metrics."""

from __future__ import annotations

from typing import cast

from fastapi import APIRouter, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from shortener.deps import SettingsDep
from shortener.metrics import Metrics
from shortener.schemas import VersionResponse

router = APIRouter(tags=["meta"])


@router.get("/version", response_model=VersionResponse)
async def version(settings: SettingsDep) -> VersionResponse:
    """Identify the running build (used to verify canary releases)."""
    return VersionResponse(
        version=settings.app_version,
        git_sha=settings.git_sha,
        environment=settings.app_env.value,
    )


@router.get("/metrics", include_in_schema=False)
async def metrics(request: Request) -> Response:
    """Prometheus exposition format."""
    registry = cast(Metrics, request.app.state.metrics).registry
    return Response(generate_latest(registry), media_type=CONTENT_TYPE_LATEST)
