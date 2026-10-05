from __future__ import annotations

import io
import json
import logging
import sys

import pytest

from shortener.logging import JsonFormatter, configure_logging, request_id_var


def _record(msg: str = "hello", **extra: object) -> logging.LogRecord:
    record = logging.LogRecord("shortener.test", logging.INFO, __file__, 1, msg, None, None)
    for key, value in extra.items():
        setattr(record, key, value)
    return record


def test_formats_json_with_request_id() -> None:
    token = request_id_var.set("req-1")
    try:
        line = JsonFormatter().format(_record(route="/x", status=200))
    finally:
        request_id_var.reset(token)

    data = json.loads(line)
    assert data["message"] == "hello"
    assert data["level"] == "INFO"
    assert data["logger"] == "shortener.test"
    assert data["request_id"] == "req-1"
    assert data["route"] == "/x"
    assert data["status"] == 200
    assert data["timestamp"].endswith("+00:00")


def test_request_id_null_outside_request() -> None:
    assert json.loads(JsonFormatter().format(_record()))["request_id"] is None


def test_exception_info_included() -> None:
    try:
        raise ValueError("boom")
    except ValueError:
        record = logging.LogRecord("x", logging.ERROR, __file__, 1, "failed", None, sys.exc_info())

    data = json.loads(JsonFormatter().format(record))
    assert "ValueError: boom" in data["exc_info"]


def test_message_with_newline_stays_one_line() -> None:
    assert "\n" not in JsonFormatter().format(_record("a\nb"))


def test_configure_logging_writes_json_to_stdout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    buffer = io.StringIO()
    monkeypatch.setattr("sys.stdout", buffer)
    root = logging.getLogger()
    saved_handlers, saved_level = root.handlers[:], root.level
    try:
        configure_logging("INFO")
        logging.getLogger("uvicorn.error").info("from uvicorn")
        logging.getLogger("shortener").debug("hidden")
    finally:
        root.handlers[:] = saved_handlers
        root.setLevel(saved_level)

    lines = [json.loads(line) for line in buffer.getvalue().splitlines()]
    assert [line["message"] for line in lines] == ["from uvicorn"]
    assert logging.getLogger("uvicorn.access").disabled


def test_uvicorn_color_message_dropped() -> None:
    data = json.loads(
        JsonFormatter().format(_record("Started", color_message="\x1b[36mStarted\x1b[0m"))
    )
    assert "color_message" not in data
    assert data["message"] == "Started"
