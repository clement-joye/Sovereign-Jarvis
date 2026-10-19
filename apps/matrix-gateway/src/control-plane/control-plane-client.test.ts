import { afterEach, describe, expect, it, vi } from "vitest";

import { exampleInboundMessage, exampleOutboundMessage } from "@second-brain/contracts";

import {
  HttpControlPlaneOutboundClient,
  HttpControlPlaneSubmitter,
  HttpControlPlaneWorkspaceClient
} from "./control-plane-client.js";

describe("HttpControlPlaneSubmitter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a contract-valid inbound acknowledgement and starts typing", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse({ inboundMessageId: "inbound-1", duplicate: false, jobId: "job-1" })
        )
    );
    const typing = { start: vi.fn(), stop: vi.fn(), stopThread: vi.fn() };

    await expect(
      new HttpControlPlaneSubmitter("http://control.test", typing).submitInbound(
        exampleInboundMessage
      )
    ).resolves.toEqual({ inboundMessageId: "inbound-1", duplicate: false });
    expect(typing.start).toHaveBeenCalledWith({ traceId: "trace-1", roomId: "!room:example" });
  });

  it("rejects malformed inbound acknowledgements before starting typing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ inboundMessageId: "inbound-1" }))
    );
    const typing = { start: vi.fn(), stop: vi.fn(), stopThread: vi.fn() };

    await expect(
      new HttpControlPlaneSubmitter("http://control.test", typing).submitInbound(
        exampleInboundMessage
      )
    ).rejects.toThrow();
    expect(typing.start).not.toHaveBeenCalled();
  });

  it("clears the matching thread when /cancel is accepted without starting command typing", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse({ inboundMessageId: "inbound-cancel", duplicate: false, jobId: "job-2" })
        )
    );
    const typing = { start: vi.fn(), stop: vi.fn(), stopThread: vi.fn() };

    await new HttpControlPlaneSubmitter("http://control.test", typing).submitInbound({
      ...exampleInboundMessage,
      kind: "command",
      text: "/cancel",
      threadRootExternalEventId: "$thread"
    });

    expect(typing.stopThread).toHaveBeenCalledExactlyOnceWith({
      roomId: "!room:example",
      threadRootExternalEventId: "$thread"
    });
    expect(typing.start).not.toHaveBeenCalled();
  });

  it("does not restart typing for a duplicate inbound event", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse({ inboundMessageId: "inbound-1", duplicate: true, jobId: "job-1" })
        )
    );
    const typing = { start: vi.fn(), stop: vi.fn(), stopThread: vi.fn() };

    await new HttpControlPlaneSubmitter("http://control.test", typing).submitInbound(
      exampleInboundMessage
    );

    expect(typing.start).not.toHaveBeenCalled();
  });
});

describe("HttpControlPlaneOutboundClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates claimed outbound messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([exampleOutboundMessage]))
    );

    await expect(
      new HttpControlPlaneOutboundClient("http://control.test").claim(1)
    ).resolves.toEqual([exampleOutboundMessage]);
  });

  it("rejects malformed delivery results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ outboundMessageId: "outbound-1" }))
    );

    await expect(
      new HttpControlPlaneOutboundClient("http://control.test").delivered("outbound-1", "$event-1")
    ).rejects.toThrow();
  });

  it("posts anchor-delivered callbacks with the conversation id and parses the ok response", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new HttpControlPlaneOutboundClient("http://control.test").anchorDelivered(
        "run_schedule:execution-1:outbound:anchor",
        "$anchor-event-1",
        "!room:example"
      )
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://control.test/v1/outbound/anchor-delivered",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          anchorIdempotencyKey: "run_schedule:execution-1:outbound:anchor",
          anchorExternalEventId: "$anchor-event-1",
          conversationId: "!room:example"
        })
      })
    );
  });

  it("rejects malformed anchor-delivered responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "nope" }))
    );

    await expect(
      new HttpControlPlaneOutboundClient("http://control.test").anchorDelivered(
        "run_schedule:execution-1:outbound:anchor",
        "$anchor-event-1",
        "!room:example"
      )
    ).rejects.toThrow();
  });
});

describe("HttpControlPlaneWorkspaceClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves active rooms and treats an unbound room as absent", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          workspaceId: "workspace-project",
          templateId: "code",
          templateVersion: "1.0.0",
          status: "configuring"
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "workspace_room_not_found" }), { status: 404 })
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = new HttpControlPlaneWorkspaceClient("http://control.test");

    await expect(client.resolveRoom("!project:example")).resolves.toEqual({
      workspaceId: "workspace-project",
      status: "configuring"
    });
    await expect(client.resolveRoom("!unknown:example")).resolves.toBeUndefined();
  });

  it("accepts a trusted invite through the dedicated lifecycle route", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        workspaceId: "workspace-1",
        templateId: "workspace-onboarding",
        templateVersion: "0.0.0",
        created: true
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new HttpControlPlaneWorkspaceClient("http://control.test").acceptTrustedInvite(
        "!project:example"
      )
    ).resolves.toEqual({ created: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://control.test/v1/workspaces/accept-trusted-invite",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ roomId: "!project:example" })
      })
    );
  });

  it("submits configuring-workspace commands without trusting a workspace id", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ handled: true }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new HttpControlPlaneWorkspaceClient("http://control.test");

    await expect(
      client.submitRoomLifecycleCommand({
        schemaVersion: 1,
        id: "inbound-1",
        externalEventId: "$event-1",
        transport: "matrix",
        conversationId: "!project:example",
        workspaceId: "workspace-ignored",
        senderId: "@owner:example",
        kind: "command",
        text: "/workspace status",
        attachments: [],
        receivedAt: "2026-08-04T16:00:00.000Z",
        traceId: "trace-1",
        metadata: {}
      })
    ).resolves.toEqual({ handled: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://control.test/v1/workspaces/lifecycle-command",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          roomId: "!project:example",
          externalEventId: "$event-1",
          traceId: "trace-1",
          text: "/workspace status"
        })
      })
    );
  });

  it("submits plugin commands by room without forwarding a caller-supplied workspace id", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ handled: true }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new HttpControlPlaneWorkspaceClient("http://control.test");

    await expect(
      client.submitRoomPluginCommand({
        schemaVersion: 1,
        id: "inbound-1",
        externalEventId: "$event-1",
        transport: "matrix",
        conversationId: "!project:example",
        workspaceId: "workspace-ignored",
        senderId: "@owner:example",
        kind: "command",
        text: "/plugin status calendar-test",
        attachments: [],
        receivedAt: "2026-09-08T15:00:00.000Z",
        traceId: "trace-1",
        metadata: {}
      })
    ).resolves.toEqual({ handled: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://control.test/v1/workspaces/plugin-command",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          roomId: "!project:example",
          externalEventId: "$event-1",
          traceId: "trace-1",
          text: "/plugin status calendar-test"
        })
      })
    );
  });

  it("archives a room through the trusted lifecycle endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ archived: true }));
    vi.stubGlobal("fetch", fetchMock);
    await new HttpControlPlaneWorkspaceClient("http://control.test").archiveRoom(
      "!project:example"
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://control.test/v1/workspaces/archive-room",
      expect.objectContaining({ body: JSON.stringify({ roomId: "!project:example" }) })
    );
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 202 });
}
