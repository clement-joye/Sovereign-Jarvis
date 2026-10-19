import { describe, expect, it } from "vitest";

import { InternalApiRoutes, type HttpMethod } from "./internal-api-routes.js";

/**
 * The route spec is the source of truth for OpenAPI generation and the
 * route coverage check. These tests guard the spec itself: every
 * (method, path) pair must be unique, paths must be unique, and the
 * operation ids must be unique across the dataset.
 */
describe("internal-api-routes", () => {
  it("contains at least one route for every public resource", () => {
    const paths = new Set(InternalApiRoutes.map((route) => route.path));
    expect(paths.has("/v1/inbound/matrix")).toBe(true);
    expect(paths.has("/v1/outbound")).toBe(true);
    expect(paths.has("/v1/jobs/claim")).toBe(true);
    expect(paths.has("/v1/schedules/{id}/run")).toBe(true);
    expect(paths.has("/v1/sessions/{id}/close")).toBe(true);
    expect(paths.has("/v1/admin/status")).toBe(true);
    expect(paths.has("/v1/admin/retention/run")).toBe(true);
  });

  it("uses unique (method, path) pairs", () => {
    const seen = new Set<string>();
    for (const route of InternalApiRoutes) {
      const key = `${route.method.toUpperCase()} ${route.path}`;
      expect(seen.has(key), `duplicate (method, path) pair: ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("uses unique operation ids", () => {
    const seen = new Set<string>();
    for (const route of InternalApiRoutes) {
      expect(seen.has(route.operationId), `duplicate operationId: ${route.operationId}`).toBe(
        false
      );
      seen.add(route.operationId);
    }
  });

  it("uses only known HTTP methods", () => {
    const known: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
    for (const route of InternalApiRoutes) {
      expect(known).toContain(route.method);
    }
  });

  it("uses snake_case operation ids", () => {
    for (const route of InternalApiRoutes) {
      expect(route.operationId).toMatch(/^[a-z][a-zA-Z0-9]*$/);
    }
  });

  it("exposes at least one response per route", () => {
    for (const route of InternalApiRoutes) {
      const statuses = Object.keys(route.responses);
      expect(statuses.length, `${route.method} ${route.path} has no responses`).toBeGreaterThan(0);
    }
  });

  it("declares a path parameter when the path contains a placeholder", () => {
    for (const route of InternalApiRoutes) {
      const usesPlaceholder = /\{[^}]+\}/.test(route.path);
      if (usesPlaceholder) {
        expect(
          route.pathParam,
          `${route.method} ${route.path} is missing a pathParam`
        ).toBeDefined();
      }
    }
  });
});
