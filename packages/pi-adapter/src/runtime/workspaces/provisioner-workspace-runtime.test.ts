import { describe, expect, it, vi } from "vitest";
import { ProvisionerWorkspaceRuntime } from "./provisioner-workspace-runtime.js";
describe("ProvisionerWorkspaceRuntime", () => {
  it("delegates lifecycle to the dedicated provisioner", async () => {
    const provisionReviewed = vi.fn().mockResolvedValue("runtime-1");
    const archive = vi.fn();
    const destroy = vi.fn();
    const health = vi.fn().mockResolvedValue("ready");
    const run = vi.fn().mockResolvedValue(result());
    const cancel = vi.fn();
    const runtime = new ProvisionerWorkspaceRuntime({
      provisionReviewed,
      archive,
      destroy,
      health,
      run,
      cancel
    });
    await runtime.provision({
      workspaceId: "one",
      templateId: "code-project",
      templateVersion: "1.0.0",
      configuration: {}
    });
    await runtime.archive("one");
    await runtime.destroy("one");
    expect(provisionReviewed).toHaveBeenCalledWith("one", "code-project", "1.0.0");
    expect(archive).toHaveBeenCalledWith("one");
    expect(destroy).toHaveBeenCalledWith("one");
    expect(await runtime.resolve("one")).toBeUndefined();
    await expect(runtime.health("one")).resolves.toBe("ready");
    expect(health).toHaveBeenCalledWith("one");
  });

  it("proxies runs and cancels only active runs in the requested workspace", async () => {
    let release: (() => void) | undefined;
    const run = vi.fn(
      () =>
        new Promise<ReturnType<typeof result>>((resolve) => {
          release = () => resolve(result());
        })
    );
    const cancel = vi.fn();
    const runtime = new ProvisionerWorkspaceRuntime({
      provisionReviewed: vi.fn(),
      archive: vi.fn(),
      destroy: vi.fn(),
      health: vi.fn(),
      run,
      cancel
    });
    const pending = runtime.run({ workspaceId: "one", request: request() });
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    await runtime.cancel("one");
    expect(cancel).toHaveBeenCalledWith("one", "run-1");
    release?.();
    await pending;
  });
});

function request() {
  return {
    schemaVersion: 1 as const,
    id: "run-1",
    traceId: "trace-1",
    sessionId: "session-1",
    inputText: "hello",
    images: [],
    sourceReferences: [],
    timeoutSeconds: 60,
    priority: "interactive" as const
  };
}
function result() {
  return {
    schemaVersion: 1 as const,
    id: "run-1",
    traceId: "trace-1",
    sessionId: "session-1",
    status: "completed" as const,
    generatedFiles: [],
    startedAt: "2026-08-04T12:00:00.000Z",
    finishedAt: "2026-08-04T12:00:01.000Z"
  };
}
