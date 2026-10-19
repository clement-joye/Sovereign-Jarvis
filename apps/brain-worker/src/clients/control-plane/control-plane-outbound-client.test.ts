import { afterEach, describe, expect, it, vi } from "vitest";

import { exampleOutboundMessage } from "@second-brain/contracts";

import { HttpOutboundRepository } from "./control-plane-outbound-client.js";

describe("HttpOutboundRepository", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates outbound messages returned by the control plane", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(exampleOutboundMessage))
    );

    await expect(
      new HttpOutboundRepository("http://control.test").create(exampleOutboundMessage)
    ).resolves.toEqual(exampleOutboundMessage);
  });

  it("preserves missing outbound messages and rejects malformed successful responses", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ id: "outbound-1" }));
    vi.stubGlobal("fetch", fetchMock);
    const repository = new HttpOutboundRepository("http://control.test");

    await expect(repository.get("missing")).resolves.toBeUndefined();
    await expect(repository.get("outbound-1")).rejects.toThrow();
  });

  it("includes workspace scope in idempotency lookups", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(exampleOutboundMessage));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new HttpOutboundRepository("http://control.test").getByIdempotencyKey("same", "workspace-one")
    ).resolves.toEqual(exampleOutboundMessage);

    const request = fetchMock.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(URL);
    if (!(request instanceof URL)) throw new Error("Expected a URL request");
    expect(request.href).toBe(
      "http://control.test/v1/outbound/idempotency/same?workspaceId=workspace-one"
    );
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}
