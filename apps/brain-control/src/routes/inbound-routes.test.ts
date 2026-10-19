import { describe, expect, it, vi } from "vitest";
import { UnknownWorkspaceRoomError } from "@second-brain/application";
import { INITIAL_AGENT_CATALOG } from "@second-brain/domain";

import { handleInboundRoute } from "./inbound-routes.js";

describe("inbound routes", () => {
  it("reapplies an explicit reviewed agent prefix before accepting the durable inbound message", async () => {
    const accepted: unknown[] = [];
    const setThreadAgent = vi.fn();
    const handled = await handleInboundRoute(
      { method: "POST" } as never,
      {} as never,
      new URL("http://control.test/v1/inbound/matrix"),
      {
        inboundAcceptance: {
          acceptMatrixInbound: async (message) => {
            accepted.push(message);
            return { inboundMessageId: message.id, duplicate: false, jobId: "job-1" };
          }
        },
        inboundMessages: { get: vi.fn() } as never,
        agentCatalog: INITIAL_AGENT_CATALOG,
        workspaceResolution: {
          resolveMatrixRoom: async () => ({ id: "workspace-example" }),
          setThreadAgent
        } as never,
        readJson: async () => ({
          schemaVersion: 1,
          id: "inbound-1",
          traceId: "trace-1",
          transport: "matrix",
          externalEventId: "$event",
          conversationId: "!room:example",
          senderId: "@owner:example",
          receivedAt: "2026-08-19T00:00:00.000Z",
          kind: "text",
          workspaceId: "workspace-example",
          agentId: "brain",
          text: "@orchestrator what are your tools?",
          attachments: [],
          metadata: {}
        }),
        writeJson: vi.fn()
      }
    );

    expect(handled).toBe(true);
    expect(accepted).toMatchObject([{ agentId: "orchestrator", text: "what are your tools?" }]);
    expect(setThreadAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-example",
        conversationId: "!room:example",
        threadRootExternalEventId: "$event",
        agentId: "orchestrator"
      })
    );
  });

  it("returns a room error only when the Matrix room is unknown", async () => {
    const writeJson = vi.fn();
    const handled = await handleInboundRoute(
      { method: "POST" } as never,
      {} as never,
      new URL("http://control.test/v1/inbound/matrix"),
      dependencies(
        {
          resolveMatrixRoom: async () => {
            throw new UnknownWorkspaceRoomError("!missing:example");
          }
        },
        writeJson
      )
    );

    expect(handled).toBe(true);
    expect(writeJson).toHaveBeenCalledWith(expect.anything(), 403, {
      error: "workspace_room_not_found"
    });
  });

  it("signals the selected run before acknowledging /cancel without exposing its ID", async () => {
    const cancelPiRun = vi.fn().mockResolvedValue(undefined);
    const writeJson = vi.fn();
    await handleInboundRoute(
      { method: "POST" } as never,
      {} as never,
      new URL("http://control.test/v1/inbound/matrix"),
      {
        inboundAcceptance: {
          acceptMatrixInbound: async () => ({
            inboundMessageId: "inbound-cancel",
            duplicate: false,
            jobId: "job-cancel",
            cancelTargetRunId: "job-active",
            cancelTargetNeedsPiCancel: true
          })
        },
        inboundMessages: { get: vi.fn() } as never,
        agentCatalog: INITIAL_AGENT_CATALOG,
        workspaceResolution: {
          resolveMatrixRoom: async () => ({ id: "workspace-example" })
        } as never,
        readJson: async () => ({
          schemaVersion: 1,
          id: "inbound-cancel",
          traceId: "trace-cancel",
          transport: "matrix",
          externalEventId: "$cancel",
          conversationId: "!room:example",
          senderId: "@owner:example",
          receivedAt: "2026-08-19T00:00:00.000Z",
          kind: "text",
          workspaceId: "workspace-example",
          text: "/cancel",
          threadRootExternalEventId: "$thread",
          attachments: [],
          metadata: {}
        }),
        cancelPiRun,
        writeJson
      }
    );

    expect(cancelPiRun).toHaveBeenCalledExactlyOnceWith("workspace-example", "job-active");
    expect(writeJson).toHaveBeenCalledWith(expect.anything(), 202, {
      inboundMessageId: "inbound-cancel",
      duplicate: false,
      jobId: "job-cancel"
    });
  });

  it("acknowledges a queued cancellation without signalling a Pi run", async () => {
    const cancelPiRun = vi.fn();
    const writeJson = vi.fn();
    await handleInboundRoute(
      { method: "POST" } as never,
      {} as never,
      new URL("http://control.test/v1/inbound/matrix"),
      {
        ...dependencies({ resolveMatrixRoom: async () => ({ id: "workspace-example" }) }),
        inboundAcceptance: {
          acceptMatrixInbound: async () => ({
            inboundMessageId: "inbound-cancel",
            duplicate: false,
            jobId: "job-cancel",
            cancelTargetRunId: "job-queued",
            cancelTargetNeedsPiCancel: false
          })
        },
        readJson: async () => ({
          schemaVersion: 1,
          id: "inbound-cancel",
          traceId: "trace-cancel",
          transport: "matrix",
          externalEventId: "$cancel",
          conversationId: "!room:example",
          senderId: "@owner:example",
          receivedAt: "2026-08-19T00:00:00.000Z",
          kind: "text",
          workspaceId: "workspace-example",
          text: "/cancel",
          threadRootExternalEventId: "$thread",
          attachments: [],
          metadata: {}
        }),
        cancelPiRun,
        writeJson
      }
    );

    expect(cancelPiRun).not.toHaveBeenCalled();
    expect(writeJson).toHaveBeenCalledWith(expect.anything(), 202, {
      inboundMessageId: "inbound-cancel",
      duplicate: false,
      jobId: "job-cancel"
    });
  });

  it("lets persistence failures reach the centralized server error handler", async () => {
    const failure = new Error("database constraint failed");
    await expect(
      handleInboundRoute(
        { method: "POST" } as never,
        {} as never,
        new URL("http://control.test/v1/inbound/matrix"),
        dependencies({
          resolveMatrixRoom: async () => ({ id: "workspace-example" }),
          setThreadAgent: async () => {
            throw failure;
          }
        })
      )
    ).rejects.toBe(failure);
  });
});

function dependencies(workspaceResolution: object, writeJson = vi.fn()) {
  return {
    inboundAcceptance: {
      acceptMatrixInbound: vi.fn()
    },
    inboundMessages: { get: vi.fn() } as never,
    agentCatalog: INITIAL_AGENT_CATALOG,
    workspaceResolution: workspaceResolution as never,
    readJson: async () => ({
      schemaVersion: 1,
      id: "inbound-1",
      traceId: "trace-1",
      transport: "matrix",
      externalEventId: "$event",
      conversationId: "!room:example",
      senderId: "@owner:example",
      receivedAt: "2026-08-19T00:00:00.000Z",
      kind: "text",
      workspaceId: "workspace-example",
      text: "@orchestrator what are your tools?",
      attachments: [],
      metadata: {}
    }),
    writeJson
  };
}
