import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  CompiledAgentV2,
  CompiledCapabilityProviderV2,
  EffectiveRunPolicyV2,
  PiRunRequestV1
} from "@second-brain/contracts";
import { examplePiRunRequest } from "@second-brain/contracts";

import {
  validatePiEffectiveRunPolicy,
  type ReviewedPlatformCatalogReader
} from "./pi-effective-run-policy.js";

const catalogDigest = `sha256:${"a".repeat(64)}`;
const platformPolicyDigest = `sha256:${"b".repeat(64)}`;
const resourceDigest = `sha256:${"c".repeat(64)}`;
const runtimeImageId = `sha256:${"d".repeat(64)}`;
const capability = {
  capabilityId: "notes",
  pluginId: "core",
  toolIds: ["read_notes"]
} as unknown as CompiledCapabilityProviderV2;
const agent = {
  id: "brain",
  pluginId: "core",
  capabilityIds: ["notes"],
  skillPaths: ["skills/notes"],
  extensionPaths: ["extensions/notes"]
} as unknown as CompiledAgentV2;

function policyWithoutDigest(): Omit<EffectiveRunPolicyV2, "policyDigest"> {
  return {
    schemaVersion: 2,
    catalogDigest,
    platformPolicyDigest,
    resourceDigest,
    runtimeImageId,
    workspaceId: "workspace-1",
    agentId: "brain",
    pluginIds: ["core"],
    capabilityIds: ["notes"],
    toolIds: ["read_notes"],
    skillPaths: ["skills/notes"],
    extensionPaths: ["extensions/notes"]
  };
}

function withDigest(content: Omit<EffectiveRunPolicyV2, "policyDigest">): EffectiveRunPolicyV2 {
  return {
    ...content,
    policyDigest: `sha256:${createHash("sha256").update(JSON.stringify(content)).digest("hex")}`
  };
}

function reader(): ReviewedPlatformCatalogReader {
  return {
    catalog: { digest: catalogDigest, policyDigest: platformPolicyDigest, resourceDigest },
    getAgent: (id) => (id === agent.id ? agent : undefined),
    getCapability: (id) => (id === capability.capabilityId ? capability : undefined)
  };
}

function identity() {
  return { platformPolicyDigest, resourceDigest, runtimeImageId };
}

function request(policy: EffectiveRunPolicyV2): PiRunRequestV1 {
  return { ...examplePiRunRequest, workspaceId: "workspace-1", effectiveRunPolicy: policy };
}

describe("validatePiEffectiveRunPolicy", () => {
  it("accepts and returns a policy whose digest and reviewed closure are valid", () => {
    const policy = withDigest(policyWithoutDigest());
    expect(validatePiEffectiveRunPolicy(request(policy), reader(), identity())).toEqual(policy);
  });

  it("fails closed when the policy is absent or its digest is tampered", () => {
    expect(() => validatePiEffectiveRunPolicy(examplePiRunRequest, reader(), identity())).toThrow(
      "missing an effective run policy"
    );
    const policy = withDigest(policyWithoutDigest());
    expect(() =>
      validatePiEffectiveRunPolicy(
        request({ ...policy, policyDigest: catalogDigest }),
        reader(),
        identity()
      )
    ).toThrow("digest is invalid");
  });

  it("rejects a policy capability that is not granted by the reviewed agent", () => {
    expect(() =>
      validatePiEffectiveRunPolicy(
        request(withDigest({ ...policyWithoutDigest(), capabilityIds: ["missing"], toolIds: [] })),
        reader(),
        identity()
      )
    ).toThrow("not granted");
  });

  it("rejects non-canonical or tool-less capability snapshots", () => {
    const secondCapability = {
      ...capability,
      capabilityId: "alerts",
      toolIds: ["read_alerts"]
    } as CompiledCapabilityProviderV2;
    const expandedAgent = {
      ...agent,
      capabilityIds: ["notes", "alerts"]
    } as CompiledAgentV2;
    const expandedReader: ReviewedPlatformCatalogReader = {
      catalog: { digest: catalogDigest, policyDigest: platformPolicyDigest, resourceDigest },
      getAgent: () => expandedAgent,
      getCapability: (id) =>
        id === capability.capabilityId
          ? capability
          : id === secondCapability.capabilityId
            ? secondCapability
            : undefined
    };

    expect(() =>
      validatePiEffectiveRunPolicy(
        request(
          withDigest({
            ...policyWithoutDigest(),
            capabilityIds: ["notes", "alerts"],
            toolIds: ["read_notes", "read_alerts"]
          })
        ),
        expandedReader,
        identity()
      )
    ).toThrow("canonical order");
    expect(() =>
      validatePiEffectiveRunPolicy(
        request(
          withDigest({
            ...policyWithoutDigest(),
            capabilityIds: ["alerts", "notes"],
            toolIds: ["read_notes"]
          })
        ),
        expandedReader,
        identity()
      )
    ).toThrow("has no effective tool");
  });

  it("accepts a harmless full-catalog difference but rejects every execution identity mismatch", () => {
    const policy = withDigest(policyWithoutDigest());
    const catalogOnlyChanged: ReviewedPlatformCatalogReader = {
      ...reader(),
      catalog: {
        digest: `sha256:${"e".repeat(64)}`,
        policyDigest: platformPolicyDigest,
        resourceDigest
      }
    };
    expect(validatePiEffectiveRunPolicy(request(policy), catalogOnlyChanged, identity())).toEqual(
      policy
    );
    expect(() =>
      validatePiEffectiveRunPolicy(request(policy), reader(), {
        ...identity(),
        platformPolicyDigest: `sha256:${"f".repeat(64)}`
      })
    ).toThrow("does not match the runtime");
    expect(() =>
      validatePiEffectiveRunPolicy(request(policy), reader(), {
        ...identity(),
        resourceDigest: `sha256:${"f".repeat(64)}`
      })
    ).toThrow("does not match the runtime");
    expect(() =>
      validatePiEffectiveRunPolicy(request(policy), reader(), {
        ...identity(),
        runtimeImageId: `sha256:${"f".repeat(64)}`
      })
    ).toThrow("does not match the runtime");
  });

  it("fails closed when the executing runtime has no identity", () => {
    expect(() =>
      validatePiEffectiveRunPolicy(request(withDigest(policyWithoutDigest())), reader())
    ).toThrow("missing an execution identity");
  });
});
