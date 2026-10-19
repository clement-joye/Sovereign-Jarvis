import { describe, expect, it, vi } from "vitest";

import { exampleOutboundMessage } from "@second-brain/contracts";
import { INITIAL_AGENT_CATALOG } from "@second-brain/domain";

import { authorizeMatrixEvent } from "./authorization.js";
import { MatrixTextEventMapper } from "./event-mapper.js";
import { MatrixGatewayProcessor as ProductionMatrixGatewayProcessor } from "./gateway-processor.js";
import { matrixRelation, matrixTransactionId, toMatrixTextOutbound } from "./outbound.js";

const authConfig = {
  ownerMatrixId: "@owner:example",
  brainUserId: "@brain:example"
};

class MatrixGatewayProcessor extends ProductionMatrixGatewayProcessor {
  constructor(
    options: Omit<
      ConstructorParameters<typeof ProductionMatrixGatewayProcessor>[0],
      "agentCatalog" | "workspaceResolver"
    > & {
      workspaceResolver?: ConstructorParameters<
        typeof ProductionMatrixGatewayProcessor
      >[0]["workspaceResolver"];
    }
  ) {
    const workspaceResolver = options.workspaceResolver ?? {
      resolveRoom: async () => ({ workspaceId: "workspace-example", status: "active" })
    };
    super({
      ...options,
      workspaceResolver,
      agentCatalog: INITIAL_AGENT_CATALOG
    });
  }
}

describe("Matrix authorization", () => {
  it("allows only owner-authored message events", () => {
    expect(authorizeMatrixEvent(matrixTextEvent({}), authConfig)).toEqual({ authorized: true });
    expect(authorizeMatrixEvent(matrixTextEvent({ sender: "@other:example" }), authConfig)).toEqual(
      {
        authorized: false,
        reason: "wrong_sender"
      }
    );
    expect(authorizeMatrixEvent(matrixTextEvent({ sender: "@brain:example" }), authConfig)).toEqual(
      {
        authorized: false,
        reason: "self_message"
      }
    );
  });
});

describe("inactive workspace gateway boundary", () => {
  it("blocks messages for a legacy configuring workspace", async () => {
    const submitInbound = vi.fn();
    const processor = new MatrixGatewayProcessor({
      auth: { ownerMatrixId: "@owner:example", brainUserId: "@brain:example" },
      submitter: { submitInbound },
      workspaceResolver: {
        resolveRoom: async () => ({ workspaceId: "workspace-1", status: "configuring" })
      }
    });
    await expect(
      processor.process(matrixTextEvent({ body: "/workspace status" }))
    ).resolves.toEqual({
      status: "ignored",
      reason: "inactive_workspace",
      workspaceId: "workspace-1"
    });
    await expect(
      processor.process(matrixTextEvent({ eventId: "$event-2", body: "hello" }))
    ).resolves.toEqual({
      status: "ignored",
      reason: "inactive_workspace",
      workspaceId: "workspace-1"
    });
    expect(submitInbound).not.toHaveBeenCalled();
  });

  it("does not submit archived or provisioning workspace input to Pi", async () => {
    const submitInbound = vi.fn();
    const processor = new MatrixGatewayProcessor({
      auth: { ownerMatrixId: "@owner:example", brainUserId: "@brain:example" },
      submitter: { submitInbound },
      workspaceResolver: {
        resolveRoom: async () => ({ workspaceId: "workspace-1", status: "archived" })
      }
    });
    await expect(processor.process(matrixTextEvent({ body: "hello" }))).resolves.toEqual({
      status: "ignored",
      reason: "inactive_workspace",
      workspaceId: "workspace-1"
    });
    expect(submitInbound).not.toHaveBeenCalled();
  });

  it("routes active workspace lifecycle commands without sending them to Pi", async () => {
    const submitInbound = vi.fn();
    const submitRoomLifecycleCommand = vi.fn().mockResolvedValue({ handled: true });
    const processor = new MatrixGatewayProcessor({
      auth: { ownerMatrixId: "@owner:example", brainUserId: "@brain:example" },
      submitter: { submitInbound },
      workspaceResolver: {
        resolveRoom: async () => ({ workspaceId: "workspace-1", status: "active" })
      },
      lifecycleCommandSubmitter: { submitRoomLifecycleCommand }
    });

    await expect(
      processor.process(matrixTextEvent({ body: "/workspace archive" }))
    ).resolves.toEqual({
      status: "lifecycle-command",
      handled: true,
      workspaceId: "workspace-1"
    });
    expect(submitRoomLifecycleCommand).toHaveBeenCalledOnce();
    expect(submitInbound).not.toHaveBeenCalled();
  });
});

