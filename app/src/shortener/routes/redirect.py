"""Public short-link redirect: GET and HEAD /{code}. Registered last (catch-all)."""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import RedirectResponse

from shortener.deps import RepositoryDep
from shortener.repository import LinkRepository
from shortener.services import links as service

router = APIRouter(tags=["redirect"])

_VALID_CODE = re.compile(service.ALIAS_PATTERN)
_NOT_FOUND = "Link not found"


async def _redirect_to(
    code: str,
    repo: LinkRepository,
    lookup: Callable[[LinkRepository, str], Awaitable[str]],
) -> RedirectResponse:
    # Paths that can never be a code (e.g. /favicon.ico) skip the database.
    if not _VALID_CODE.fullmatch(code) or service.is_reserved(code):
        raise HTTPException(status.HTTP_404_NOT_FOUND, _NOT_FOUND)
    try:
        target = await lookup(repo, code)
    except service.LinkNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, _NOT_FOUND) from None
    # no-store: every visit must reach us so the click is counted.
    return RedirectResponse(
        target,
        status_code=status.HTTP_307_TEMPORARY_REDIRECT,
        headers={"Cache-Control": "no-store"},
    )


@router.get("/{code}", response_class=RedirectResponse, status_code=307)
async def redirect(code: str, repo: RepositoryDep) -> RedirectResponse:
    """Follow a short link and count the click."""
    return await _redirect_to(code, repo, service.resolve_link)


@router.head("/{code}", response_class=RedirectResponse, status_code=307)
async def redirect_head(code: str, repo: RepositoryDep) -> RedirectResponse:
    """Same response as GET, without counting a click (link checkers, unfurlers)."""
    return await _redirect_to(code, repo, service.peek_link)
