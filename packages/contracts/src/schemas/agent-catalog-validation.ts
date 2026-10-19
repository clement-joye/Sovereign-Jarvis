import { z } from "zod";

interface AgentCatalogValidationInput {
  runtimeClasses: readonly { id: string }[];
  agents: readonly AgentValidationInput[];
}

interface AgentValidationInput {
  id: string;
  runtimeClass: string;
  promptPath: string;
  defaultForWorkspace?: boolean | undefined;
  routesInbound?: boolean | undefined;
  delegation?:
    | {
        mayDelegateTo: readonly string[];
        toolPolicyByAgent: Readonly<Record<string, readonly string[]>>;
      }
    | undefined;
}

export function validateAgentCatalog(
  value: AgentCatalogValidationInput,
  ctx: z.RefinementCtx
): void {
  const runtimeIds = validateUniqueRuntimeClasses(value.runtimeClasses, ctx);
  const agentIds = validateUniqueAgents(value.agents, ctx);
  validateDefaultAgent(value.agents, ctx);
  validateInboundRouter(value.agents, ctx);
  for (const agent of value.agents) validateAgentReferences(agent, runtimeIds, agentIds, ctx);
}

function validateUniqueRuntimeClasses(
  runtimeClasses: readonly { id: string }[],
  ctx: z.RefinementCtx
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const runtimeClass of runtimeClasses) {
    if (ids.has(runtimeClass.id)) addIssue(ctx, `Duplicate runtime class id: ${runtimeClass.id}.`);
    ids.add(runtimeClass.id);
  }
  return ids;
}

function validateUniqueAgents(
  agents: readonly AgentValidationInput[],
  ctx: z.RefinementCtx
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const agent of agents) {
    if (ids.has(agent.id)) addIssue(ctx, `Duplicate agent id: ${agent.id}.`);
    ids.add(agent.id);
  }
  return ids;
}

function validateDefaultAgent(agents: readonly AgentValidationInput[], ctx: z.RefinementCtx): void {
  const defaults = agents.filter((agent) => agent.defaultForWorkspace);
  if (defaults.length !== 1) {
    addIssue(
      ctx,
      `An agent catalog requires exactly one default workspace agent; received ${defaults.length}.`
    );
  }
}

function validateInboundRouter(
  agents: readonly AgentValidationInput[],
  ctx: z.RefinementCtx
): void {
  const routers = agents.filter((agent) => agent.routesInbound);
  if (routers.length > 1) {
    addIssue(
      ctx,
      `An agent catalog allows at most one inbound router; received ${routers.length}.`
    );
  }
}

function validateAgentReferences(
  agent: AgentValidationInput,
  runtimeIds: ReadonlySet<string>,
  agentIds: ReadonlySet<string>,
  ctx: z.RefinementCtx
): void {
  if (!runtimeIds.has(agent.runtimeClass)) {
    addIssue(ctx, `Unknown runtime class for agent ${agent.id}.`);
  }
  if (!agent.promptPath.startsWith(`${agent.id}/`)) {
    addIssue(ctx, `Prompt path must be scoped to agent ${agent.id}.`);
  }
  validateDelegationReferences(agent, agentIds, ctx);
}

function validateDelegationReferences(
  agent: AgentValidationInput,
  agentIds: ReadonlySet<string>,
  ctx: z.RefinementCtx
): void {
  const delegation = agent.delegation;
  if (!delegation) return;
  for (const child of delegation.mayDelegateTo) {
    if (!agentIds.has(child)) addIssue(ctx, `Unknown delegated agent: ${child}.`);
    if (!(child in delegation.toolPolicyByAgent)) {
      addIssue(ctx, `Missing delegated tool policy for agent ${child}.`);
    }
  }
  for (const child of Object.keys(delegation.toolPolicyByAgent)) {
    if (!delegation.mayDelegateTo.includes(child)) {
      addIssue(ctx, `Delegated tool policy references a disallowed agent: ${child}.`);
    }
  }
}

function addIssue(ctx: z.RefinementCtx, message: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, message });
}
