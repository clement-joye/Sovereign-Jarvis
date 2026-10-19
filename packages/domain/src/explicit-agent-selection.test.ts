import { describe, expect, it } from "vitest";

import type { InboundMessageV1 } from "@second-brain/contracts";

import { INITIAL_AGENT_CATALOG } from "./agent-catalog.js";
import { selectExplicitAgent } from "./explicit-agent-selection.js";

const message: InboundMessageV1 = {
  schemaVersion: 1,
  id: "inbound-1",
  traceId: "trace-1",
  transport: "matrix",
  externalEventId: "$event",
  conversationId: "!room:example",
  senderId: "@owner:example",
  receivedAt: "2026-08-19T00:00:00.000Z",
  kind: "text",
  text: "@orchestrator what are your tools?",
  attachments: [],
  metadata: {},
  agentId: "brain"
};

describe("selectExplicitAgent", () => {
  it("overrides an already assigned default role with an explicit reviewed prefix", () => {
    expect(selectExplicitAgent(message, INITIAL_AGENT_CATALOG)).toMatchObject({
      agentId: "orchestrator",
      text: "what are your tools?"
    });
  });

  it("does not reinterpret ordinary or unreviewed prefixes", () => {
    expect(
      selectExplicitAgent(
        { ...message, text: "Discuss @orchestrator options" },
        INITIAL_AGENT_CATALOG
      )
    ).toBeUndefined();
    expect(
      selectExplicitAgent({ ...message, text: "@unknown do this" }, INITIAL_AGENT_CATALOG)
    ).toBeUndefined();
  });
});
