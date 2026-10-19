import type { CompiledCapabilityProviderV2, PiRunRequestV1 } from "@second-brain/contracts";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PiToolProvider, PiToolProviderContext } from "@second-brain/plugin-sdk";
import type { SecurityEventEmitter } from "@second-brain/observability";

import { createAttachmentTools } from "../tools/attachment-tools.js";
import {
  createPlannerDelegationStatusTool,
  createPlannerDelegationTool
} from "../tools/planner-delegation-tool.js";
import { createScheduleTools, HttpScheduleControlClient } from "../scheduling/schedule-tools.js";
import { createCurrentTimeTool } from "../tools/time-tools.js";
import { createWorkspaceTools } from "../tools/workspace-tools.js";

export type { PiToolProvider, PiToolProviderContext } from "@second-brain/plugin-sdk";

export interface PiToolSelection {
  tools: ToolDefinition[];
  implementationIds: string[];
}

/**
 * Materializes tools by reviewed implementation ID. Agent/plugin selection is
 * already represented by the effective capability snapshot passed to select().
 */
export class ToolProviderRegistry {
  private readonly providers: ReadonlyMap<string, PiToolProvider>;

  constructor(providers: readonly PiToolProvider[]) {
    const entries = providers.map((provider) => [provider.implementationId, provider] as const);
    if (new Set(entries.map(([id]) => id)).size !== entries.length) {
      throw new Error("Duplicate Pi tool provider implementation ID.");
    }
    this.providers = new Map(entries);
  }

  select(
    context: PiToolProviderContext,
    capabilities: readonly CompiledCapabilityProviderV2[],
    allowedToolIds: readonly string[]
  ): PiToolSelection {
    const allowed = new Set(allowedToolIds);
    const implementationIds = [
      ...new Set(
        capabilities
          .filter((capability) => capability.toolIds.some((toolId) => allowed.has(toolId)))
          .map((capability) => capability.implementationId)
      )
    ].sort();
    const materialized: ToolDefinition[] = [];
    for (const implementationId of implementationIds) {
      const provider = this.providers.get(implementationId);
      if (!provider) {
        throw new Error(`No Pi tool provider is registered for ${implementationId}.`);
      }
      materialized.push(...provider.create(context));
    }

    const selected = materialized.filter((tool) => allowed.has(tool.name));
    const names = selected.map((tool) => tool.name);
    if (new Set(names).size !== names.length) {
      throw new Error("Multiple Pi tool providers registered the same effective tool name.");
    }
    return { tools: selected, implementationIds };
  }
}

/** Built-in implementations. Plugins select these; they do not mutate this registry at runtime. */
export function createDefaultToolProviderRegistry(
  pluginProviders: readonly PiToolProvider[] = [],
  options: { securityEvents?: SecurityEventEmitter } = {}
): ToolProviderRegistry {
  return new ToolProviderRegistry([
    passiveProvider("pi-builtins"),
    passiveProvider("extra-tools"),
    {
      implementationId: "workspace-tools",
      create: ({ request, workspaceRoot }) =>
        createWorkspaceTools(
          workspaceRoot,
          {
            readablePaths: request.readablePaths,
            writablePaths: request.writablePaths
          },
          {
            ...(options.securityEvents ? { securityEvents: options.securityEvents } : {}),
            ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
            runId: request.id,
            ...(request.agentId ? { agentId: request.agentId } : {})
          }
        )
    },
    {
      implementationId: "attachment-tools",
      create: ({ request, workspaceRoot, attachmentRoot }) => {
        if (!attachmentRoot) throw unavailable("attachment-tools", "attachment exchange root");
        return createAttachmentTools({
          workspaceRoot,
          attachmentRoot,
          attachments: request.attachments ?? []
        });
      }
    },
    {
      implementationId: "schedule-control",
      create: ({ request, brainControlUrl, scheduleToolEvents }) => {
        const authorization = requireBrokerContext("schedule-control", request);
        const destinationConversationId =
          request.noticeOrigin?.conversationId ?? request.sourceReferences[0]?.conversationId;
        return createScheduleTools(
          new HttpScheduleControlClient(
            brainControlUrl,
            authorization.token,
            authorization.workspaceId
          ),
          (event) => scheduleToolEvents.push(`${event.operation}:${event.status}`),
          {
            defaultTimezone: request.userTimezone,
            workspaceId: authorization.workspaceId,
            ...(destinationConversationId ? { destinationConversationId } : {}),
            ...(request.noticeOrigin?.threadRootExternalEventId
              ? {
                  destinationThreadRootExternalEventId:
                    request.noticeOrigin.threadRootExternalEventId
                }
              : {})
          }
        );
      }
    },
    {
      implementationId: "planner-delegation-control",
      create: ({ request, brainControlUrl, agentCatalog }) => {
        const authorization = requireBrokerContext("planner-delegation-control", request);
        const agentId = requireAgentId("planner-delegation-control", request);
        const parentAgent = agentCatalog.require(agentId);
        if (!parentAgent.delegation) {
          throw unavailable("planner-delegation-control", `delegation policy for ${agentId}`);
        }
        const now = new Date().toISOString();
        return [
          createPlannerDelegationTool({
            baseUrl: brainControlUrl,
            token: authorization.token,
            delegationPolicy: parentAgent.delegation,
            parent: {
              schemaVersion: 1,
              id: request.id,
              workspaceId: authorization.workspaceId,
              agentId,
              catalogVersion: agentCatalog.version,
              catalogDigest: agentCatalog.digest,
              status: "running",
              rootRunId: request.id,
              deadlineAt: new Date(Date.now() + request.timeoutSeconds * 1_000).toISOString(),
              timeoutSeconds: request.timeoutSeconds,
              tokenBudget: parentAgent.tokenBudget,
              createdAt: now,
              startedAt: now
            }
          }),
          createPlannerDelegationStatusTool({
            baseUrl: brainControlUrl,
            token: authorization.token,
            parentRunId: request.id
          })
        ];
      }
    },
    {
      implementationId: "time-tools",
      create: ({ request }) => [createCurrentTimeTool({ timezone: request.userTimezone })]
    },
    ...pluginProviders
  ]);
}

function passiveProvider(implementationId: string): PiToolProvider {
  return { implementationId, create: () => [] };
}

function requireBrokerContext(
  implementationId: string,
  request: PiRunRequestV1
): { workspaceId: string; token: string } {
  if (!request.workspaceId || !request.runAuthorization) {
    throw unavailable(implementationId, "workspace-scoped run authorization");
  }
  return { workspaceId: request.workspaceId, token: request.runAuthorization };
}

function requireAgentId(implementationId: string, request: PiRunRequestV1): string {
  if (!request.agentId) throw unavailable(implementationId, "effective agent identity");
  return request.agentId;
}

function unavailable(implementationId: string, requirement: string): Error {
  return new Error(`Pi tool provider ${implementationId} is unavailable: missing ${requirement}.`);
}
