import { access, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createRunId, createTestRunContext, DiagnosticCollector, eventually } from "./harness.js";

describe("test harness helpers", () => {
  it("creates filesystem-safe run identifiers", () => {
    const runId = createRunId("Matrix Gateway");

    expect(runId).toMatch(/^matrix-gateway-[a-z0-9]+-[a-f0-9-]+$/);
  });

  it("retries a bounded assertion until it succeeds", async () => {
    let attempts = 0;

    const value = await eventually(
      () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error(`not yet: ${attempts}`);
        }
        return "ready";
      },
      { description: "sample readiness", intervalMs: 1, timeoutMs: 100 }
    );

    expect(value).toBe("ready");
    expect(attempts).toBe(3);
  });

  it("reports useful context when a bounded assertion times out", async () => {
    await expect(
      eventually(
        () => {
          throw new Error("still down");
        },
        { description: "service readiness", intervalMs: 1, timeoutMs: 5 }
      )
    ).rejects.toThrow(/Timed out waiting for service readiness.*still down/s);
  });

  it("creates and cleans an isolated temp directory", async () => {
    const context = await createTestRunContext({ prefix: "retention-worker" });
    const filePath = context.makePath("attachment.txt");

    await writeFile(filePath, "fixture", "utf8");
    await expect(access(filePath)).resolves.toBeUndefined();

    await context.cleanup();
    await expect(access(context.tempDir)).rejects.toThrow();

    await expect(context.cleanup()).resolves.toBeUndefined();
  });

  it("prevents temp path traversal", async () => {
    const context = await createTestRunContext({ prefix: "pi-runner" });

    try {
      expect(() => context.makePath("..", "outside")).toThrow(/escapes test temp directory/);
    } finally {
      await context.cleanup();
    }
  });

  it("formats diagnostics in insertion order", () => {
    const diagnostics = new DiagnosticCollector();

    diagnostics.add("runId", "run-1");
    diagnostics.add("job", { id: "job-1", status: "retry_wait" });

    expect(diagnostics.format()).toContain("runId: run-1");
    expect(diagnostics.format()).toContain('"status": "retry_wait"');
  });
});
