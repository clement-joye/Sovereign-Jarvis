import { describe, expect, it, vi } from "vitest";

import {
  aggregateHealthStatus,
  createSecurityEventEmitter,
  createStructuredLogger,
  pingHttpUrl,
  redactLogValue,
  structuredLogEvent
} from "./index.js";

describe("observability helpers", () => {
  it("writes structured, redacted log lines through the supplied sink", () => {
    const lines: Array<{ level: string; line: string }> = [];
    const logger = createStructuredLogger({
      service: "test-service",
      environment: "test",
      version: "test",
      write: (level, line) => lines.push({ level, line })
    });

    logger.warn("request completed", { text: "private", count: 1 });

    expect(lines).toEqual([
      {
        level: "warn",
        line: expect.stringContaining('"text":"[redacted]"')
      }
    ]);
  });

  it("binds correlation context to a child logger so every line carries it", () => {
    const lines: string[] = [];
    const logger = createStructuredLogger({
      service: "brain-worker",
      environment: "test",
      version: "0.0.0",
      write: (_level, line) => lines.push(line)
    });
    const request = logger.withContext({
      workspace_id: "workspace-project",
      trace_id: "trace-1",
      session_id: "session-1"
    });

    request.info("claimed job", { job_id: "job-1" });
    request.warn("retry needed");

    // The parent logger must remain unaffected.
    logger.info("untouched parent line");

    expect(lines[0]).toContain('"workspace_id":"workspace-project"');
    expect(lines[0]).toContain('"trace_id":"trace-1"');
    expect(lines[0]).toContain('"session_id":"session-1"');
    expect(lines[0]).toContain('"job_id":"job-1"');
    expect(lines[1]).toContain('"workspace_id":"workspace-project"');
    expect(lines[1]).not.toContain('"job_id"');
    expect(lines[2]).not.toContain('"workspace_id"');
  });

  it("merges nested withContext bindings without mutating either parent", () => {
    const lines: string[] = [];
    const base = createStructuredLogger({
      service: "brain-control",
      environment: "test",
      version: "0.0.0",
      write: (_level, line) => lines.push(line)
    });
    const scoped = base.withContext({ workspace_id: "workspace-1" });
    const perCall = scoped.withContext({ trace_id: "trace-2", conversation_id: "room:1" });

    perCall.info("routed");
    scoped.info("untouched sibling");
    base.info("still untouched");

    expect(lines[0]).toContain('"workspace_id":"workspace-1"');
    expect(lines[0]).toContain('"trace_id":"trace-2"');
    expect(lines[0]).toContain('"conversation_id":"room:1"');
    expect(lines[1]).toContain('"workspace_id":"workspace-1"');
    expect(lines[1]).not.toContain('"trace_id"');
    expect(lines[2]).not.toContain('"workspace_id"');
  });

  it("redacts sensitive values recursively", () => {
    expect(
      redactLogValue({
        accessToken: "secret",
        nested: { transcript: "hello", safe: "ok" },
        items: [{ messageText: "content" }]
      })
    ).toEqual({
      accessToken: "[redacted]",
      nested: { transcript: "[redacted]", safe: "ok" },
      items: [{ messageText: "[redacted]" }]
    });
  });

  it("creates structured logs with redacted data and correlation ids", () => {
    expect(
      structuredLogEvent({
        now: new Date("2026-07-17T15:00:00.000Z"),
        level: "info",
        service: "brain-control",
        environment: "test",
        version: "0.0.0",
        message: "accepted inbound",
        trace_id: "trace-1",
        data: { text: "do not log", count: 1 }
      })
    ).toEqual({
      timestamp: "2026-07-17T15:00:00.000Z",
      level: "info",
      service: "brain-control",
      environment: "test",
      version: "0.0.0",
      message: "accepted inbound",
      trace_id: "trace-1",
      data: { text: "[redacted]", count: 1 }
    });
  });

  it("propagates workspace ownership into the log envelope without leaking sensitive fields", () => {
    const event = structuredLogEvent({
      now: new Date("2026-07-17T15:00:00.000Z"),
      level: "info",
      service: "brain-worker",
      environment: "production",
      version: "0.0.0",
      message: "claimed job",
      workspace_id: "workspace-project",
      job_id: "job-1",
      data: { workspaceId: "workspace-project", prompt: "secret" }
    });
    expect(event.workspace_id).toBe("workspace-project");
    expect(event.job_id).toBe("job-1");
    expect(event.data).toEqual({
      workspaceId: "workspace-project",
      prompt: "[redacted]"
    });
  });

  it("omits workspace_id when no workspace scope is available", () => {
    const event = structuredLogEvent({
      now: new Date("2026-07-17T15:00:00.000Z"),
      level: "info",
      service: "scheduler",
      environment: "test",
      version: "0.0.0",
      message: "poll completed"
    });
    expect(event).not.toHaveProperty("workspace_id");
  });

  it("emits queryable security events without allowing secret-shaped fields", () => {
    const lines: string[] = [];
    const logger = createStructuredLogger({
      service: "brain-control",
      environment: "test",
      version: "0.0.0",
      write: (_level, line) => lines.push(line)
    });

    createSecurityEventEmitter(logger).emit({
      schemaVersion: 1,
      type: "authorization.denied",
      occurredAt: "2026-09-01T00:00:00.000Z",
      reason: "signature_invalid",
      workspaceId: "workspace-1",
      runId: "run-1",
      operationId: "git_push"
    });

    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      level: "warn",
      message: "security event",
      workspace_id: "workspace-1",
      data: {
        security_event: {
          type: "authorization.denied",
          reason: "signature_invalid",
          runId: "run-1"
        }
      }
    });
  });

  it("aggregates dependency health", () => {
    expect(
      aggregateHealthStatus({
        service: "brain-control",
        checkedAt: "2026-07-17T15:00:00.000Z",
        version: "0.0.0",
        dependencies: [
          { name: "db", status: "ready" },
          { name: "matrix", status: "degraded" }
        ]
      }).status
    ).toBe("degraded");
  });

  describe("pingHttpUrl", () => {
    it("returns true when the URL responds with a 2xx status", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));
      await expect(pingHttpUrl("http://control.test/health")).resolves.toBe(true);
      vi.unstubAllGlobals();
    });

    it("returns false when the URL responds with a non-2xx status", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false } as Response));
      await expect(pingHttpUrl("http://control.test/health")).resolves.toBe(false);
      vi.unstubAllGlobals();
    });

    it("returns false when fetch throws", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
      await expect(pingHttpUrl("http://control.test/health")).resolves.toBe(false);
      vi.unstubAllGlobals();
    });

    it("returns false when the request does not resolve within the timeout", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_input, init?: RequestInit) => {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          });
        })
      );
      await expect(pingHttpUrl("http://control.test/health", 5)).resolves.toBe(false);
      vi.unstubAllGlobals();
    });
  });
});
