import { describe, expect, it } from "vitest";

import type { EffectiveRunPolicyV2 } from "@second-brain/contracts";

import { selectEffectiveRunPolicy } from "./effective-run-policy-selector.js";
import { TerminalWorkerError } from "../workers/worker-errors.js";

const policy: EffectiveRunPolicyV2 = {
  schemaVersion: 2,
  catalogDigest: `sha256:${"a".repeat(64)}`,
  platformPolicyDigest: `sha256:${"c".repeat(64)}`,
  resourceDigest: `sha256:${"d".repeat(64)}`,
  runtimeImageId: `sha256:${"e".repeat(64)}`,
  policyDigest: `sha256:${"b".repeat(64)}`,
  workspaceId: "workspace-1",
  agentId: "brain",
  pluginIds: ["core"],
  capabilityIds: [],
  toolIds: [],
  skillPaths: [],
  extensionPaths: []
};

describe("selectEffectiveRunPolicy", () => {
  it("preserves legacy behavior when snapshots are absent", () => {
    expect(
      selectEffectiveRunPolicy(undefined, { workspaceId: "workspace-1", agentId: "brain" })
    ).toBeUndefined();
  });

  it("selects the exact workspace and agent snapshot", () => {
    expect(
      selectEffectiveRunPolicy([policy], { workspaceId: "workspace-1", agentId: "brain" })
    ).toBe(policy);
  });

  it("fails closed when no exact snapshot matches", () => {
    expect(() =>
      selectEffectiveRunPolicy([policy], { workspaceId: "workspace-2", agentId: "brain" })
    ).toThrow(
      new TerminalWorkerError(
        "No effective run policy matches workspace workspace-2 and agent brain."
      )
    );
  });
});
