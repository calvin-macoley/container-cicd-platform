"""Container entrypoint: ``python -m shortener``.

Validates configuration, configures JSON logging, then serves on
0.0.0.0:$PORT. On SIGTERM (or SIGINT) uvicorn stops accepting connections,
lets in-flight requests finish (up to SHUTDOWN_TIMEOUT_SECONDS), runs the
app's shutdown hook (closes database connections), and the process exits 0.

Exit codes: 0 = clean shutdown, 78 = invalid configuration, other = crash.
"""

from __future__ import annotations

import logging
import signal
import sys

import uvicorn

from shortener.config import ConfigError, load_settings
from shortener.logging import configure_logging
from shortener.main import create_app

logger = logging.getLogger("shortener")

EXIT_CONFIG_ERROR = 78  # EX_CONFIG from sysexits.h
_SHUTDOWN_SIGNALS = (signal.SIGTERM, signal.SIGINT)


def _ignore_shutdown_signals_after_serving() -> None:
    """Make a graceful shutdown exit 0, whether or not we are PID 1.

    uvicorn installs its own handlers while serving, then restores the previous
    ones and re-raises the signal it received. With the default handler that
    kills the process with 143 (130 and a traceback for SIGINT), except as
    PID 1, where the kernel drops the signal and we exit 0. Restoring
    "ignore" instead makes the re-raise a no-op in both cases.
    """
    for sig in _SHUTDOWN_SIGNALS:
        signal.signal(sig, signal.SIG_IGN)


def main() -> int:
    try:
        settings = load_settings()
    except ConfigError as exc:
        configure_logging("INFO")
        logger.critical(str(exc))
        return EXIT_CONFIG_ERROR

    configure_logging(settings.log_level.value)
    app = create_app(settings)
    _ignore_shutdown_signals_after_serving()
    uvicorn.run(
        app,
        host="0.0.0.0",  # noqa: S104 - must be reachable from outside the container
        port=settings.port,
        log_config=None,  # keep our JSON logging
        access_log=False,  # the app writes its own access log
        server_header=False,
        timeout_graceful_shutdown=settings.shutdown_timeout_seconds,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
