import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpConversationPreferenceRepository } from "./control-plane-preference-client.js";

describe("HttpConversationPreferenceRepository", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates voice-preference responses from the control plane", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ enabled: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new HttpConversationPreferenceRepository("http://control.test").getVoiceReplies({
        workspaceId: "workspace-1",
        conversationId: "room-1"
      })
    ).resolves.toBe(true);
    const body = fetchMock.mock.calls[0]?.[1]?.body;
    if (typeof body !== "string") throw new Error("Expected a JSON request body.");
    expect(JSON.parse(body)).toEqual({
      workspaceId: "workspace-1",
      conversationId: "room-1"
    });
  });

  it("rejects malformed voice-preference responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ enabled: "yes" }))
    );

    await expect(
      new HttpConversationPreferenceRepository("http://control.test").setVoiceReplies({
        conversationId: "room-1",
        enabled: true
      })
    ).rejects.toThrow();
  });

  it("gets, updates, and resets session context preferences", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ mode: "persistent", historyLimit: 5 }))
      .mockResolvedValueOnce(jsonResponse({ historyLimit: 2 }))
      .mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal("fetch", fetch);
    const repository = new HttpConversationPreferenceRepository("http://control.test");

    await expect(repository.getSessionContext({ conversationId: "room-1" })).resolves.toEqual({
      mode: "persistent",
      historyLimit: 5
    });
    await expect(
      repository.setSessionContext({ conversationId: "room-1", historyLimit: 2 })
    ).resolves.toEqual({ historyLimit: 2 });
    await expect(repository.setSessionContext({ conversationId: "room-1" })).resolves.toEqual({});

    const body = fetch.mock.calls[2]?.[1]?.body;
    if (typeof body !== "string") throw new Error("Expected a JSON request body.");
    const resetBody = JSON.parse(body) as Record<string, unknown>;
    expect(resetBody).toMatchObject({ mode: null, historyLimit: null });
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}
