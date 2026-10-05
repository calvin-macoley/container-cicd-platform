"""Link business rules: code generation, validation, lookup and deletion."""

from __future__ import annotations

import secrets
import string
from collections.abc import Callable
from datetime import datetime
from urllib.parse import urlsplit

from shortener.repository import CodeConflictError, LinkRecord, LinkRepository

GENERATED_CODE_LENGTH = 7
MAX_GENERATE_ATTEMPTS = 5
ALIAS_PATTERN = r"^[A-Za-z0-9_-]{3,32}$"
_ALPHABET = string.ascii_letters + string.digits

# Top-level paths owned by the service; a link code equal to one of these
# would be unreachable (or would shadow the endpoint), so they are refused.
RESERVED_CODES = frozenset(
    {"api", "healthz", "readyz", "version", "metrics", "docs", "redoc", "openapi.json"}
)


class LinkNotFoundError(Exception):
    """No such link (or, for redirects, the link has expired)."""


class AliasConflictError(Exception):
    """The requested custom alias is already in use."""


class InvalidLinkError(ValueError):
    """The request is well-formed but breaks a business rule."""


class CodeGenerationError(RuntimeError):
    """Could not find a free code; indicates the code space is too crowded."""


def generate_code() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(GENERATED_CODE_LENGTH))


def is_reserved(code: str) -> bool:
    return code.lower() in RESERVED_CODES


def _host(url: str) -> str:
    return (urlsplit(url).hostname or "").lower()


def _validate(
    target_url: str, alias: str | None, expires_at: datetime | None, public_base: str, now: datetime
) -> None:
    if alias is not None and is_reserved(alias):
        raise InvalidLinkError(f"alias '{alias}' is reserved")
    if _host(target_url) == _host(public_base):
        raise InvalidLinkError("url must not point at this shortener")
    if expires_at is not None and expires_at <= now:
        raise InvalidLinkError("expires_at must be in the future")


async def create_link(
    repo: LinkRepository,
    *,
    target_url: str,
    alias: str | None,
    expires_at: datetime | None,
    public_base: str,
    now: datetime,
    generate: Callable[[], str] | None = None,
) -> LinkRecord:
    _validate(target_url, alias, expires_at, public_base, now)
    generate = generate or generate_code

    if alias is not None:
        try:
            return await repo.create(alias, target_url, expires_at)
        except CodeConflictError:
            raise AliasConflictError(alias) from None

    for _ in range(MAX_GENERATE_ATTEMPTS):
        code = generate()
        if is_reserved(code):
            continue
        try:
            return await repo.create(code, target_url, expires_at)
        except CodeConflictError:
            continue
    raise CodeGenerationError(f"no free code after {MAX_GENERATE_ATTEMPTS} attempts")


async def resolve_link(repo: LinkRepository, code: str) -> str:
    """Return the redirect target and count the click; expired links are not found."""
    target = await repo.resolve_and_count(code)
    if target is None:
        raise LinkNotFoundError(code)
    return target


async def peek_link(repo: LinkRepository, code: str) -> str:
    """Return the redirect target without counting a click (HEAD requests)."""
    target = await repo.get_active_target(code)
    if target is None:
        raise LinkNotFoundError(code)
    return target


async def get_link(repo: LinkRepository, code: str) -> LinkRecord:
    """Return link details, including expired links (management view)."""
    record = await repo.get(code)
    if record is None:
        raise LinkNotFoundError(code)
    return record


async def delete_link(repo: LinkRepository, code: str) -> None:
    if not await repo.delete(code):
        raise LinkNotFoundError(code)
