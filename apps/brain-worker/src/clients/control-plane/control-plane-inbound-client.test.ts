import { afterEach, describe, expect, it, vi } from "vitest";

import { exampleInboundMessage } from "@second-brain/contracts";

import { HttpInboundMessageRepository } from "./control-plane-inbound-client.js";

describe("HttpInboundMessageRepository", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates inbound messages returned by the control plane", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(exampleInboundMessage))
    );

    await expect(
      new HttpInboundMessageRepository("http://control.test").get(exampleInboundMessage.id)
    ).resolves.toEqual(exampleInboundMessage);
  });

  it("returns undefined for missing messages and rejects malformed successful responses", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ id: "inbound-1" }));
    vi.stubGlobal("fetch", fetchMock);
    const repository = new HttpInboundMessageRepository("http://control.test");

    await expect(repository.get("missing")).resolves.toBeUndefined();
    await expect(repository.get("inbound-1")).rejects.toThrow();
  });

  it("loads bounded thread history for the message being processed", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse([
          { sender: "user", text: "Earlier request", occurredAt: "2026-08-14T10:00:00.000Z" }
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new HttpInboundMessageRepository("http://control.test").listThreadHistory({
        message: exampleInboundMessage,
        limit: 12
      })
    ).resolves.toEqual([
      { sender: "user", text: "Earlier request", occurredAt: "2026-08-14T10:00:00.000Z" }
    ]);
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(URL);
    if (!(request instanceof URL)) throw new Error("Expected a URL request");
    expect(request.href).toBe(
      `http://control.test/v1/inbound/${exampleInboundMessage.id}/thread-history?limit=12`
    );
  });

  it("sends a workspace-scoped audio transcript to Brain Control", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ stored: true }));
    vi.stubGlobal("fetch", fetchMock);

    await new HttpInboundMessageRepository("http://control.test").saveAudioTranscript({
      id: "inbound-audio-1",
      workspaceId: "workspace-1",
      text: "Remember the blue folder."
    });

    const requestUrl = fetchMock.mock.calls[0]?.[0];
    expect(requestUrl).toBeInstanceOf(URL);
    if (!(requestUrl instanceof URL)) throw new Error("Expected a URL request");
    expect(requestUrl.pathname).toBe("/v1/inbound/inbound-audio-1/audio-transcript");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ workspaceId: "workspace-1", text: "Remember the blue folder." })
    });
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}
