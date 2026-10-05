"""Public short-link redirect (GET /{code}). Registered last so it never shadows other routes."""

from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import RedirectResponse

from shortener.deps import RepositoryDep
from shortener.services import links as service

router = APIRouter(tags=["redirect"])

_VALID_CODE = re.compile(service.ALIAS_PATTERN)


@router.get("/{code}", response_class=RedirectResponse, status_code=307)
async def redirect(code: str, repo: RepositoryDep) -> RedirectResponse:
    # Paths that can never be a code (e.g. /favicon.ico) skip the database.
    if not _VALID_CODE.fullmatch(code) or service.is_reserved(code):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Link not found")
    try:
        target = await service.resolve_link(repo, code)
    except service.LinkNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Link not found") from None
    # no-store: every visit must reach us so the click is counted.
    return RedirectResponse(
        target,
        status_code=status.HTTP_307_TEMPORARY_REDIRECT,
        headers={"Cache-Control": "no-store"},
    )
