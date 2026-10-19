import { join } from "node:path";

import type { AgentCatalog } from "@second-brain/domain";
import { minimumTokenBudget } from "@second-brain/contracts";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager
} from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";

import type { PiModelRunInput } from "../providers/model-provider.js";
import {
  validatePiEffectiveRunPolicy,
  type PiExecutionIdentity,
  type ReviewedPlatformCatalogReader
} from "../executions/pi-effective-run-policy.js";
import { RoleResourceResolver } from "../executions/pi-role-resources.js";
import {
  activePiToolNames,
  modelSelectionForAgent,
  piSessionDirectory
} from "../executions/pi-runtime-utils.js";
import { PiPromptAssembler } from "../executions/pi-prompt-assembler.js";
import {
  createDefaultToolProviderRegistry,
  type ToolProviderRegistry
} from "../providers/tool-provider-registry.js";

export interface PiSessionFactoryOptions {
  sessionRoot: string;
  workspaceRoot: string;
  modelsPath: string;
  providerId: string;
  modelId: string;
  brainControlUrl: string;
  allowedTools?: readonly string[] | undefined;
  agentCatalog: AgentCatalog;
  platformCatalog: ReviewedPlatformCatalogReader;
  /** Identity injected by the provisioner for the container actually executing this run. */
  executionIdentity?: PiExecutionIdentity;
  toolProviders?: ToolProviderRegistry | undefined;
  profileRoot?: string | undefined;
  resourceRoot?: string | undefined;
  attachmentRoot?: string | undefined;
}

export interface CreatedPiSession {
  session: Awaited<ReturnType<typeof createAgentSession>>["session"];
  sessionDirectory: string;
  model: Model<Api>;
}

/** Builds one Pi SDK session exclusively from reviewed run capabilities/resources. */
export class PiSessionFactory {
  private readonly prompts = new PiPromptAssembler();
  private readonly roleResources: RoleResourceResolver;
  private readonly toolProviders: ToolProviderRegistry;

  constructor(private readonly options: PiSessionFactoryOptions) {
    this.roleResources = new RoleResourceResolver(options);
    this.toolProviders = options.toolProviders ?? createDefaultToolProviderRegistry();
  }

  async create(input: PiModelRunInput, scheduleToolEvents: string[]): Promise<CreatedPiSession> {
    const catalog = this.options.agentCatalog;
    const agentId = input.request.agentId ?? catalog.defaultAgentId();
    const agent = catalog.require(agentId);
    const effectivePolicy = validatePiEffectiveRunPolicy(
      input.request,
      this.options.platformCatalog,
      this.options.executionIdentity
    );
    const sessionDirectory = piSessionDirectory(
      this.options.sessionRoot,
      input.session.sessionId,
      agentId,
      catalog.digest
    );
    const roleAgent = {
      ...agent,
      skillPaths: effectivePolicy.skillPaths,
      extensionPaths: effectivePolicy.extensionPaths
    };
    const { runtime, model, resourceLoader, skills, systemPrompt } = await this.loadResources(
      sessionDirectory,
      agentId,
      input.request.userTimezone,
      roleAgent
    );
    const tokenBudget = minimumTokenBudget(input.request.tokenBudget, agent.tokenBudget);
    const budgetedModel: Model<Api> = {
      ...model,
      maxTokens:
        tokenBudget === "unlimited" ? model.maxTokens : Math.min(model.maxTokens, tokenBudget)
    };
    const runtimeAllowedTools = this.options.allowedTools;
    const policyTools = effectivePolicy.toolIds;
    const roleTools = runtimeAllowedTools
      ? policyTools.filter((tool) => runtimeAllowedTools.includes(tool))
      : [...policyTools];
    const allowedTools = input.request.delegatedToolPolicy
      ? roleTools.filter((tool) => input.request.delegatedToolPolicy?.includes(tool))
      : roleTools;
    const capabilities = effectivePolicy.capabilityIds.map((capabilityId) => {
      const capability = this.options.platformCatalog.getCapability(capabilityId);
      if (!capability) throw new Error(`Effective Pi capability is unavailable: ${capabilityId}.`);
      return capability;
    });
    const selection = this.toolProviders.select(
      {
        request: input.request,
        workspaceRoot: this.options.workspaceRoot,
        brainControlUrl: this.options.brainControlUrl,
        ...(this.options.attachmentRoot ? { attachmentRoot: this.options.attachmentRoot } : {}),
        agentCatalog: catalog,
        scheduleToolEvents
      },
      capabilities,
      allowedTools
    );
    const plannerDelegation = {
      requested: selection.implementationIds.includes("planner-delegation-control"),
      workspaceScoped: input.request.workspaceId !== undefined,
      runAuthorized: input.request.runAuthorization !== undefined,
      registered: selection.tools.some((tool) => tool.name === "delegate")
    };
    console.info(
      JSON.stringify({
        service: "pi-runner",
        event: "pi-custom-tools-ready",
        agentId,
        catalogVersion: catalog.version,
        catalogDigest: catalog.digest,
        policyDigest: effectivePolicy.policyDigest,
        policyTools,
        runtimeAllowedTools: runtimeAllowedTools ?? null,
        delegatedToolPolicy: input.request.delegatedToolPolicy ?? null,
        effectiveTools: allowedTools,
        providerImplementations: selection.implementationIds,
        plannerDelegation,
        tools: selection.tools.map((tool) => tool.name)
      })
    );

    const { session } = await createAgentSession({
      cwd: this.options.workspaceRoot,
      agentDir: sessionDirectory,
      resourceLoader,
      modelRuntime: runtime,
      model: budgetedModel,
      thinkingLevel: "off",
      tools: activePiToolNames(allowedTools, selection.tools),
      customTools: selection.tools,
      sessionManager: SessionManager.continueRecent(this.options.workspaceRoot, sessionDirectory)
    });
    const availableTools = session.agent.state.tools.map((tool) => tool.name);
    const unavailableTools = allowedTools.filter((tool) => !availableTools.includes(tool));
    if (unavailableTools.length > 0) {
      session.dispose();
      throw new Error(
        `Effective Pi tools are unavailable from their reviewed providers: ${unavailableTools.join(
          ", "
        )}.`
      );
    }
    console.info(
      JSON.stringify({
        service: "pi-runner",
        event: "pi-system-prompt-ready",
        customSystemPromptInjected:
          systemPrompt !== undefined && session.systemPrompt.includes(systemPrompt),
        skillsPromptInjected:
          skills.length === 0 ||
          skills.every((skill) => session.systemPrompt.includes(`<name>${skill.name}</name>`)),
        systemPromptCharacters: session.systemPrompt.length,
        availableTools
      })
    );
    return { session, sessionDirectory, model: budgetedModel };
  }

