import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpSessionRepository } from "./control-plane-session-client.js";

describe("HttpSessionRepository", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates and deserializes session records from the control plane", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([session()]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new HttpSessionRepository("http://control.test").listRecent({
        now: new Date(),
        limit: 1,
        includeClosed: true,
        workspaceId: "workspace-one"
      })
    ).resolves.toMatchObject([
      {
        id: "session-1",
        workspaceId: "workspace-one",
        createdAt: new Date("2026-07-27T00:00:00.000Z")
      }
    ]);
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(URL);
    if (!(request instanceof URL)) throw new Error("Expected a URL request");
    expect(request.href).toBe("http://control.test/v1/sessions?workspaceId=workspace-one");
  });

  it("preserves missing sessions and rejects malformed successful responses", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ id: "session-1" }));
    vi.stubGlobal("fetch", fetchMock);
    const repository = new HttpSessionRepository("http://control.test");

    await expect(repository.get("missing", "workspace-one")).resolves.toBeUndefined();
    await expect(repository.get("session-1", "workspace-one")).rejects.toThrow();
  });

  it("includes the selected agent when activating a thread binding", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(session()));
    vi.stubGlobal("fetch", fetchMock);

    await new HttpSessionRepository("http://control.test").activateBinding({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      agentId: "fixture-agent",
      conversationId: "!room:example",
      threadRootExternalEventId: "$thread"
    });

    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        agentId: "fixture-agent",
        conversationId: "!room:example",
        threadRootExternalEventId: "$thread"
      })
    );
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function session() {
  return {
    id: "session-1",
    workspaceId: "workspace-one",
    status: "active" as const,
    createdAt: "2026-07-27T00:00:00.000Z",
    lastActiveAt: "2026-07-27T00:00:00.000Z",
    idleExpiresAt: "2026-07-27T01:00:00.000Z",
    absoluteExpiresAt: "2026-07-28T00:00:00.000Z",
    piSessionKey: "pi-session-1",
    sourceType: "default-room" as const
  };
}
