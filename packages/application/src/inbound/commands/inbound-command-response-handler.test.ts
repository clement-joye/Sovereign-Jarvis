import { describe, expect, it } from "vitest";

import { exampleInboundMessage } from "@second-brain/contracts";

import { InboundCommandResponseHandler } from "./inbound-command-response-handler.js";

describe("InboundCommandResponseHandler", () => {
  it("builds a threaded command response without a Pi side effect", async () => {
    const handler = new InboundCommandResponseHandler();

    await expect(
      handler.create({ ...exampleInboundMessage, workspaceId: "workspace-one" }, "outbound-1", {
        kind: "command-response",
        command: "sessions",
        text: "Recent sessions"
      })
    ).resolves.toMatchObject({
      idempotencyKey: "outbound-1",
      workspaceId: "workspace-one",
      text: "Recent sessions",
      presentation: "notice",
      replyToExternalEventId: exampleInboundMessage.externalEventId,
      threadRootExternalEventId: exampleInboundMessage.externalEventId
    });
  });

  it("keeps the cancellation acknowledgement in the originating thread", async () => {
    const handler = new InboundCommandResponseHandler();

    await expect(
      handler.create(
        { ...exampleInboundMessage, threadRootExternalEventId: "$thread-root" },
        "outbound-1",
        {
          kind: "command-response",
          command: "cancel",
          text: "Stopping the current response."
        }
      )
    ).resolves.toMatchObject({
      replyToExternalEventId: "$thread-root",
      threadRootExternalEventId: "$thread-root"
    });
  });

  it("keeps invalid command feedback visible as an error", async () => {
    const handler = new InboundCommandResponseHandler();

    await expect(
      handler.create(exampleInboundMessage, "invalid-command", {
        kind: "command-response",
        command: "invalid",
        text: "Command not recognised. Use /help."
      })
    ).resolves.toMatchObject({
      text: "Command not recognised. Use /help.",
      presentation: "error"
    });
  });

  it("preserves an explicit error presentation for a valid command that failed", async () => {
    const handler = new InboundCommandResponseHandler();

    await expect(
      handler.create(exampleInboundMessage, "missing-schedule", {
        kind: "command-response",
        command: "schedule",
        text: "No schedule matches number 3.",
        presentation: "error"
      })
    ).resolves.toMatchObject({
      text: "No schedule matches number 3.",
      presentation: "error"
    });
  });
});
