import { describe, expect, it, vi } from "vitest";
import { PiWorkspaceRuntime } from "./pi-workspace-runtime.js";

describe("PiWorkspaceRuntime", () => {
  it("injects the resolved workspace identity only for ready runtimes", async () => {
    const run = vi.fn().mockResolvedValue({});
    const runtime = new PiWorkspaceRuntime(
      { health: async () => "ready" } as never,
      { run } as never
    );
    await runtime.run({ workspaceId: "workspace-1", request: request("run-1") });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "workspace-1" }));
    const unavailable = new PiWorkspaceRuntime(
      { health: async () => "archived" } as never,
      { run } as never
    );
    await expect(
      unavailable.run({ workspaceId: "workspace-1", request: request("run-2") })
    ).rejects.toThrow("not ready");
  });

  it("cancels only active Pi runs for the requested workspace", async () => {
    let release: (() => void) | undefined;
    const run = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve({});
        })
    );
    const cancel = vi.fn().mockResolvedValue(undefined);
    const runtime = new PiWorkspaceRuntime(
      { health: async () => "ready", cancel: vi.fn() } as never,
      { run, cancel } as never
    );
    const pending = runtime.run({ workspaceId: "one", request: request("run-one") });
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    await runtime.cancel("two");
    expect(cancel).not.toHaveBeenCalled();
    await runtime.cancel("one");
    expect(cancel).toHaveBeenCalledWith("run-one");
    release?.();
    await pending;
  });

  it("cancels runtime work before destruction", async () => {
    const order: string[] = [];
    const runtime = new PiWorkspaceRuntime(
      {
        health: async () => "ready",
        cancel: async () => {
          order.push("runtime-cancel");
        },
        destroy: async () => {
          order.push("destroy");
        }
      } as never,
      {
        cancel: async () => {
          order.push("pi-cancel");
        }
      } as never
    );
    await runtime.destroy("workspace-1");
    expect(order).toEqual(["runtime-cancel", "destroy"]);
  });
});
function request(id: string) {
  return {
    schemaVersion: 1 as const,
    id,
    sessionId: "session-1",
    inputText: "hello",
    traceId: "trace-1",
    images: [],
    sourceReferences: [],
    timeoutSeconds: 60,
    priority: "interactive" as const
  };
}
