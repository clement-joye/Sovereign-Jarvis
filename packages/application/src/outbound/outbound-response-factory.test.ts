import { describe, expect, it, vi } from "vitest";

import { OutboundResponseFactory } from "./outbound-response-factory.js";
import type { OutboundRepositoryPort } from "../ports.js";

describe("OutboundResponseFactory", () => {
  it("returns an existing response without allocating another outbound ID", async () => {
    const existing = outbound({ id: "outbound-existing", idempotencyKey: "reply-1" });
    const outbounds = {
      get: vi.fn(),
      getByIdempotencyKey: vi.fn().mockResolvedValue(existing),
      create: vi.fn()
    };
    const ids = { nextId: vi.fn(() => "outbound-new") };
    const factory = new OutboundResponseFactory(outbounds, ids);

    await expect(factory.getOrBuild(input())).resolves.toBe(existing);
    expect(ids.nextId).not.toHaveBeenCalled();
  });

  it("builds and persists a normal-priority response when no idempotent match exists", async () => {
    const outbounds = {
      get: vi.fn(),
      getByIdempotencyKey: vi.fn().mockResolvedValue(undefined),
      create: vi.fn<OutboundRepositoryPort["create"]>(async (message) => message)
    };
    const ids = { nextId: vi.fn(() => "outbound-new") };
    const factory = new OutboundResponseFactory(outbounds, ids);

    const message = await factory.getOrBuild(input());
    await expect(factory.create(message)).resolves.toEqual(
      expect.objectContaining({
        id: "outbound-new",
        idempotencyKey: "reply-1",
        urgency: "normal"
      })
    );
  });

  it("propagates threadAnchorText onto the built outbound so the gateway can thread it", async () => {
    const outbounds = {
      get: vi.fn(),
      getByIdempotencyKey: vi.fn().mockResolvedValue(undefined),
      create: vi.fn<OutboundRepositoryPort["create"]>(async (message) => message)
    };
    const ids = { nextId: vi.fn(() => "outbound-new") };
    const factory = new OutboundResponseFactory(outbounds, ids);

    const message = await factory.getOrBuild({
      ...input(),
      threadAnchorText: "_scheduled_ — Daily summary"
    });

    expect(message).toMatchObject({ threadAnchorText: "_scheduled_ — Daily summary" });
  });

  it("preserves semantic presentation and origin scope for idempotent notices", async () => {
    const outbounds = {
      get: vi.fn(),
      getByIdempotencyKey: vi.fn().mockResolvedValue(undefined),
      create: vi.fn<OutboundRepositoryPort["create"]>(async (message) => message)
    };
    const factory = new OutboundResponseFactory(outbounds, { nextId: () => "outbound-notice" });

    const message = await factory.getOrBuild({
      ...input(),
      presentation: "notice",
      threadRootExternalEventId: "$origin-thread"
    });

    expect(message).toMatchObject({
      conversationId: "!room:example",
      workspaceId: "workspace-example",
      threadRootExternalEventId: "$origin-thread",
      presentation: "notice",
      idempotencyKey: "reply-1"
    });
  });
});

function input() {
  return {
    idempotencyKey: "reply-1",
    traceId: "trace-1",
    conversationId: "!room:example",
    workspaceId: "workspace-example",
    text: "Hello"
  };
}

function outbound(input: { id: string; idempotencyKey: string }) {
  return {
    schemaVersion: 1 as const,
    id: input.id,
    traceId: "trace-1",
    conversationId: "!room:example",
    workspaceId: "workspace-example",
    text: "Hello",
    images: [],
    presentation: "assistant" as const,
    urgency: "normal" as const,
    idempotencyKey: input.idempotencyKey
  };
}
