import { afterEach, describe, expect, it, vi } from "vitest";

import { exampleInboundMessage } from "@second-brain/contracts";

import { HttpApprovalCommandHandler } from "./control-plane-approval-command-client.js";

describe("HttpApprovalCommandHandler", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forwards the trusted inbound approval command to Brain Control", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        kind: "command-response",
        command: "approve",
        text: "**Approved action completed**"
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const message = {
      ...exampleInboundMessage,
      workspaceId: "workspace-1",
      text: "/approve action-proposal-1"
    };

    await expect(
      new HttpApprovalCommandHandler("http://control.test").handle(message, {
        type: "approve",
        proposalId: "action-proposal-1"
      })
    ).resolves.toBe("**Approved action completed**");

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/v1/session-routing/matrix", "http://control.test"),
      expect.objectContaining({ method: "POST", body: JSON.stringify(message) })
    );
  });

  it("rejects a response that is not a command result", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse({ kind: "send-to-pi", resolution: { sessionId: "session-1" } })
        )
    );

    await expect(
      new HttpApprovalCommandHandler("http://control.test").handle(exampleInboundMessage, {
        type: "reject",
        proposalId: "action-proposal-1"
      })
    ).rejects.toThrow("invalid approval command response");
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}