  private async loadResources(
    sessionDirectory: string,
    agentId: string,
    userTimezone: string | undefined,
    agent: ReturnType<AgentCatalog["require"]>
  ) {
    const runtime = await ModelRuntime.create({
      authPath: join(sessionDirectory, "auth.json"),
      modelsPath: this.options.modelsPath,
      allowModelNetwork: false
    });
    const selection = modelSelectionForAgent(agent, this.options);
    const model = runtime.getModel(selection.providerId, selection.modelId);
    if (!model) {
      throw new Error(
        `Configured Pi model for @${agentId} was not found: ${selection.providerId}/${selection.modelId}`
      );
    }

    const catalog = this.options.agentCatalog;
    const resources = this.roleResources.resolve(sessionDirectory, agent);
    const extensionFactories = await this.roleResources.loadExtensions(agent.extensionPaths);
    const resourceLoader = new DefaultResourceLoader({
      cwd: resources.resourceRoot,
      agentDir: resources.agentDir,
      extensionFactories,
      systemPrompt: resources.systemPrompt,
      noContextFiles: true,
      additionalSkillPaths: resources.additionalSkillPaths,
      appendSystemPrompt: this.prompts.appendSystemPrompt(
        this.options.resourceRoot !== undefined || this.options.profileRoot !== undefined,
        new Date(),
        userTimezone
      )
    });
    await resourceLoader.reload();
    const { agentsFiles } = resourceLoader.getAgentsFiles();
    const { skills, diagnostics } = resourceLoader.getSkills();
    const extensions = resourceLoader.getExtensions();
    const systemPrompt = resourceLoader.getSystemPrompt();
    console.info(
      JSON.stringify({
        service: "pi-runner",
        event: "pi-resources-loaded",
        agentId,
        modelProviderId: selection.providerId,
        modelId: selection.modelId,
        catalogVersion: catalog.version,
        catalogDigest: catalog.digest,
        selectedSkillPaths: agent.skillPaths,
        selectedExtensionPaths: agent.extensionPaths,
        workspaceRoot: this.options.workspaceRoot,
        agentsFiles: agentsFiles.map((file) => file.path),
        systemPromptCharacters: systemPrompt?.length ?? 0,
        skills: skills.map((skill) => skill.name),
        diagnostics: diagnostics.map((diagnostic) => diagnostic.message),
        extensions: extensions.extensions.map((extension) => extension.path),
        extensionDiagnostics: extensions.errors.map((error) => error.error)
      })
    );
    return { runtime, model, resourceLoader, skills, systemPrompt };
  }
}
