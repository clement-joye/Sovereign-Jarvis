import { describe, expect, it } from "vitest";

import type { InboundMessageV1 } from "@second-brain/contracts";
import { INITIAL_AGENT_CATALOG, type AgentCatalog } from "@second-brain/domain";

import { selectMessageAgent } from "./agent-routing.js";

const message = (text: string): InboundMessageV1 => ({
  schemaVersion: 1,
  id: "inbound-1",
  traceId: "trace-1",
  transport: "matrix",
  externalEventId: "$event-1",
  conversationId: "!room:example",
  senderId: "@owner:example",
  receivedAt: "2026-08-13T20:00:00.000Z",
  kind: "text",
  text,
  attachments: [],
  metadata: {}
});

describe("selectMessageAgent", () => {
  it("uses the room default without modifying ordinary text", () => {
    expect(
      selectMessageAgent(message("Please ask @browser for help."), "brain", INITIAL_AGENT_CATALOG)
    ).toMatchObject({
      agentId: "brain",
      text: "Please ask @browser for help."
    });
  });

  it("selects and removes an explicit initial prefix", () => {
    expect(
      selectMessageAgent(message("@orchestrator: Plan this task"), "brain", INITIAL_AGENT_CATALOG)
    ).toMatchObject({
      agentId: "orchestrator",
      text: "Plan this task"
    });
    expect(
      selectMessageAgent(message("@brain summarize this"), "orchestrator", INITIAL_AGENT_CATALOG)
    ).toMatchObject({
      agentId: "brain",
      text: "summarize this"
    });
    expect(
      selectMessageAgent(message("@scheduler: remind me"), "router", INITIAL_AGENT_CATALOG)
    ).toMatchObject({
      agentId: "scheduler",
      text: "remind me"
    });
  });

  it("only selects roles present in the reviewed catalog", () => {
    const catalog = {
      get: (agentId: string) =>
        agentId === "orchestrator" || agentId === "brain" ? { id: agentId } : undefined,
      require: (agentId: string) => {
        if (agentId !== "brain") throw new Error("Unknown agent id in reviewed catalog");
        return { id: agentId };
      }
    } as unknown as AgentCatalog;
    expect(
      selectMessageAgent(message("@orchestrator: break this down"), "brain", catalog)
    ).toMatchObject({
      agentId: "orchestrator",
      text: "break this down"
    });
    expect(selectMessageAgent(message("@unreviewed: do work"), "brain", catalog)).toMatchObject({
      agentId: "brain",
      text: "@unreviewed: do work"
    });
  });

  it.each([
    ["orchestrator", "split this into milestones"],
    ["document-analyzer", "extract this attachment"],
    ["scheduler", "list my schedules"]
  ])("selects %s from the initial reviewed catalog", (agentId, task) => {
    expect(
      selectMessageAgent(message(`@${agentId}: ${task}`), "brain", INITIAL_AGENT_CATALOG)
    ).toMatchObject({
      agentId,
      text: task
    });
  });
});
