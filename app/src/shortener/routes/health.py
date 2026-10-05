"""Liveness and readiness probes."""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from shortener.deps import DatabaseDep, SettingsDep
from shortener.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/healthz", response_model=HealthResponse)
async def healthz() -> HealthResponse:
    """Liveness: the process is up and serving HTTP. Never touches the database."""
    return HealthResponse(status="ok")


@router.get(
    "/readyz",
    response_model=HealthResponse,
    responses={503: {"model": HealthResponse, "description": "Database unreachable"}},
)
async def readyz(db: DatabaseDep, settings: SettingsDep, response: Response) -> HealthResponse:
    """Readiness: the database answers within READINESS_TIMEOUT_SECONDS."""
    if await db.ping(settings.readiness_timeout_seconds):
        return HealthResponse(status="ready")
    response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return HealthResponse(status="unavailable")