describe("workspace agent routing", () => {
  it("routes /agents to the catalog-backed room agent command service", async () => {
    const submitInbound = vi.fn();
    const submitRoomAgentCommand = vi.fn().mockResolvedValue({ handled: true });
    const processor = new MatrixGatewayProcessor({
      auth: { ownerMatrixId: "@owner:example", brainUserId: "@brain:example" },
      submitter: { submitInbound },
      workspaceResolver: {
        resolveRoom: async () => ({ workspaceId: "workspace-1", status: "active" })
      },
      agentCommandSubmitter: { submitRoomAgentCommand }
    });

    await expect(processor.process(matrixTextEvent({ body: "/agents" }))).resolves.toEqual({
      status: "lifecycle-command",
      handled: true,
      workspaceId: "workspace-1"
    });
    expect(submitRoomAgentCommand).toHaveBeenCalledOnce();
    expect(submitInbound).not.toHaveBeenCalled();
  });

  it("uses the persisted thread selection for an unprefixed follow-up", async () => {
    const submitInbound = vi
      .fn()
      .mockResolvedValue({ inboundMessageId: "inbound-1", duplicate: false });
    const resolveRoom = vi.fn().mockResolvedValue({
      workspaceId: "workspace-1",
      status: "active",
      defaultAgent: "brain",
      selectedAgent: "browser"
    });
    const processor = new MatrixGatewayProcessor({
      auth: { ownerMatrixId: "@owner:example", brainUserId: "@brain:example" },
      submitter: { submitInbound },
      workspaceResolver: { resolveRoom }
    });
    await processor.process(
      matrixTextEvent({
        body: "Continue from there",
        relatesTo: {
          rel_type: "m.thread",
          event_id: "$thread-root",
          "m.in_reply_to": { event_id: "$reply" }
        }
      })
    );
    expect(resolveRoom).toHaveBeenCalledWith({
      roomId: "!brain:example",
      threadRootExternalEventId: "$thread-root"
    });
    expect(submitInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        agentId: "browser",
        text: "Continue from there"
      })
    );
  });
});

describe("workspace plugin commands", () => {
  it("routes owner plugin commands without submitting them to Pi", async () => {
    const submitInbound = vi.fn();
    const submitRoomPluginCommand = vi.fn().mockResolvedValue({ handled: true });
    const processor = new MatrixGatewayProcessor({
      auth: { ownerMatrixId: "@owner:example", brainUserId: "@brain:example" },
      submitter: { submitInbound },
      workspaceResolver: {
        resolveRoom: async () => ({ workspaceId: "workspace-1", status: "active" })
      },
      pluginCommandSubmitter: { submitRoomPluginCommand }
    });

    await expect(
      processor.process(
        matrixTextEvent({
          body: "/plugin enable calendar-test timezone=Europe/Stockholm"
        })
      )
    ).resolves.toEqual({
      status: "lifecycle-command",
      handled: true,
      workspaceId: "workspace-1"
    });
    expect(submitRoomPluginCommand).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-1" })
    );
    expect(submitInbound).not.toHaveBeenCalled();
  });

  it("rejects plugin commands from anyone other than the configured owner", async () => {
    const submitRoomPluginCommand = vi.fn();
    const processor = new MatrixGatewayProcessor({
      auth: { ownerMatrixId: "@owner:example", brainUserId: "@brain:example" },
      submitter: { submitInbound: vi.fn() },
      workspaceResolver: {
        resolveRoom: vi.fn().mockResolvedValue({ workspaceId: "workspace-1", status: "active" })
      },
      pluginCommandSubmitter: { submitRoomPluginCommand }
    });

    await expect(
      processor.process(
        matrixTextEvent({ sender: "@other:example", body: "/plugin disable calendar-test" })
      )
    ).resolves.toEqual({ status: "ignored", reason: "wrong_sender" });
    expect(submitRoomPluginCommand).not.toHaveBeenCalled();
  });
});

