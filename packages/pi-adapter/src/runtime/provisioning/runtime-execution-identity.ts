import type { AgentCatalog } from "@second-brain/domain";
import type { PiRunRequestV1 } from "@second-brain/contracts";

import type { RuntimeExecutionIdentity } from "./runtime-provisioner-service.js";

export function assertRuntimeExecutionIdentity(input: {
  request: Omit<PiRunRequestV1, "workspaceId">;
  image: string;
  agentCatalog: AgentCatalog;
  executionIdentity: RuntimeExecutionIdentity | undefined;
}): void {
  const { request, image, agentCatalog, executionIdentity } = input;
  const policy = request.effectiveRunPolicy;
  // The positional constructor is retained for old in-process callers and
  // historical test fixtures. Deployed provisioners use the options object
  // with an identity and therefore never take this compatibility path.
  if (!executionIdentity) {
    if (request.catalogDigest !== agentCatalog.digest) {
      throw new Error(
        `Pi request catalog digest ${request.catalogDigest ?? "missing"} does not match provisioner catalog digest ${agentCatalog.digest}.`
      );
    }
    return;
  }
  if (!policy) throw new Error("Pi request is missing an execution identity.");
  if (policy.platformPolicyDigest !== executionIdentity.platformPolicyDigest) {
    throw new Error("Pi request platform policy digest does not match the provisioner policy.");
  }
  if (policy.resourceDigest !== executionIdentity.resourceDigest) {
    throw new Error("Pi request resource digest does not match the provisioner resources.");
  }
  if (policy.runtimeImageId !== image) {
    throw new Error("Pi request runtime image does not match the provisioned runtime.");
  }
}
