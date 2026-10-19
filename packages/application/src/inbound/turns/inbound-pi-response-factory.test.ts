import { describe, expect, it, vi } from "vitest";

import {
  exampleAttachment,
  exampleInboundMessage,
  type AttachmentReferenceV1,
  type PiRunResultV1
} from "@second-brain/contracts";

import { InboundPiResponseFactory } from "./inbound-pi-response-factory.js";

describe("InboundPiResponseFactory", () => {
  it("creates a text response with generated images for normal input", async () => {
    const media = mediaProcessor();
    const factory = new InboundPiResponseFactory(media, undefined);

    await expect(
      factory.create({
        message: exampleInboundMessage,
        outboundKey: "outbound-1",
        result: result()
      })
    ).resolves.toMatchObject({
      idempotencyKey: "outbound-1",
      text: "Pi response",
      images: [exampleAttachment],
      replyToExternalEventId: exampleInboundMessage.externalEventId,
      threadRootExternalEventId: exampleInboundMessage.externalEventId
    });
    expect(media.synthesizeAudio).not.toHaveBeenCalled();
  });

  it.each([
    "brain",
    "code",
    "planner",
    "router",
    "browser",
    "document-analyzer",
    "scheduler",
    "git"
  ])("labels a response with the selected %s agent", async (agentId) => {
    const factory = new InboundPiResponseFactory(mediaProcessor(), undefined);

    await expect(
      factory.create({
        message: { ...exampleInboundMessage, agentId },
        outboundKey: "outbound-1",
        result: result()
      })
    ).resolves.toMatchObject({ text: `**${agentId}**:\n\nPi response` });
  });

  it("creates an audio reply when voice replies are enabled for audio input", async () => {
    const audio = { ...exampleAttachment, id: "audio-1", mediaType: "audio/ogg" };
    const media = mediaProcessor();
    const preferences = {
      getVoiceReplies: vi.fn().mockResolvedValue(true),
      setVoiceReplies: vi.fn()
    };
    const factory = new InboundPiResponseFactory(media, preferences);

    const response = await factory.create({
      message: { ...exampleInboundMessage, attachments: [audio] },
      outboundKey: "outbound-1",
      result: result()
    });

    expect(response).toMatchObject({ audio: synthesizedAudio });
    expect(response).not.toHaveProperty("text");
    expect(response).not.toHaveProperty("images");
    expect(preferences.getVoiceReplies).toHaveBeenCalledWith({
      workspaceId: "workspace-example",
      conversationId: exampleInboundMessage.conversationId
    });
    expect(media.synthesizeAudio).toHaveBeenCalledWith("Pi response");
  });

  it("keeps a visible agent marker alongside a voice response", async () => {
    const audio = { ...exampleAttachment, id: "audio-1", mediaType: "audio/ogg" };
    const preferences = {
      getVoiceReplies: vi.fn().mockResolvedValue(true),
      setVoiceReplies: vi.fn()
    };
    const factory = new InboundPiResponseFactory(mediaProcessor(), preferences);

    await expect(
      factory.create({
        message: { ...exampleInboundMessage, agentId: "brain", attachments: [audio] },
        outboundKey: "outbound-1",
        result: result()
      })
    ).resolves.toMatchObject({ text: "**brain**:", audio: synthesizedAudio });
  });

  it("falls back to text when audio synthesis fails", async () => {
    const audio = { ...exampleAttachment, id: "audio-1", mediaType: "audio/ogg" };
    const media = mediaProcessor(new Error("TTS unavailable"));
    const preferences = {
      getVoiceReplies: vi.fn().mockResolvedValue(true),
      setVoiceReplies: vi.fn()
    };
    const factory = new InboundPiResponseFactory(media, preferences);

    await expect(
      factory.create({
        message: { ...exampleInboundMessage, attachments: [audio] },
        outboundKey: "outbound-1",
        result: result({ status: "timed_out", text: undefined })
      })
    ).resolves.toMatchObject({ text: "Pi run timed out.", images: [exampleAttachment] });
  });
});

const synthesizedAudio: AttachmentReferenceV1 = {
  ...exampleAttachment,
  id: "outbound-audio-1",
  purpose: "outbound",
  mediaType: "audio/ogg"
};

function mediaProcessor(error?: Error) {
  return {
    prepareImage: vi.fn(),
    transcribeAudio: vi.fn(),
    synthesizeAudio: vi.fn(async () => {
      if (error) throw error;
      return synthesizedAudio;
    })
  };
}

function result(overrides: Partial<PiRunResultV1> = {}): PiRunResultV1 {
  return {
    schemaVersion: 1,
    id: "run-1",
    traceId: exampleInboundMessage.traceId,
    sessionId: "session-1",
    status: "completed",
    text: "Pi response",
    generatedFiles: [exampleAttachment],
    startedAt: "2026-07-27T10:00:00.000Z",
    finishedAt: "2026-07-27T10:00:01.000Z",
    ...overrides
  };
}