function matrixTextEvent(input: {
  eventId?: string;
  roomId?: string;
  sender?: string;
  body?: string;
  originServerTs?: number;
  relatesTo?: Record<string, unknown>;
  newContent?: Record<string, unknown>;
}) {
  return {
    type: "m.room.message",
    event_id: input.eventId ?? "$event-1",
    room_id: input.roomId ?? "!brain:example",
    sender: input.sender ?? "@owner:example",
    origin_server_ts: input.originServerTs ?? Date.parse("2026-07-17T15:00:00.000Z"),
    content: {
      msgtype: "m.text",
      body: input.body ?? "hello",
      ...(input.relatesTo ? { "m.relates_to": input.relatesTo } : {}),
      ...(input.newContent ? { "m.new_content": input.newContent } : {})
    }
  };
}

describe("Matrix text mapper", () => {
  it("maps text events into canonical inbound messages", () => {
    const mapper = new MatrixTextEventMapper();

    expect(mapper.toInboundMessage(matrixTextEvent({ body: "hello" }))).toMatchObject({
      transport: "matrix",
      externalEventId: "$event-1",
      conversationId: "!brain:example",
      senderId: "@owner:example",
      kind: "text",
      text: "hello",
      attachments: [],
      receivedAt: "2026-07-17T15:00:00.000Z"
    });
  });

  it("marks slash-prefixed text as commands", () => {
    const mapper = new MatrixTextEventMapper();

    expect(mapper.toInboundMessage(matrixTextEvent({ body: "/new" })).kind).toBe("command");
  });

  it("removes a Matrix reply fallback before recognizing a command", () => {
    const mapper = new MatrixTextEventMapper();
    const message = mapper.toInboundMessage(
      matrixTextEvent({
        body: "> <@jarvis:example> Approval required\n> Push main\n\n/yes",
        relatesTo: { "m.in_reply_to": { event_id: "$approval-prompt" } }
      })
    );

    expect(message).toMatchObject({
      kind: "command",
      text: "/yes",
      replyToExternalEventId: "$approval-prompt"
    });
  });

  it("extracts reply, thread, and edit relations", () => {
    const mapper = new MatrixTextEventMapper();

    expect(
      mapper.toInboundMessage(
        matrixTextEvent({
          relatesTo: {
            "m.in_reply_to": { event_id: "$reply" },
            rel_type: "m.thread",
            event_id: "$thread-root"
          }
        })
      )
    ).toMatchObject({
      replyToExternalEventId: "$reply",
      threadRootExternalEventId: "$thread-root"
    });

    expect(
      mapper.toInboundMessage(
        matrixTextEvent({
          body: "old",
          relatesTo: { rel_type: "m.replace", event_id: "$old-event" },
          newContent: { msgtype: "m.text", body: "new" }
        })
      )
    ).toMatchObject({
      text: "new",
      replacesExternalEventId: "$old-event"
    });
  });

  it("maps image, audio, and file events into canonical attachments", () => {
    const mapper = new MatrixTextEventMapper();

    expect(mapper.toInboundMessage(matrixMediaEvent("m.image"))).toMatchObject({
      kind: "image",
      attachments: [
        {
          purpose: "inbound",
          mediaType: "image/png",
          width: 100,
          height: 50
        }
      ]
    });
    expect(mapper.toInboundMessage(matrixMediaEvent("m.audio"))).toMatchObject({
      kind: "audio",
      attachments: [
        {
          purpose: "inbound",
          mediaType: "audio/ogg",
          durationMs: 1200
        }
      ]
    });
    expect(mapper.toInboundMessage(matrixMediaEvent("m.audio")).text).toBeUndefined();
    expect(mapper.toInboundMessage(matrixMediaEvent("m.file"))).toMatchObject({
      kind: "document",
      attachments: [{ purpose: "inbound", mediaType: "application/pdf" }]
    });
  });

  it("uses gateway-stored media metadata when an event has been downloaded", () => {
    const mapper = new MatrixTextEventMapper();
    const event = matrixMediaEvent("m.image");
    (event.content as Record<string, unknown>)["org.second-brain.stored_attachment"] = {
      storage_key: "inbound/matrix/image-1.png",
      size_bytes: 1234,
      sha256: "a".repeat(64)
    };

    expect(mapper.toInboundMessage(event).attachments[0]).toMatchObject({
      storageKey: "inbound/matrix/image-1.png",
      sizeBytes: 1234,
      sha256: "a".repeat(64)
    });
  });
});

