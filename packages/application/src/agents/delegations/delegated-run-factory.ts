import type {
  AgentRunV1,
  DelegationGrantV1,
  EffectiveRunPolicyV2,
  InternalJobV1
} from "@second-brain/contracts";
import {
  effectiveDelegatedTools,
  type AgentCatalog,
  type IdGeneratorPort
} from "@second-brain/domain";

export interface DelegatedRunWork {
  run: AgentRunV1;
  job: InternalJobV1;
}

export interface DelegatedRunInput {
  parent: AgentRunV1;
  grant: DelegationGrantV1;
  task: string;
  now: Date;
  effectiveRunPolicy?: EffectiveRunPolicyV2;
}

/** Builds a reviewed child run and its idempotent queue work as one unit. */
export class DelegatedRunFactory {
  constructor(
    private readonly catalog: AgentCatalog,
    private readonly ids: IdGeneratorPort
  ) {}

  create(
    ...args:
      | [DelegatedRunInput]
      | [AgentRunV1, DelegationGrantV1, string, Date, EffectiveRunPolicyV2?]
  ): DelegatedRunWork {
    const { parent, grant, task, now, effectiveRunPolicy } = delegatedRunInput(args);
    const tools = effectiveDelegatedTools(this.catalog, parent.agentId, grant.childAgentId, grant);
    if (effectiveRunPolicy) {
      if (
        effectiveRunPolicy.workspaceId !== parent.workspaceId ||
        effectiveRunPolicy.agentId !== grant.childAgentId
      ) {
        throw new Error("Delegated effective policy identity does not match the child run.");
      }
      if (!sameValues(effectiveRunPolicy.toolIds, tools)) {
        throw new Error("Delegated effective policy tools do not match the delegation grant.");
      }
      if (
        parent.platformPolicyDigest !== undefined &&
        parent.platformPolicyDigest !== effectiveRunPolicy.platformPolicyDigest
      ) {
        throw new Error("Delegation parent platform policy does not match the child run.");
      }
      if (
        parent.resourceDigest !== undefined &&
        parent.resourceDigest !== effectiveRunPolicy.resourceDigest
      ) {
        throw new Error("Delegation parent resources do not match the child run.");
      }
    }
    const createdAt = now.toISOString();
    const run: AgentRunV1 = {
      schemaVersion: 1,
      id: this.ids.nextId("agent-run"),
      workspaceId: parent.workspaceId,
      agentId: grant.childAgentId,
      catalogVersion: parent.catalogVersion,
      catalogDigest: effectiveRunPolicy?.catalogDigest ?? parent.catalogDigest,
      ...(effectiveRunPolicy
        ? {
            effectivePolicyDigest: effectiveRunPolicy.policyDigest,
            platformPolicyDigest: effectiveRunPolicy.platformPolicyDigest,
            resourceDigest: effectiveRunPolicy.resourceDigest,
            runtimeImageId: effectiveRunPolicy.runtimeImageId
          }
        : {}),
      status: "queued",
      rootRunId: parent.rootRunId,
      parentRunId: parent.id,
      delegationGrantId: grant.id,
      deadlineAt: grant.expiresAt,
      timeoutSeconds: grant.timeoutSeconds,
      tokenBudget: grant.tokenBudget,
      createdAt,
      ...(parent.noticeOrigin ? { noticeOrigin: parent.noticeOrigin } : {})
    };
    return {
      run,
      job: {
        schemaVersion: 1,
        id: this.ids.nextId("job"),
        workspaceId: run.workspaceId,
        type: "run_agent",
        payload: {
          runId: run.id,
          rootRunId: run.rootRunId,
          parentRunId: parent.id,
          task,
          allowedTools: tools,
          readablePaths: grant.readablePaths,
          writablePaths: grant.writablePaths,
          ...(effectiveRunPolicy ? { effectivePolicyDigest: effectiveRunPolicy.policyDigest } : {})
        },
        priority: 50,
        status: "pending",
        attempts: 0,
        availableAt: createdAt,
        idempotencyKey: `agent-run:${run.workspaceId}:${grant.id}`
      }
    };
  }
}

function delegatedRunInput(
  args: [DelegatedRunInput] | [AgentRunV1, DelegationGrantV1, string, Date, EffectiveRunPolicyV2?]
): DelegatedRunInput {
  if (args.length === 1) return args[0];
  const [parent, grant, task, now, effectiveRunPolicy] = args;
  return {
    parent,
    grant,
    task,
    now,
    ...(effectiveRunPolicy ? { effectiveRunPolicy } : {})
  };
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  const sortedRight = [...right].sort();
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === sortedRight[index])
  );
}
