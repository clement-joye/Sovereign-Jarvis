import { describe, expect, it } from "vitest";

import { INITIAL_AGENT_CATALOG, type WorkspaceRecord } from "@second-brain/domain";

import { RoomAgentCommandSubmissionService } from "./room-agent-command.js";
import { RoomAgentCommandResponder } from "./room-agent-command-responder.js";

const now = new Date("2026-08-13T20:00:00.000Z");
const workspace: WorkspaceRecord = {
  id: "workspace-1",
  templateId: "second-brain",
  templateVersion: "1.0.0",
  configuration: {},
  defaultAgent: "brain",
  status: "active",
  origin: "matrix_invite",
  createdAt: now,
  updatedAt: now
};

describe("RoomAgentCommandSubmissionService", () => {
  it("persists an owner-routed default and replies in the command thread", async () => {
    let stored = workspace;
    const outbounds: unknown[] = [];
    const service = new RoomAgentCommandSubmissionService(
      { getByRoomId: async () => stored, update: async (next) => (stored = next) },
      new RoomAgentCommandResponder(
        {
          create: async (outbound) => {
            outbounds.push(outbound);
            return outbound;
          }
        },
        { nextId: () => "outbound-1" }
      ),
      () => new Date("2026-08-13T20:01:00.000Z"),
      INITIAL_AGENT_CATALOG
    );
    await service.submit(message("/agent default orchestrator"));
    expect(stored.defaultAgent).toBe("orchestrator");
    expect(outbounds).toContainEqual(
      expect.objectContaining({
        text: "Default agent set to `orchestrator` for new conversations.",
        presentation: "notice",
        threadRootExternalEventId: "$event-1"
      })
    );
  });

  it("reports the current default without changing it", async () => {
    const service = new RoomAgentCommandSubmissionService(
      { getByRoomId: async () => workspace, update: async () => workspace },
      new RoomAgentCommandResponder(
        { create: async (outbound) => outbound },
        { nextId: () => "outbound-1" }
      ),
      () => now,
      INITIAL_AGENT_CATALOG
    );
    await expect(service.submit(message("/agent status"))).resolves.toMatchObject({
      handled: true,
      outbound: { text: expect.stringContaining("brain") }
    });
  });

  it("reports the selected thread agent separately from the room default", async () => {
    const service = new RoomAgentCommandSubmissionService(
      {
        getByRoomId: async () => workspace,
        getThreadAgent: async () => "scheduler",
        update: async () => workspace
      },
      new RoomAgentCommandResponder(
        { create: async (outbound) => outbound },
        { nextId: () => "outbound-1" }
      ),
      () => now,
      INITIAL_AGENT_CATALOG
    );

    await expect(
      service.submit({ ...message("/agent status"), threadRootExternalEventId: "$thread-root" })
    ).resolves.toMatchObject({
      outbound: {
        text: expect.stringContaining("Thread agent: `scheduler`. Room default: `brain`.")
      }
    });
  });

  it("lists every reviewed catalog agent without changing the room default", async () => {
    let createdText: string | undefined;
    const service = new RoomAgentCommandSubmissionService(
      { getByRoomId: async () => workspace, update: async () => workspace },
      new RoomAgentCommandResponder(
        {
          create: async (outbound) => {
            createdText = outbound.text;
            return outbound;
          }
        },
        { nextId: () => "outbound-1" }
      ),
      () => now,
      INITIAL_AGENT_CATALOG
    );

    await expect(service.submit(message("/agents"))).resolves.toMatchObject({
      handled: true,
      outbound: {
        text: expect.stringContaining("**Available agents**")
      }
    });
    expect(createdText).toContain("`orchestrator`");
    expect(createdText).not.toContain("`planner`");
    expect(createdText).toContain("`browser`");
  });

  it("uses the focused Agents guide for /agent help", async () => {
    let createdText: string | undefined;
    const service = new RoomAgentCommandSubmissionService(
      { getByRoomId: async () => workspace, update: async () => workspace },
      new RoomAgentCommandResponder(
        { create: async (outbound) => ((createdText = outbound.text), outbound) },
        { nextId: () => "outbound-1" }
      ),
      () => now,
      INITIAL_AGENT_CATALOG
    );

    await service.submit(message("/agent help"));

    expect(createdText).toContain("**Agents**");
    expect(createdText).toContain("@document-analyzer");
    expect(createdText).not.toContain("/workspace status");
    expect(createdText).not.toContain("/schedule <number> run");
  });

  it("accepts Orchestrator as a catalog-backed room default", async () => {
    let stored = workspace;
    const service = new RoomAgentCommandSubmissionService(
      { getByRoomId: async () => stored, update: async (next) => (stored = next) },
      new RoomAgentCommandResponder(
        { create: async (outbound) => outbound },
        { nextId: () => "outbound-1" }
      ),
      () => now,
      INITIAL_AGENT_CATALOG
    );
    await service.submit(message("/agent default orchestrator"));
    expect(stored.defaultAgent).toBe("orchestrator");
  });
});

function message(text: string) {
  return {
    schemaVersion: 1 as const,
    id: "inbound-1",
    traceId: "trace-1",
    transport: "matrix" as const,
    externalEventId: "$event-1",
    conversationId: "!room:example",
    workspaceId: "workspace-1",
    senderId: "@owner:example",
    receivedAt: now.toISOString(),
    kind: "command" as const,
    text,
    attachments: [],
    metadata: {}
  };
}