describe("Matrix outbound mapping", () => {
  it("derives a stable transaction id from outbound idempotency key", () => {
    expect(matrixTransactionId(exampleOutboundMessage)).toBe(
      matrixTransactionId({ ...exampleOutboundMessage })
    );
  });

  it("maps canonical outbound text to Matrix text content", () => {
    expect(
      toMatrixTextOutbound({
        ...exampleOutboundMessage,
        replyToExternalEventId: "$reply",
        threadRootExternalEventId: "$thread"
      })
    ).toEqual({
      msgtype: "m.text",
      body: "Done.",
      format: "org.matrix.custom.html",
      formatted_body: "<p>Done.</p>",
      "m.relates_to": {
        "m.in_reply_to": { event_id: "$reply" },
        rel_type: "m.thread",
        event_id: "$thread",
        is_falling_back: true
      }
    });
  });

  it("reuses the same thread relation for every outbound message type", () => {
    expect(
      matrixRelation({
        ...exampleOutboundMessage,
        replyToExternalEventId: "$root",
        threadRootExternalEventId: "$root"
      })
    ).toEqual({
      "m.in_reply_to": { event_id: "$root" },
      rel_type: "m.thread",
      event_id: "$root",
      is_falling_back: true
    });
  });

  it("renders Markdown as safe Matrix HTML while retaining the plain fallback", () => {
    expect(
      toMatrixTextOutbound({
        ...exampleOutboundMessage,
        text: "# Plan\n\n- **First**\n- `second`\n\n<script>alert('no')</script>"
      })
    ).toMatchObject({
      body: "# Plan\n\n- **First**\n- `second`\n\n<script>alert('no')</script>",
      format: "org.matrix.custom.html",
      formatted_body:
        "<h1>Plan</h1>\n<ul>\n<li><strong>First</strong></li>\n<li><code>second</code></li>\n</ul>\n<p>&lt;script&gt;alert(&#39;no&#39;)&lt;/script&gt;</p>"
    });
  });

  it("renders semantic notices as safely escaped Matrix notices in the same thread", () => {
    expect(
      toMatrixTextOutbound({
        ...exampleOutboundMessage,
        presentation: "notice",
        text: "Delegating to <Browser>…\nStill working…",
        threadRootExternalEventId: "$thread"
      })
    ).toEqual({
      msgtype: "m.notice",
      body: "Delegating to <Browser>…\nStill working…",
      format: "org.matrix.custom.html",
      formatted_body: "<p>Delegating to &lt;Browser&gt;…<br>Still working…</p>",
      "m.relates_to": {
        rel_type: "m.thread",
        event_id: "$thread",
        is_falling_back: true
      }
    });
  });

  it("keeps errors as regular text messages so they remain visible", () => {
    expect(
      toMatrixTextOutbound({
        ...exampleOutboundMessage,
        presentation: "error",
        text: "Could not complete that request."
      })
    ).toMatchObject({
      msgtype: "m.text",
      body: "Could not complete that request."
    });
  });

  it("renders the remaining supported Markdown blocks", () => {
    expect(
      toMatrixTextOutbound({
        ...exampleOutboundMessage,
        text: "1. First\n2. Second\n\n> Quote\n\n---\n\n```\n<code>\n```"
      }).formatted_body
    ).toBe(
      "<ol>\n<li>First</li>\n<li>Second</li>\n</ol>\n<blockquote>Quote</blockquote>\n<hr>\n<pre><code>&lt;code&gt;</code></pre>"
    );
  });
});

