import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  actionProposalOperationDigest,
  type ActionProposalService,
  type BrokerOperationHandler,
  type BrokerOperationRequest,
  type ReviewedActionOperationRegistry
} from "@second-brain/application";
import type {
  ActionProposalConsumedV1,
  ActionProposalPendingV1,
  ActionProposalV1
} from "@second-brain/contracts";
import { definePiToolProvider } from "@second-brain/plugin-sdk";

export type BrowserMutationOperation = "browser-click" | "browser-type";

export interface BrowserActionExecutorPort {
  execute(input: {
    workspaceId: string;
    operation: BrowserMutationOperation;
    parameters: Record<string, unknown>;
  }): Promise<unknown>;
}

/** Owner-approved browser mutations are executed in the existing Browser runtime. */
export class BrowserActionService {
  constructor(
    private readonly executor: BrowserActionExecutorPort,
    private readonly proposals: ActionProposalService,
    private readonly operations: Pick<ReviewedActionOperationRegistry, "require">
  ) {}

  async requestOperation(input: BrokerOperationRequest) {
    if (input.pluginId !== "browser" || !isBrowserMutation(input.operationId)) {
      throw new Error("Browser broker received an undeclared operation.");
    }
    if (input.agentId !== "browser") {
      throw new Error("Browser mutations are available only to the Browser agent.");
    }
    const parameters = validateParameters(input.operationId, input.parameters);
    const declaration = this.operations.require(input.operationId);
    const operationDigest = actionProposalOperationDigest({
      pluginId: declaration.pluginId,
      operation: declaration.operation,
      parameters
    });
    const proposal = await this.proposals.createProposal({
      schemaVersion: 1,
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      runId: input.runId,
      pluginId: declaration.pluginId,
      operation: declaration.operation,
      operationDigest,
      summary:
        input.operationId === "browser-click"
          ? `Click browser element ${parameters.selector}`
          : `Type into browser element ${parameters.selector}`,
      parameters,
      approvalMode: declaration.operation.approvalPolicy.minimumMode,
      idempotencyKey: input.idempotencyKey,
      expiresAt: input.expiresAt
    });
    if (proposal.status === "proposed") {
      return { schemaVersion: 1 as const, outcome: "pending" as const, proposal };
    }
    return this.proposals.consumeAndExecute(proposalBinding(proposal), (consumed) =>
      this.executeApproved(consumed)
    );
  }

  async executeApproved(proposal: ActionProposalV1): Promise<unknown> {
    if (
      proposal.status !== "consumed" ||
      proposal.pluginId !== "browser" ||
      proposal.agentId !== "browser" ||
      !isBrowserMutation(proposal.operationId)
    ) {
      throw new Error("Browser mutation requires a consumed Browser action proposal.");
    }
    return this.executor.execute({
      workspaceId: proposal.workspaceId,
      operation: proposal.operationId,
      parameters: validateParameters(proposal.operationId, proposal.parameters)
    });
  }
}

export function createBrowserBrokerHandler(service: BrowserActionService): BrokerOperationHandler {
  return {
    implementationId: "browser-control",
    requestOperation: (input) => service.requestOperation(input),
    executeApproved: (proposal) => service.executeApproved(proposal)
  };
}

export class HttpBrowserActionExecutor implements BrowserActionExecutorPort {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async execute(input: Parameters<BrowserActionExecutorPort["execute"]>[0]): Promise<unknown> {
    const response = await this.fetchFn(new URL("/v1/broker/execute", this.baseUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        implementationId: "browser-control",
        workspaceId: input.workspaceId,
        operationId: input.operation,
        parameters: input.parameters
      })
    });
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(`Browser action failed with ${response.status}.`);
    return body;
  }
}

class HttpBrowserControlClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly workspaceId: string,
    private readonly agentId: string
  ) {}

  async request(
    operationId: BrowserMutationOperation,
    parameters: Record<string, unknown>,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<ActionProposalPendingV1 | ActionProposalConsumedV1> {
    const response = await fetch(new URL("/v1/broker/execute", this.baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
        "x-jarvis-workspace-id": this.workspaceId
      },
      body: JSON.stringify({
        pluginId: "browser",
        operationId,
        agentId: this.agentId,
        idempotencyKey,
        parameters
      }),
      ...(signal ? { signal } : {})
    });
    const body = (await response.json()) as ActionProposalPendingV1 | ActionProposalConsumedV1;
    if (!response.ok && response.status !== 202) {
      throw new Error(`Browser approval request failed: ${response.status}.`);
    }
    return body;
  }
}

function createBrowserMutationTools(control: HttpBrowserControlClient): ToolDefinition[] {
  return [
    defineTool({
      name: "browser_click",
      label: "browser_click",
      description: "Request owner approval to click one visible browser element by CSS selector.",
      promptSnippet: "Click a browser element after owner approval",
      parameters: Type.Object({ selector: Type.String({ minLength: 1, maxLength: 500 }) }),
      async execute(id, parameters, signal) {
        return toolResult(await control.request("browser-click", parameters, id, signal));
      }
    }),
    defineTool({
      name: "browser_type",
      label: "browser_type",
      description:
        "Request owner approval to replace the text in one visible non-secret browser field.",
      promptSnippet: "Type into a browser field after owner approval",
      parameters: Type.Object({
        selector: Type.String({ minLength: 1, maxLength: 500 }),
        text: Type.String({ maxLength: 4000 })
      }),
      async execute(id, parameters, signal) {
        return toolResult(await control.request("browser-type", parameters, id, signal));
      }
    })
  ];
}

export const BROWSER_CONTROL_PI_TOOL_PROVIDER = definePiToolProvider({
  implementationId: "browser-control",
  create({ request, brainControlUrl }) {
    if (!request.workspaceId || !request.runAuthorization || request.agentId !== "browser") {
      throw new Error("browser-control requires an authorized Browser workspace run.");
    }
    return createBrowserMutationTools(
      new HttpBrowserControlClient(
        brainControlUrl,
        request.runAuthorization,
        request.workspaceId,
        request.agentId
      )
    );
  }
});

function validateParameters(
  operation: BrowserMutationOperation,
  input: Record<string, unknown>
): Record<string, string> {
  const selector = input.selector;
  if (typeof selector !== "string" || !selector.trim() || selector.length > 500) {
    throw new Error("Browser selector is invalid.");
  }
  if (operation === "browser-click") return { selector: selector.trim() };
  const text = input.text;
  if (typeof text !== "string" || text.length > 4000) {
    throw new Error("Browser input text is invalid.");
  }
  return { selector: selector.trim(), text };
}

function isBrowserMutation(value: string): value is BrowserMutationOperation {
  return value === "browser-click" || value === "browser-type";
}

function proposalBinding(proposal: ActionProposalV1) {
  return {
    proposalId: proposal.id,
    workspaceId: proposal.workspaceId,
    agentId: proposal.agentId,
    runId: proposal.runId,
    pluginId: proposal.pluginId,
    capabilityId: proposal.capabilityId,
    operationId: proposal.operationId,
    operationVersion: proposal.operationVersion,
    operationDigest: proposal.operationDigest,
    idempotencyKey: proposal.idempotencyKey
  };
}

function toolResult(value: ActionProposalPendingV1 | ActionProposalConsumedV1) {
  const text =
    value.outcome === "pending"
      ? `${JSON.stringify(value)}\nOwner approval is required. A dedicated approval request has been sent. Ask the owner to reply to that message with /yes or /no. Do not repeat the proposal ID or claim the browser action ran yet.`
      : JSON.stringify(value.result);
  return { content: [{ type: "text" as const, text }], details: {} };
}
