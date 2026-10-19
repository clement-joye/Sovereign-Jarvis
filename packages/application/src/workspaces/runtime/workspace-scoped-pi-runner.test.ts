import { describe, expect, it, vi } from "vitest";

import type { PiRunRequestV1, PiRunResultV1 } from "@second-brain/contracts";

import { WorkspaceScopedPiRunner } from "./workspace-scoped-pi-runner.js";
import type { WorkspaceRuntimePort } from "../../ports.js";

describe("WorkspaceScopedPiRunner", () => {
  it("routes the seeded default workspace through its reviewed runtime", async () => {
    const workspaceRun = vi.fn<WorkspaceRuntimePort["run"]>().mockResolvedValue(result());
    const runner = new WorkspaceScopedPiRunner(
      { provision: vi.fn(), run: workspaceRun, cancel: vi.fn() },
      fixtureTemplate()
    );

    await runner.run({
      ...request(),
      id: "seeded-workspace-run",
      workspaceId: "workspace-example"
    });
    expect(workspaceRun).toHaveBeenCalledOnce();
  });

  it("routes Brain and fixture workspace requests to the same room runtime", async () => {
    const workspaceRun = vi.fn<WorkspaceRuntimePort["run"]>().mockResolvedValue(result());
    const provision = vi.fn();
    const runner = new WorkspaceScopedPiRunner(
      { provision, run: workspaceRun, cancel: vi.fn() },
      fixtureTemplate()
    );

    await runner.run({
      ...request(),
      id: "brain-workspace-run",
      workspaceId: "workspace-1",
      agentId: "brain"
    });
    await runner.run({
      ...request(),
      id: "fixture-workspace-run",
      workspaceId: "workspace-1",
      agentId: "fixture-agent"
    });

    expect(provision).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      templateId: "code-project",
      templateVersion: "1.0.0",
      configuration: {}
    });
    expect(workspaceRun).toHaveBeenNthCalledWith(1, {
      workspaceId: "workspace-1",
      request: expect.not.objectContaining({ workspaceId: expect.anything() })
    });
    expect(workspaceRun.mock.calls[0]?.[0].request).toMatchObject({
      id: "brain-workspace-run",
      agentId: "brain"
    });
    expect(workspaceRun.mock.calls[1]?.[0].request).toMatchObject({
      id: "fixture-workspace-run",
      agentId: "fixture-agent"
    });
  });

  it("cancels only the workspace runtime that owns an active scoped run", async () => {
    let release: (() => void) | undefined;
    const workspaceRun = vi.fn(
      () =>
        new Promise<PiRunResultV1>((resolve) => {
          release = () => resolve(result());
        })
    );
    const cancel = vi.fn();
    const runner = new WorkspaceScopedPiRunner(
      { provision: vi.fn(), run: workspaceRun, cancel },
      fixtureTemplate()
    );
    const pending = runner.run({
      ...request(),
      id: "workspace-run",
      workspaceId: "workspace-1",
      agentId: "fixture-agent"
    });
    await vi.waitFor(() => expect(workspaceRun).toHaveBeenCalledOnce());

    await runner.cancel("workspace-run");

    expect(cancel).toHaveBeenCalledWith("workspace-1");
    release?.();
    await pending;
  });

  it("cancels an active scoped session through its owning runtime", async () => {
    let release: (() => void) | undefined;
    const workspaceRun = vi.fn(
      () =>
        new Promise<PiRunResultV1>((resolve) => {
          release = () => resolve(result());
        })
    );
    const cancel = vi.fn();
    const runner = new WorkspaceScopedPiRunner(
      { provision: vi.fn(), run: workspaceRun, cancel },
      fixtureTemplate()
    );
    const pending = runner.run({
      ...request(),
      workspaceId: "workspace-1",
      agentId: "fixture-agent"
    });
    await vi.waitFor(() => expect(workspaceRun).toHaveBeenCalledOnce());

    await runner.cancelSession("session-1");

    expect(cancel).toHaveBeenCalledWith("workspace-1");
    release?.();
    await pending;
  });
});

function request(): PiRunRequestV1 {
  return {
    schemaVersion: 1,
    id: "legacy-run",
    traceId: "trace-1",
    sessionId: "session-1",
    inputText: "Hello",
    images: [],
    sourceReferences: [],
    timeoutSeconds: 60,
    priority: "interactive"
  };
}

function fixtureTemplate() {
  return { id: "code-project", version: "1.0.0" };
}

function result(): PiRunResultV1 {
  return {
    schemaVersion: 1 as const,
    id: "result-1",
    traceId: "trace-1",
    sessionId: "session-1",
    status: "completed" as const,
    generatedFiles: [],
    startedAt: "2026-08-04T12:00:00.000Z",
    finishedAt: "2026-08-04T12:00:01.000Z"
  };
}
