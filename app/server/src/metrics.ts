/**
 * Prometheus metric definitions.
 *
 * Each app instance owns its registry, so building several apps (tests) never
 * collides on duplicate metric names. Metric names and labels match the Python
 * service, so dashboards and alerts work for either.
 */

import type { Request, Response } from "express";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

import type { Settings } from "./config.js";

export const UNMATCHED_ROUTE = "unmatched";
const LABELS = ["method", "route", "status"] as const;

// Bounded label values whatever method a client sends.
const KNOWN_METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "CONNECT",
  "TRACE",
]);

export function methodLabel(method: string): string {
  return KNOWN_METHODS.has(method) ? method : "OTHER";
}

/**
 * The matched route's path template, never the raw path. Express writes
 * parameters as `:code`; they are reported as `{code}` like the Python service.
 * A middleware can set `res.locals.routeTemplate` for paths that are not routes
 * (static assets).
 */
export function routeTemplate(req: Request, res: Response): string {
  const fromLocals: unknown = res.locals.routeTemplate;
  if (typeof fromLocals === "string") return fromLocals;
  const path: unknown = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof path !== "string") return UNMATCHED_ROUTE;
  return path.replace(/:(\w+)/g, "{$1}");
}

export class Metrics {
  readonly registry = new Registry();
  private readonly requests: Counter<(typeof LABELS)[number]>;
  private readonly latency: Histogram<(typeof LABELS)[number]>;

  constructor(settings: Settings) {
    collectDefaultMetrics({ register: this.registry });

    this.requests = new Counter({
      name: "http_requests_total",
      help: "HTTP requests handled, by method, route template and status code.",
      labelNames: LABELS,
      registers: [this.registry],
    });
    this.latency = new Histogram({
      name: "http_request_duration_seconds",
      help: "HTTP request latency in seconds, by method, route template and status code.",
      labelNames: LABELS,
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
      registers: [this.registry],
    });
    new Gauge({
      name: "app_build_info",
      help: "Always 1; labels identify the running build.",
      labelNames: ["version", "git_sha", "environment"],
      registers: [this.registry],
    }).set(
      { version: settings.appVersion, git_sha: settings.gitSha, environment: settings.appEnv },
      1,
    );
    new Gauge({
      name: "app_chaos_error_rate",
      help: "Configured fraction of /api/* requests that fail on purpose (CHAOS_ERROR_RATE).",
      registers: [this.registry],
    }).set(settings.chaosErrorRate);
  }

  observe(method: string, route: string, status: number, seconds: number): void {
    const labels = { method, route, status: String(status) };
    this.requests.inc(labels);
    this.latency.observe(labels, seconds);
  }

  /**
   * Current value of a sample, or undefined (tests). Histogram series such as
   * `<name>_count` are found on their parent metric.
   */
  async sample(name: string, labels: Record<string, string>): Promise<number | undefined> {
    const parent = name.replace(/_(bucket|count|sum)$/, "");
    const metric = await (
      this.registry.getSingleMetric(name) ?? this.registry.getSingleMetric(parent)
    )?.get();
    const match = metric?.values.find(
      (v) =>
        ((v as { metricName?: string }).metricName ?? metric.name) === name &&
        Object.entries(labels).every(([k, val]) => String(v.labels[k]) === val),
    );
    return match?.value;
  }
}
