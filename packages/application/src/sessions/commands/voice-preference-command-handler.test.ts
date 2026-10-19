import { describe, expect, it, vi } from "vitest";

import { exampleInboundMessage } from "@second-brain/contracts";

import { VoicePreferenceCommandHandler } from "./voice-preference-command-handler.js";

describe("VoicePreferenceCommandHandler", () => {
  it("reads the current preference without mutating it", async () => {
    const preferences = {
      getVoiceReplies: vi.fn().mockResolvedValue(true),
      setVoiceReplies: vi.fn()
    };
    const handler = new VoicePreferenceCommandHandler(preferences);

    await expect(handler.handle(exampleInboundMessage, undefined)).resolves.toMatchObject({
      enabled: true,
      text: "Voice replies: on. Voice notes get an English audio reply when available; otherwise, the reply is text."
    });
    expect(preferences.getVoiceReplies).toHaveBeenCalledWith({
      workspaceId: "workspace-example",
      conversationId: exampleInboundMessage.conversationId
    });
    expect(preferences.setVoiceReplies).not.toHaveBeenCalled();
  });

  it("mirrors a top-level mutation into its acknowledgement thread", async () => {
    const preferences = {
      getVoiceReplies: vi.fn(),
      setVoiceReplies: vi.fn().mockResolvedValue(false)
    };
    const handler = new VoicePreferenceCommandHandler(preferences);

    await expect(handler.handle(exampleInboundMessage, false)).resolves.toMatchObject({
      enabled: false,
      text: "Voice replies: off. Voice notes get an English audio reply when available; otherwise, the reply is text."
    });
    expect(preferences.setVoiceReplies).toHaveBeenCalledTimes(2);
    expect(preferences.setVoiceReplies).toHaveBeenLastCalledWith({
      workspaceId: "workspace-example",
      conversationId: exampleInboundMessage.conversationId,
      threadRootExternalEventId: exampleInboundMessage.externalEventId,
      enabled: false
    });
  });
});