describe("Matrix gateway processor", () => {
  it("accepts only rooms resolved by the trusted workspace registry", async () => {
    const submitted: string[] = [];
    const processor = new MatrixGatewayProcessor({
      auth: { ownerMatrixId: "@owner:example", brainUserId: "@brain:example" },
      workspaceResolver: {
        async resolveRoom(input) {
          const roomId = typeof input === "string" ? input : input.roomId;
          return roomId === "!project:example" ? { workspaceId: "workspace-project" } : undefined;
        }
      },
      submitter: {
        async submitInbound(message) {
          submitted.push(message.externalEventId);
          return { inboundMessageId: message.id, duplicate: false };
        }
      }
    });

    await expect(
      processor.process(matrixTextEvent({ roomId: "!project:example", eventId: "$project" }))
    ).resolves.toMatchObject({ status: "submitted" });
    await expect(
      processor.process(matrixTextEvent({ roomId: "!unbound:example", eventId: "$unbound" }))
    ).resolves.toEqual({ status: "ignored", reason: "unbound_workspace" });
    expect(submitted).toEqual(["$project"]);
  });

  it("submits authorized text once and ignores unauthorized events", async () => {
    const submitted: string[] = [];
    const processor = new MatrixGatewayProcessor({
      auth: authConfig,
      submitter: {
        async submitInbound(message) {
          submitted.push(message.externalEventId);
          return { inboundMessageId: message.id, duplicate: false };
        }
      }
    });

    await expect(processor.process(matrixTextEvent({ eventId: "$ok" }))).resolves.toMatchObject({
      status: "submitted",
      duplicate: false
    });
    await expect(
      processor.process(matrixTextEvent({ eventId: "$bad", sender: "@other:example" }))
    ).resolves.toEqual({ status: "ignored", reason: "wrong_sender" });
    expect(submitted).toEqual(["$ok"]);
  });

  it("enriches accepted messages before submitting them", async () => {
    let submittedTimezone: string | undefined;
    const processor = new MatrixGatewayProcessor({
      auth: authConfig,
      enrichMessage: async (message) => ({ ...message, userTimezone: "America/New_York" }),
      submitter: {
        async submitInbound(message) {
          submittedTimezone = message.userTimezone;
          return { inboundMessageId: message.id, duplicate: false };
        }
      }
    });

    await processor.process(matrixTextEvent({ eventId: "$timezone" }));
    expect(submittedTimezone).toBe("America/New_York");
  });

  it("submits a sequential Matrix sync replay once", async () => {
    const submitted: string[] = [];
    const processor = new MatrixGatewayProcessor({
      auth: authConfig,
      submitter: {
        async submitInbound(message) {
          submitted.push(message.externalEventId);
          return { inboundMessageId: message.id, duplicate: false };
        }
      }
    });
    const event = matrixTextEvent({ eventId: "$replayed" });

    const first = await processor.process(event);
    const replay = await processor.process(event);

    expect(first).toMatchObject({
      status: "submitted",
      inboundMessageId: "inbound-JHJlcGxheWVk",
      duplicate: false
    });
    expect(replay).toMatchObject({
      status: "submitted",
      inboundMessageId: "inbound-JHJlcGxheWVk",
      duplicate: true
    });
    expect(submitted).toEqual(["$replayed"]);
  });

  it("coalesces concurrent duplicate Matrix sync deliveries", async () => {
    const submitted: string[] = [];
    const processor = new MatrixGatewayProcessor({
      auth: authConfig,
      submitter: {
        async submitInbound(message) {
          submitted.push(message.externalEventId);
          return { inboundMessageId: message.id, duplicate: false };
        }
      }
    });
    const event = matrixTextEvent({ eventId: "$concurrent-replay" });

    const [first, replay] = await Promise.all([processor.process(event), processor.process(event)]);

    expect(first).toMatchObject({ status: "submitted", duplicate: false });
    expect(replay).toMatchObject({ status: "submitted", duplicate: true });
    expect(submitted).toEqual(["$concurrent-replay"]);
  });

  it("allows an event to be retried after control-plane acceptance fails", async () => {
    let submissionCount = 0;
    const processor = new MatrixGatewayProcessor({
      auth: authConfig,
      submitter: {
        async submitInbound(message) {
          submissionCount += 1;
          if (submissionCount === 1) {
            throw new Error("control plane unavailable");
          }
          return { inboundMessageId: message.id, duplicate: false };
        }
      }
    });
    const event = matrixTextEvent({ eventId: "$retry-after-failure" });

    await expect(processor.process(event)).rejects.toThrow("control plane unavailable");
    await expect(processor.process(event)).resolves.toMatchObject({
      status: "submitted",
      inboundMessageId: "inbound-JHJldHJ5LWFmdGVyLWZhaWx1cmU",
      duplicate: false
    });
    expect(submissionCount).toBe(2);
  });
});

function matrixMediaEvent(msgtype: "m.image" | "m.audio" | "m.file") {
  return {
    type: "m.room.message",
    event_id: `$${msgtype}`,
    room_id: "!brain:example",
    sender: "@owner:example",
    origin_server_ts: Date.parse("2026-07-17T15:00:00.000Z"),
    content: {
      msgtype,
      body:
        msgtype === "m.image" ? "photo.png" : msgtype === "m.audio" ? "voice.ogg" : "document.pdf",
      url: "mxc://example/media",
      info:
        msgtype === "m.image"
          ? { mimetype: "image/png", size: 1024, w: 100, h: 50 }
          : msgtype === "m.audio"
            ? { mimetype: "audio/ogg", size: 2048, duration: 1200 }
            : { mimetype: "application/pdf", size: 4096 }
    }
  };
}
