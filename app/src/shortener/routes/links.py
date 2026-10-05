"""Link management API (/api/links)."""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status

from shortener.chaos import inject_chaos
from shortener.deps import RepositoryDep, SettingsDep
from shortener.repository import LinkRecord
from shortener.schemas import LinkCreate, LinkResponse
from shortener.services import links as service

logger = logging.getLogger(__name__)

# Chaos applies to every /api/* route (see shortener.chaos).
router = APIRouter(prefix="/api/links", tags=["links"], dependencies=[Depends(inject_chaos)])

NOT_FOUND = "Link not found"


def to_response(record: LinkRecord, public_base: str, now: datetime) -> LinkResponse:
    return LinkResponse(
        code=record.code,
        short_url=f"{public_base}/{record.code}",
        target_url=record.target_url,
        created_at=record.created_at,
        expires_at=record.expires_at,
        is_expired=record.expires_at is not None and record.expires_at <= now,
        click_count=record.click_count,
        last_clicked_at=record.last_clicked_at,
    )


@router.post("", status_code=status.HTTP_201_CREATED, response_model=LinkResponse)
async def create_link(
    body: LinkCreate, repo: RepositoryDep, settings: SettingsDep, response: Response
) -> LinkResponse:
    now = datetime.now(UTC)
    try:
        record = await service.create_link(
            repo,
            target_url=str(body.url),
            alias=body.alias,
            expires_at=body.expires_at,
            public_base=settings.public_base,
            now=now,
        )
    except service.InvalidLinkError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from None
    except service.AliasConflictError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Alias already in use") from None
    except service.CodeGenerationError:
        logger.error(
            "could not generate a free code", extra={"attempts": service.MAX_GENERATE_ATTEMPTS}
        )
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Could not allocate a short code; retry"
        ) from None
    response.headers["Location"] = f"/api/links/{record.code}"
    return to_response(record, settings.public_base, now)


@router.get("/{code}", response_model=LinkResponse)
async def get_link(code: str, repo: RepositoryDep, settings: SettingsDep) -> LinkResponse:
    try:
        record = await service.get_link(repo, code)
    except service.LinkNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND) from None
    return to_response(record, settings.public_base, datetime.now(UTC))


@router.delete("/{code}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_link(code: str, repo: RepositoryDep) -> None:
    try:
        await service.delete_link(repo, code)
    except service.LinkNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND) from None
