import { createHash } from "node:crypto";

import {
  AgentCatalogV1Schema,
  type AgentCatalogV1,
  type AgentDefinitionV1,
  type RuntimeClassDefinitionV1
} from "@second-brain/contracts";

export type AgentId = AgentDefinitionV1["id"];

export interface AgentCatalog {
  readonly version: string;
  readonly digest: string;
  get(agentId: string): AgentDefinitionV1 | undefined;
  require(agentId: string): AgentDefinitionV1;
  runtimeClass(agentId: string): RuntimeClassDefinitionV1;
  ids(): readonly AgentId[];
  defaultAgentId(): AgentId;
  inboundRouterId(): AgentId | undefined;
}

/** Creates an immutable reviewed catalog and verifies its stable content digest. */
export function createAgentCatalog(catalog: AgentCatalogV1): AgentCatalog {
  const parsed = AgentCatalogV1Schema.parse(catalog);
  const { digest: _digest, ...content } = parsed;
  const expectedDigest = agentCatalogDigest(content);
  if (parsed.digest !== expectedDigest) {
    throw new Error(
      `Agent catalog digest does not match reviewed content: expected ${expectedDigest}.`
    );
  }
  const agents = new Map(parsed.agents.map((agent) => [agent.id, Object.freeze(agent)]));
  const runtimeClasses = new Map(
    parsed.runtimeClasses.map((runtimeClass) => [runtimeClass.id, Object.freeze(runtimeClass)])
  );
  const defaultAgent = parsed.agents.find((agent) => agent.defaultForWorkspace)!;
  const inboundRouter = parsed.agents.find((agent) => agent.routesInbound);
  return Object.freeze({
    version: parsed.version,
    digest: parsed.digest,
    get: (agentId: string) => agents.get(agentId),
    require: (agentId: string) => {
      const agent = agents.get(agentId);
      if (!agent) throw new Error(`Unknown agent id in reviewed catalog: ${agentId}.`);
      return agent;
    },
    runtimeClass: (agentId: string) => {
      const agent = agents.get(agentId);
      if (!agent) throw new Error(`Unknown agent id in reviewed catalog: ${agentId}.`);
      const runtimeClass = runtimeClasses.get(agent.runtimeClass);
      if (!runtimeClass)
        throw new Error(`Missing runtime class for agent ${agentId}: ${agent.runtimeClass}.`);
      return runtimeClass;
    },
    ids: () => [...agents.keys()],
    defaultAgentId: () => defaultAgent.id,
    inboundRouterId: () => inboundRouter?.id
  });
}

/** Produces the digest over catalog content, excluding the digest field itself. */
export function agentCatalogDigest(catalog: Omit<AgentCatalogV1, "digest">): string {
  return `sha256:${createHash("sha256").update(stableJson(catalog)).digest("hex")}`;
}

import { initialCatalogContent } from "./initial-agent-catalog-content.js";

/**
 * Legacy V1 fixture for compatibility and isolated tests. Production services
 * must adapt the immutable V2 platform catalog instead of using this value.
 */
export const INITIAL_AGENT_CATALOG = createAgentCatalog({
  ...initialCatalogContent,
  digest: agentCatalogDigest(initialCatalogContent)
});

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
