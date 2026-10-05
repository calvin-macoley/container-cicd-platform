"""Application factory."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from shortener.chaos import ChaosInjector
from shortener.config import Settings
from shortener.db import Database, build_engine
from shortener.metrics import Metrics
from shortener.middleware.errors import UnhandledErrorMiddleware
from shortener.middleware.metrics import MetricsMiddleware
from shortener.middleware.request_id import RequestIdMiddleware
from shortener.routes import health, links, meta, redirect

logger = logging.getLogger(__name__)


def create_app(settings: Settings) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        logger.info(
            "starting",
            extra={
                "environment": settings.app_env.value,
                "version": settings.app_version,
                "git_sha": settings.git_sha,
            },
        )
        if settings.chaos_error_rate > 0:
            logger.warning(
                "chaos enabled: a fraction of /api/* requests will fail on purpose",
                extra={"chaos_error_rate": settings.chaos_error_rate},
            )
        yield
        # Runs after uvicorn has drained in-flight requests (SIGTERM handling).
        await db.dispose()
        logger.info("stopped")

    app = FastAPI(title="shortener", version=settings.app_version, lifespan=lifespan)
    app.state.settings = settings
    app.state.metrics = metrics = Metrics(settings)
    app.state.chaos = ChaosInjector(settings.chaos_error_rate)
    app.state.db = db = Database(build_engine(settings))

    app.include_router(health.router)
    app.include_router(meta.router)
    app.include_router(links.router)
    app.include_router(redirect.router)  # catch-all /{code}: must stay last

    # Starlette wraps in reverse order: the last middleware added is outermost.
    # Resulting order: RequestId -> Metrics -> UnhandledError -> routes.
    app.add_middleware(UnhandledErrorMiddleware)
    app.add_middleware(MetricsMiddleware, metrics=metrics)
    app.add_middleware(RequestIdMiddleware)
    return app
