import type { OutboundMessageV1 } from "@second-brain/contracts";

import { describe, expect, it, vi } from "vitest";

import { matrixEvents, sendThreadedReply, threadAnchorMessage } from "./thread-anchor.js";

describe("thread-anchor", () => {
  it("sends a synthetic marker first and threads the reply under it", async () => {
    const reply: OutboundMessageV1 = baseReply({
      text: "Daily summary ...",
      threadAnchorText: "_scheduled_ — Daily summary"
    });
    const sender = vi.fn(
      async (_message: OutboundMessageV1): Promise<{ externalEventId: string }> => ({
        externalEventId: "$unused"
      })
    );
    sender.mockResolvedValueOnce({ externalEventId: "$anchor-event" });
    sender.mockResolvedValueOnce({ externalEventId: "$reply-event" });

    const result = await sendThreadedReply({ send: sender }, reply);

    expect(sender).toHaveBeenCalledTimes(2);
    const [anchorCall, threadedReplyCall] = sender.mock.calls;
    const anchorMessage = anchorCall?.[0];
    expect(anchorMessage?.text).toBe("_scheduled_ — Daily summary");
    expect(anchorMessage?.threadAnchorText).toBeUndefined();
    expect(anchorMessage?.threadRootExternalEventId).toBeUndefined();
    expect(anchorMessage?.replyToExternalEventId).toBeUndefined();
    expect(anchorMessage?.idempotencyKey).toBe(`${reply.idempotencyKey}:anchor`);
    expect(threadedReplyCall?.[0]).toMatchObject({
      text: "Daily summary ...",
      threadRootExternalEventId: "$anchor-event",
      replyToExternalEventId: "$anchor-event"
    });
    expect(result.externalEventId).toBe("$reply-event");
    expect(result.anchorExternalEventId).toBe("$anchor-event");
    expect(result.anchorIdempotencyKey).toBe(`${reply.idempotencyKey}:anchor`);
  });

  it("skips the anchor when the reply already carries a thread root", async () => {
    const reply: OutboundMessageV1 = baseReply({
      text: "Already threaded",
      threadAnchorText: "_scheduled_ — Daily summary",
      threadRootExternalEventId: "$previous-anchor",
      replyToExternalEventId: "$previous-anchor"
    });
    const sender = vi.fn(
      async (_message: OutboundMessageV1): Promise<{ externalEventId: string }> => ({
        externalEventId: "$unused"
      })
    );
    sender.mockResolvedValueOnce({ externalEventId: "$reply-event" });

    const result = await sendThreadedReply({ send: sender }, reply);

    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0]?.[0]).toMatchObject({
      text: reply.text,
      threadRootExternalEventId: "$previous-anchor",
      idempotencyKey: `${reply.idempotencyKey}:text`
    });
    expect(result.externalEventId).toBe("$reply-event");
    expect(result.anchorExternalEventId).toBeUndefined();
    expect(result.anchorIdempotencyKey).toBeUndefined();
  });

  it("forwards non-anchored replies unchanged", async () => {
    const reply: OutboundMessageV1 = baseReply({ text: "Plain reply" });
    const sender = vi.fn(
      async (_message: OutboundMessageV1): Promise<{ externalEventId: string }> => ({
        externalEventId: "$unused"
      })
    );
    sender.mockResolvedValueOnce({ externalEventId: "$reply-event" });

    const result = await sendThreadedReply({ send: sender }, reply);

    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0]?.[0]).toMatchObject({
      text: reply.text,
      idempotencyKey: `${reply.idempotencyKey}:text`
    });
    expect(result.externalEventId).toBe("$reply-event");
    expect(result.anchorExternalEventId).toBeUndefined();
  });

  it("threads the marker construction off the reply's id and idempotency key", () => {
    const reply: OutboundMessageV1 = baseReply({
      id: "outbound-1",
      idempotencyKey: "run_schedule:execution-1:outbound",
      threadAnchorText: "_scheduled_ — Daily review"
    });

    expect(threadAnchorMessage(reply)).toEqual({
      schemaVersion: 1,
      id: "outbound-1:anchor",
      traceId: reply.traceId,
      conversationId: reply.conversationId,
      text: "_scheduled_ — Daily review",
      images: [],
      files: [],
      presentation: "assistant",
      urgency: "normal",
      idempotencyKey: "run_schedule:execution-1:outbound:anchor"
    });
  });

  it("fans every attachment into a deterministic Matrix event", () => {
    const firstImage = {
      schemaVersion: 1 as const,
      id: "image-1",
      purpose: "outbound" as const,
      mediaType: "image/png",
      sizeBytes: 1,
      sha256: "a".repeat(64),
      storageKey: "outbound/image-1"
    };
    const secondImage = { ...firstImage, id: "image-2", storageKey: "outbound/image-2" };
    const file = {
      ...firstImage,
      id: "file-1",
      mediaType: "application/pdf",
      storageKey: "outbound/file-1"
    };
    expect(
      matrixEvents(baseReply({ text: "Done", images: [firstImage, secondImage], files: [file] }))
    ).toMatchObject([
      {
        id: "outbound-1:text",
        text: "Done",
        images: [],
        files: [],
        idempotencyKey: "run_schedule:execution-1:outbound:text"
      },
      { id: "outbound-1:image:1", images: [firstImage], files: [] },
      { id: "outbound-1:image:2", images: [secondImage], files: [] },
      { id: "outbound-1:file:1", images: [], files: [file] }
    ]);
  });

  it("delivers every generated payload under the same existing reply thread", async () => {
    const image = attachment("image-1", "image/png");
    const file = attachment("file-1", "application/pdf");
    const sender = vi.fn(async (message: OutboundMessageV1) => ({
      externalEventId: `$${message.id}`
    }));

    const result = await sendThreadedReply(
      { send: sender },
      baseReply({
        text: "Done",
        images: [image],
        files: [file],
        replyToExternalEventId: "$incoming",
        threadRootExternalEventId: "$incoming"
      })
    );

    expect(sender).toHaveBeenCalledTimes(3);
    expect(sender.mock.calls.map(([message]) => message)).toMatchObject([
      {
        id: "outbound-1:text",
        text: "Done",
        replyToExternalEventId: "$incoming",
        threadRootExternalEventId: "$incoming"
      },
      {
        id: "outbound-1:image:1",
        images: [image],
        replyToExternalEventId: "$incoming",
        threadRootExternalEventId: "$incoming"
      },
      {
        id: "outbound-1:file:1",
        files: [file],
        replyToExternalEventId: "$incoming",
        threadRootExternalEventId: "$incoming"
      }
    ]);
    expect(result.externalEventId).toBe("$outbound-1:file:1");
  });
});

function baseReply(overrides: Partial<OutboundMessageV1> = {}): OutboundMessageV1 {
  return {
    schemaVersion: 1,
    id: "outbound-1",
    traceId: "trace-1",
    conversationId: "!room:example",
    images: [],
    presentation: "assistant",
    urgency: "normal",
    idempotencyKey: "run_schedule:execution-1:outbound",
    ...overrides
  };
}

function attachment(id: string, mediaType: string) {
  return {
    schemaVersion: 1 as const,
    id,
    purpose: "outbound" as const,
    mediaType,
    sizeBytes: 1,
    sha256: "a".repeat(64),
    storageKey: `outbound/${id}`
  };
}
