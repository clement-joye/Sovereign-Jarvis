import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentDefinitionV1, AgentRunV1 } from "@second-brain/contracts";

type DelegationPolicy = NonNullable<AgentDefinitionV1["delegation"]>;

export function createPlannerDelegationTool(input: {
  baseUrl: string;
  token: string;
  parent: AgentRunV1;
  delegationPolicy: DelegationPolicy;
}): ToolDefinition {
  const targetAgentIds = [...input.delegationPolicy.mayDelegateTo].sort();
  const delegatedToolIds = [
    ...new Set(
      targetAgentIds.flatMap((agentId) => input.delegationPolicy.toolPolicyByAgent[agentId] ?? [])
    )
  ].sort();
  const reviewedGrantSummary = targetAgentIds
    .map((agentId) => {
      const toolIds = input.delegationPolicy.toolPolicyByAgent[agentId] ?? [];
      return `${agentId}=[${toolIds.join(", ")}]`;
    })
    .join("; ");

  return defineTool({
    name: "delegate",
    label: "delegate",
    description: [
      "Create one durable, bounded child task.",
      "targetAgentId is an agent role; allowedTools contains tool IDs, never agent role IDs.",
      "Choose allowedTools only from the selected target's reviewed list below.",
      "Omit allowedTools when the child needs no tools; execution limits come from platform policy.",
      `Reviewed target/tool grants: ${reviewedGrantSummary}.`
    ].join(" "),
    promptSnippet: "Delegate one bounded child task",
    parameters: Type.Object({
      targetAgentId: Type.String({
        minLength: 1,
        enum: targetAgentIds,
        description: `Reviewed child agent role. Choose one of: ${targetAgentIds.join(", ")}.`
      }),
      task: Type.String({ minLength: 1, maxLength: 20_000 }),
      allowedTools: Type.Optional(
        Type.Array(
          Type.String({
            enum: delegatedToolIds,
            description: "A reviewed tool ID, not an agent role ID."
          }),
          {
            uniqueItems: true,
            description:
              "Per-task least-privilege grant. Every tool must belong to the selected target's reviewed list. Omit when no tools are needed."
          }
        )
      ),
      readablePaths: Type.Optional(
        Type.Array(Type.String(), {
          description: "Relative workspace roots the child must read. Omit when none are needed."
        })
      ),
      writablePaths: Type.Optional(
        Type.Array(Type.String(), {
          description: "Relative workspace roots the child must modify. Omit when none are needed."
        })
      )
    }),
    async execute(_id, params, signal) {
      const spec = {
        targetAgentId: params.targetAgentId,
        task: params.task,
        allowedTools: params.allowedTools ?? [],
        readablePaths: params.readablePaths ?? [],
        writablePaths: params.writablePaths ?? []
      };
      assertReviewedDelegationGrant(input.delegationPolicy, spec.targetAgentId, spec.allowedTools);
      const response = await fetch(new URL("/v1/planner-delegations", input.baseUrl), {
        method: "POST",
        headers: { authorization: `Bearer ${input.token}`, "content-type": "application/json" },
        body: JSON.stringify({ parent: input.parent, spec }),
        ...(signal ? { signal } : {})
      });
      if (!response.ok) throw new Error(`Planner delegation failed: ${await response.text()}`);
      const child = await response.json();
      return {
        content: [{ type: "text", text: JSON.stringify(child) }],
        details: child as AgentRunV1
      };
    }
  });
}

function assertReviewedDelegationGrant(
  policy: DelegationPolicy,
  targetAgentId: string,
  allowedTools: readonly string[]
): void {
  if (!policy.mayDelegateTo.includes(targetAgentId)) {
    throw new Error(
      `This agent cannot delegate to ${JSON.stringify(targetAgentId)}. ` +
        `Choose one of: ${policy.mayDelegateTo.join(", ")}.`
    );
  }

  const reviewedTools = policy.toolPolicyByAgent[targetAgentId] ?? [];
  const reviewed = new Set(reviewedTools);
  const invalidTools = [...new Set(allowedTools.filter((toolId) => !reviewed.has(toolId)))];
  if (invalidTools.length > 0) {
    const validTools = reviewedTools.length > 0 ? reviewedTools.join(", ") : "none";
    throw new Error(
      `Invalid allowedTools for agent ${JSON.stringify(targetAgentId)}: ${invalidTools.join(", ")}. ` +
        `Valid reviewed tool IDs: ${validTools}. ` +
        "Agent role IDs are not tool IDs; use [] only when the child needs no tools."
    );
  }

  if (new Set(allowedTools).size !== allowedTools.length) {
    throw new Error("allowedTools must not contain duplicate tool IDs.");
  }
}

/** Reads durable child state and artifacts without granting further authority. */
export function createPlannerDelegationStatusTool(input: {
  baseUrl: string;
  token: string;
  parentRunId: string;
}): ToolDefinition {
  return defineTool({
    name: "delegate_status",
    label: "delegate_status",
    description:
      "Read current child-run status and artifacts. Use it before reporting delegated work as complete.",
    promptSnippet: "Check delegated child status and artifacts",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      const response = await fetch(
        new URL(`/v1/agent-runs/${encodeURIComponent(input.parentRunId)}/children`, input.baseUrl),
        { headers: { authorization: `Bearer ${input.token}` }, ...(signal ? { signal } : {}) }
      );
      if (!response.ok) throw new Error(`Planner child status failed: ${await response.text()}`);
      const children = await response.json();
      return {
        content: [{ type: "text", text: JSON.stringify(children) }],
        details: children
      };
    }
  });
}
