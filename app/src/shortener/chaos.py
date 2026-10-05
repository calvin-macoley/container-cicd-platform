"""Deliberate failure injection for canary-rollback demos.

When CHAOS_ERROR_RATE > 0, that fraction of /api/* requests returns 500
before the handler runs. It is a dependency on the /api router rather than a
middleware so the route is already matched and the failure is recorded under
its real route template in metrics. Health, version, metrics and redirect
endpoints are never affected. Refused in prod unless CHAOS_ALLOW_IN_PROD=true
(enforced in config.py).
"""

from __future__ import annotations

import logging
import random
from collections.abc import Callable
from typing import cast

from fastapi import HTTPException, Request

logger = logging.getLogger(__name__)

CHAOS_DETAIL = "Injected failure (chaos)"


class ChaosInjector:
    def __init__(self, rate: float, rng: Callable[[], float] = random.random) -> None:
        self.rate = rate
        self.rng = rng  # not security-sensitive; injectable for tests

    def should_fail(self) -> bool:
        return self.rate > 0 and self.rng() < self.rate


async def inject_chaos(request: Request) -> None:
    """Router dependency: fail this request on purpose, at the configured rate."""
    injector = cast(ChaosInjector, request.app.state.chaos)
    if injector.should_fail():
        logger.warning("chaos: injected failure", extra={"chaos": True})
        raise HTTPException(status_code=500, detail=CHAOS_DETAIL)
