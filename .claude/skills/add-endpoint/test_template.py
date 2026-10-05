import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def test_<name>_success(client: AsyncClient) -> None:
    ...


async def test_<name>_validation_error(client: AsyncClient) -> None:
    ...


async def test_<name>_not_found(client: AsyncClient) -> None:
    ...
