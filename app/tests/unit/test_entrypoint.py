from __future__ import annotations

import json
import logging
import signal
import socket
import subprocess
import sys
import time
import urllib.request
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import FastAPI

from shortener import __main__ as entrypoint
from tests.conftest import VALID_ENV


@pytest.fixture(autouse=True)
def _restore_process_state() -> Iterator[None]:
    """main() reconfigures the root logger and signal handlers; restore both."""
    root = logging.getLogger()
    saved_handlers, saved_level = root.handlers[:], root.level
    saved_signals = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)}
    yield
    root.handlers[:] = saved_handlers
    root.setLevel(saved_level)
    for sig, handler in saved_signals.items():
        signal.signal(sig, handler)


def test_main_starts_uvicorn_with_settings(clean_env: pytest.MonkeyPatch) -> None:
    for name, value in {**VALID_ENV, "PORT": "9123", "SHUTDOWN_TIMEOUT_SECONDS": "7"}.items():
        clean_env.setenv(name, value)
    calls: list[tuple[Any, dict[str, Any]]] = []
    clean_env.setattr(entrypoint.uvicorn, "run", lambda app, **kw: calls.append((app, kw)))

    assert entrypoint.main() == 0

    app, kwargs = calls[0]
    assert isinstance(app, FastAPI)
    assert kwargs["host"] == "0.0.0.0"  # noqa: S104
    assert kwargs["port"] == 9123
    assert kwargs["timeout_graceful_shutdown"] == 7
    assert kwargs["log_config"] is None


def test_main_exits_with_json_error_on_bad_config(
    clean_env: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Read stdout via capsys: pytest re-installs its own sys.stdout when the
    # test body starts, so patching sys.stdout in a fixture would be undone.
    clean_env.setattr(entrypoint.uvicorn, "run", lambda *a, **k: pytest.fail("must not start"))

    assert entrypoint.main() == entrypoint.EXIT_CONFIG_ERROR

    line = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert line["level"] == "CRITICAL"
    assert "APP_ENV: required environment variable is not set" in line["message"]


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.mark.parametrize("sig", [signal.SIGTERM, signal.SIGINT])
def test_real_process_shuts_down_cleanly_on_signal(sig: signal.Signals) -> None:
    """Run ``python -m shortener`` for real: a signal must give exit 0 and no stderr."""
    port = _free_port()
    env = {
        **VALID_ENV,
        # Never contacted: the app does not connect to the database at startup.
        "DATABASE_URL": "postgresql://u:p@127.0.0.1:1/none",
        "PORT": str(port),
    }
    proc = subprocess.Popen(
        [sys.executable, "-m", "shortener"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        deadline = time.monotonic() + 10
        while True:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=1):
                    break
            except OSError:
                if time.monotonic() > deadline or proc.poll() is not None:
                    pytest.fail("server did not become healthy")
                time.sleep(0.05)

        proc.send_signal(sig)
        stdout, stderr = proc.communicate(timeout=10)
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.communicate()

    assert proc.returncode == 0
    assert stderr == b""
    messages = [json.loads(line)["message"] for line in stdout.decode().splitlines()]
    assert "stopped" in messages
