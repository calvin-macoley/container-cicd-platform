from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest

from shortener.services import links as service
from tests.fakes import FakeLinkRepository

NOW = datetime(2026, 1, 1, tzinfo=UTC)
BASE = "https://sho.rt"


async def _create(repo: FakeLinkRepository, **kwargs: object) -> service.LinkRecord:
    params: dict[str, object] = {
        "target_url": "https://example.com/page",
        "alias": None,
        "expires_at": None,
        "public_base": BASE,
        "now": NOW,
    }
    params.update(kwargs)
    return await service.create_link(repo, **params)  # type: ignore[arg-type]


def test_generate_code_shape() -> None:
    codes = {service.generate_code() for _ in range(200)}
    assert len(codes) == 200
    for code in codes:
        assert len(code) == service.GENERATED_CODE_LENGTH
        assert code.isalnum()


async def test_create_with_generated_code() -> None:
    repo = FakeLinkRepository()
    record = await _create(repo)
    assert len(record.code) == 7
    assert repo.links[record.code].target_url == "https://example.com/page"


async def test_create_with_alias() -> None:
    record = await _create(FakeLinkRepository(), alias="my-link")
    assert record.code == "my-link"


async def test_alias_conflict() -> None:
    repo = FakeLinkRepository()
    await _create(repo, alias="taken")
    with pytest.raises(service.AliasConflictError):
        await _create(repo, alias="taken")


@pytest.mark.parametrize("alias", ["api", "healthz", "METRICS", "version", "readyz", "docs"])
async def test_reserved_alias_rejected(alias: str) -> None:
    with pytest.raises(service.InvalidLinkError, match="reserved"):
        await _create(FakeLinkRepository(), alias=alias)


async def test_self_referencing_url_rejected() -> None:
    with pytest.raises(service.InvalidLinkError, match="must not point at this shortener"):
        await _create(FakeLinkRepository(), target_url="https://SHO.RT/abc")


@pytest.mark.parametrize("delta", [timedelta(0), timedelta(seconds=-1)])
async def test_expiry_must_be_future(delta: timedelta) -> None:
    with pytest.raises(service.InvalidLinkError, match="future"):
        await _create(FakeLinkRepository(), expires_at=NOW + delta)


async def test_generated_code_retries_on_collision_and_reserved() -> None:
    repo = FakeLinkRepository()
    await _create(repo, alias="aaaaaaa")
    codes: Iterator[str] = iter(["aaaaaaa", "healthz", "bbbbbbb"])

    record = await _create(repo, generate=lambda: next(codes))

    assert record.code == "bbbbbbb"
    assert repo.create_calls == ["aaaaaaa", "aaaaaaa", "bbbbbbb"]  # reserved never tried


async def test_generation_gives_up_after_max_attempts() -> None:
    repo = FakeLinkRepository()
    await _create(repo, alias="sameeee")
    with pytest.raises(service.CodeGenerationError):
        await _create(repo, generate=lambda: "sameeee")
    assert len(repo.create_calls) == 1 + service.MAX_GENERATE_ATTEMPTS


async def test_resolve_counts_clicks() -> None:
    repo = FakeLinkRepository()
    record = await _create(repo)

    assert await service.resolve_link(repo, record.code) == "https://example.com/page"
    await service.resolve_link(repo, record.code)

    assert repo.links[record.code].click_count == 2
    assert repo.links[record.code].last_clicked_at is not None


async def test_resolve_missing() -> None:
    with pytest.raises(service.LinkNotFoundError):
        await service.resolve_link(FakeLinkRepository(), "nope")


async def test_resolve_expired_is_not_found_and_not_counted() -> None:
    clock = [NOW]
    repo = FakeLinkRepository(clock=lambda: clock[0])
    record = await _create(repo, expires_at=NOW + timedelta(minutes=5))
    clock[0] = NOW + timedelta(minutes=5)

    with pytest.raises(service.LinkNotFoundError):
        await service.resolve_link(repo, record.code)
    assert repo.links[record.code].click_count == 0


async def test_get_link_includes_expired() -> None:
    clock = [NOW]
    repo = FakeLinkRepository(clock=lambda: clock[0])
    record = await _create(repo, expires_at=NOW + timedelta(seconds=1))
    clock[0] = NOW + timedelta(days=1)

    assert (await service.get_link(repo, record.code)).code == record.code


async def test_get_link_missing() -> None:
    with pytest.raises(service.LinkNotFoundError):
        await service.get_link(FakeLinkRepository(), "nope")


async def test_delete_link() -> None:
    repo = FakeLinkRepository()
    record = await _create(repo)
    await service.delete_link(repo, record.code)
    assert record.code not in repo.links
    with pytest.raises(service.LinkNotFoundError):
        await service.delete_link(repo, record.code)
