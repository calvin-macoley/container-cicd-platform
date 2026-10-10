import { describe, expect, it } from "vitest";

import { child, createLogger, requestContext } from "../../src/logging.js";
import { captureLogger } from "../helpers.js";

describe("JSON logging", () => {
  it("writes the Python service's line shape", () => {
    const { logger, lines } = captureLogger();

    requestContext.run({ requestId: "req-1" }, () => {
      child(logger, "test").info({ route: "/x", status: 200 }, "hello");
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      message: "hello",
      level: "INFO",
      logger: "shortener.test",
      request_id: "req-1",
      route: "/x",
      status: 200,
    });
    expect(lines[0]?.timestamp).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(lines[0]).not.toHaveProperty("pid");
    expect(lines[0]).not.toHaveProperty("hostname");
  });

  it("writes each key once, even for nested child loggers", () => {
    const chunks: string[] = [];
    const root = createLogger("INFO", { write: (chunk: string) => chunks.push(chunk) });
    child(child(root, "outer"), "inner").info("x");
    root.info("y");

    const keys = (line: string) => [...line.matchAll(/"(\w+)":/g)].map((m) => m[1]);
    for (const line of chunks) {
      expect(keys(line)).toEqual([...new Set(keys(line))]);
    }
    expect(chunks.map((line) => (JSON.parse(line) as { logger: string }).logger)).toEqual([
      "shortener.inner",
      "shortener",
    ]);
  });

  it("has a null request_id outside a request", () => {
    const { logger, lines } = captureLogger();
    logger.info("x");
    expect(lines[0]?.request_id).toBeNull();
  });

  it("includes exception details", () => {
    const { logger, lines } = captureLogger();
    logger.error({ exc_info: new TypeError("boom") }, "failed");
    expect(lines[0]?.exc_info).toMatchObject({ type: "TypeError", message: "boom" });
    expect(String((lines[0]?.exc_info as { stack: string }).stack)).toContain("TypeError: boom");
  });

  it("keeps a multi-line message on one line", () => {
    const chunks: string[] = [];
    createLogger("INFO", { write: (chunk: string) => chunks.push(chunk) }).info("a\nb");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.trimEnd()).not.toContain("\n");
  });

  it("filters below the configured level and names levels like Python", () => {
    const { logger, lines } = captureLogger("WARNING");
    logger.info("hidden");
    logger.warn("shown");
    logger.fatal("fatal");
    expect(lines.map((line) => [line.message, line.level])).toEqual([
      ["shown", "WARNING"],
      ["fatal", "CRITICAL"],
    ]);
  });
});
