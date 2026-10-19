import { describe, expect, it } from "vitest";

import { InMemoryAgentCollaborationRepository } from "./in-memory-agent-collaboration-repository.js";

describe("InMemoryAgentCollaborationRepository delegation notice claims", () => {
  it("retains allowed and denied decisions for retries and enforces the root cap", async () => {
    const repository = new InMemoryAgentCollaborationRepository();

    await expect(repository.claimDelegationNotice("root", "child-1", 2)).resolves.toBe(true);
    await expect(repository.claimDelegationNotice("root", "child-1", 2)).resolves.toBe(true);
    await expect(repository.claimDelegationNotice("root", "child-2", 2)).resolves.toBe(true);
    await expect(repository.claimDelegationNotice("root", "child-3", 2)).resolves.toBe(false);
    await expect(repository.claimDelegationNotice("root", "child-3", 2)).resolves.toBe(false);
    await expect(repository.claimDelegationNotice("another-root", "child-3", 2)).resolves.toBe(
      true
    );
  });

  it("rejects an invalid cap", async () => {
    const repository = new InMemoryAgentCollaborationRepository();
    await expect(repository.claimDelegationNotice("root", "child", 0)).rejects.toThrow(
      "Notice limit must be a positive integer."
    );
  });
});
