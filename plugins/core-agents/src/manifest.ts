import type { PluginManifestV2, ReviewedModelV2, RuntimeClassPinV2 } from "@second-brain/contracts";

/** Reviewed model identities currently used by the core agents. */
export const CORE_REVIEWED_MODELS_V2: readonly ReviewedModelV2[] = Object.freeze([
  { providerId: "omlx", modelId: "Qwen3.6-35B-A3B-OptiQ-4bit:profile-qwen-general" }
]);

/** Implementation IDs that must be registered before this target manifest can load. */
export const CORE_LOCAL_TOOL_FACTORY_IDS_V2 = Object.freeze([
  "pi-builtins",
  "workspace-tools",
  "attachment-tools",
  "extra-tools",
  "time-tools"
]);
export const CORE_BROKER_PROVIDER_IDS_V2 = Object.freeze([
  "planner-delegation-control",
  "schedule-control"
]);

const general = CORE_REVIEWED_MODELS_V2[0]!;
const local = (
  id: string,
  capabilityId: string,
  factoryId: string,
  toolNames: string[],
  requirements: Partial<{
    filesystem: "none" | "read-only" | "workspace-scoped-write";
    process: "none" | "sandboxed" | "arbitrary";
    network: "none" | "restricted";
    sideEffect: "none" | "workspace";
  }> = {}
) => ({
  id,
  capabilityId,
  factoryId,
  toolNames,
  filesystem: requirements.filesystem ?? ("workspace-scoped-write" as const),
  process: requirements.process ?? ("sandboxed" as const),
  network: requirements.network ?? ("none" as const),
  sideEffect: requirements.sideEffect ?? ("workspace" as const)
});
const broker = (
  id: string,
  capabilityId: string,
  providerId: string,
  operations: Array<{
    id: string;
    toolName: string;
    sideEffect: "none" | "workspace" | "external" | "destructive";
    approvalPolicy: "none" | "owner";
    idempotencyPolicy: "not-applicable" | "optional" | "required";
  }>,
  options: {
    credentialKind?: string;
    configurationSchema?: Record<string, "string" | "boolean" | "integer">;
  } = {}
) => ({
  id,
  capabilityId,
  providerId,
  ...(options.credentialKind ? { credentialKind: options.credentialKind } : {}),
  configurationSchema: options.configurationSchema ?? {},
  operations
});

const observation = (toolName: string) => ({
  id: toolName.replaceAll("_", "-"),
  toolName,
  sideEffect: "none" as const,
  approvalPolicy: "none" as const,
  idempotencyPolicy: "not-applicable" as const
});

const workspaceMutation = (toolName: string, approvalPolicy: "none" | "owner") => ({
  id: toolName.replaceAll("_", "-"),
  toolName,
  sideEffect: "workspace" as const,
  approvalPolicy,
  idempotencyPolicy: "required" as const
});

const externalMutation = (toolName: string, destructive = false) => ({
  id: toolName.replaceAll("_", "-"),
  toolName,
  sideEffect: destructive ? ("destructive" as const) : ("external" as const),
  approvalPolicy: "owner" as const,
  idempotencyPolicy: "required" as const
});

const browserTools = [
  "websearch",
  "web_fetch",
  "browser_navigate",
  "browser_scroll",
  "browser_extract",
  "browser_back",
  "browser_history",
  "browser_click",
  "browser_type"
];

/**
 * Core plugin representation of the legacy reviewed catalog. These are target
 * reviewed policies for the V2 compiler; runtime services still enforce V1.
 */
export const CORE_PLUGIN_MANIFEST_V2: PluginManifestV2 = {
  schemaVersion: 2,
  id: "core-agents",
  displayName: "Jarvis core agents and tools",
  activation: "built-in",
  agents: [
    {
      id: "brain",
      runtimeClass: "base",
      promptPath: "brain/AGENTS.md",
      skillPaths: ["brain/skills"],
      extensionPaths: ["extensions/extra-tools/index.ts"],
      capabilityIds: [
        "pi-read",
        "pi-bash",
        "workspace-list",
        "workspace-read",
        "workspace-write",
        "workspace-edit",
        "workspace-grep",
        "attachments",
        "planner-delegation"
      ],
      runtimeFeatureIds: [],
      workspaceAccess: "write",
      threadContextPolicy: "fresh_session_with_thread_history",
      defaultForWorkspace: true,
      model: general,
      timeoutSeconds: 2400,
      tokenBudget: 800000,
      maxConcurrentRunsPerWorkspace: 1,
      delegation: {
        mayDelegateTo: ["browser", "document-analyzer", "scheduler"],
        toolPolicyByAgent: {
          browser: browserTools,
          "document-analyzer": ["workspace_write", "attachment_save"],
          scheduler: [
            "schedule_list",
            "schedule_create",
            "schedule_update",
            "schedule_delete",
            "schedule_run_now",
            "time_now"
          ]
        },
        maxChildren: 1
      }
    },
    {
      id: "orchestrator",
      runtimeClass: "isolated",
      promptPath: "orchestrator/AGENTS.md",
      skillPaths: ["orchestrator/skills"],
      extensionPaths: [],
      capabilityIds: [
        "workspace-list",
        "workspace-read",
        "workspace-write",
        "workspace-edit",
        "workspace-grep",
        "planner-delegation"
      ],
      runtimeFeatureIds: [],
      workspaceAccess: "scoped-write",
      threadContextPolicy: "fresh_session_with_thread_history",
      routing: {
        keywords: ["orchestrate", "coordinate", "multi-step", "plan", "decompose", "break down"],
        confidence: 0.9,
        reason: "Multi-step work requiring durable coordination",
        confirmationRequirements: []
      },
      model: general,
      timeoutSeconds: 3200,
      tokenBudget: 800000,
      maxConcurrentRunsPerWorkspace: 1,
      delegation: {
        mayDelegateTo: ["brain", "browser", "document-analyzer", "scheduler"],
        toolPolicyByAgent: {
          brain: [
            "read",
            "bash",
            "workspace_list",
            "workspace_read",
            "workspace_write",
            "workspace_edit",
            "workspace_grep",
            "attachment_save"
          ],
          browser: browserTools,
          "document-analyzer": ["workspace_write", "attachment_save"],
          scheduler: [
            "schedule_list",
            "schedule_create",
            "schedule_update",
            "schedule_delete",
            "schedule_run_now",
            "time_now"
          ]
        },
        maxChildren: 1
      }
    },
    {
      id: "router",
      runtimeClass: "isolated",
      promptPath: "router/AGENTS.md",
      skillPaths: ["router/skills"],
      extensionPaths: [],
      capabilityIds: [],
      runtimeFeatureIds: [],
      workspaceAccess: "none",
      threadContextPolicy: "fresh_session_with_thread_history",
      routesInbound: true,
      model: general,
      timeoutSeconds: 120,
      tokenBudget: 800000,
      maxConcurrentRunsPerWorkspace: 1
    },
    {
      id: "document-analyzer",
      runtimeClass: "isolated",
      promptPath: "document-analyzer/AGENTS.md",
      skillPaths: ["document-analyzer/skills"],
      extensionPaths: [],
      capabilityIds: ["workspace-write", "attachments"],
      runtimeFeatureIds: [],
      workspaceAccess: "scoped-write",
      threadContextPolicy: "fresh_session_with_thread_history",
      routing: {
        keywords: ["attachment", "pdf", "document", "extract", "summarise", "summarize"],
        confidence: 0.9,
        reason: "Attachment or document analysis intent",
        confirmationRequirements: []
      },
      model: general,
      timeoutSeconds: 600,
      tokenBudget: 800000,
      maxConcurrentRunsPerWorkspace: 1
    },
    {
      id: "scheduler",
      runtimeClass: "isolated",
      promptPath: "scheduler/AGENTS.md",
      skillPaths: ["scheduler/skills"],
      extensionPaths: [],
      capabilityIds: ["schedule-observation", "schedule-mutation", "time"],
      runtimeFeatureIds: [],
      workspaceAccess: "none",
      threadContextPolicy: "fresh_session_with_thread_history",
      routing: {
        keywords: ["schedule", "remind", "reminder", "calendar"],
        confidence: 0.95,
        reason: "Schedule intent",
        confirmationRequirements: ["Confirm schedule details before mutation."]
      },
      model: general,
      timeoutSeconds: 600,
      tokenBudget: 800000,
      maxConcurrentRunsPerWorkspace: 1
    }
  ],
  localToolProviders: [
    local("read-provider", "pi-read", "pi-builtins", ["read"], {
      filesystem: "read-only",
      process: "none",
      sideEffect: "none"
    }),
    local("bash-provider", "pi-bash", "pi-builtins", ["bash"], {
      filesystem: "none",
      process: "arbitrary",
      network: "none",
      sideEffect: "workspace"
    }),
    local("workspace-list-provider", "workspace-list", "workspace-tools", ["workspace_list"], {
      filesystem: "read-only",
      process: "none",
      sideEffect: "none"
    }),
    local("workspace-read-provider", "workspace-read", "workspace-tools", ["workspace_read"], {
      filesystem: "read-only",
      process: "none",
      sideEffect: "none"
    }),
    local("workspace-write-provider", "workspace-write", "workspace-tools", ["workspace_write"]),
    local("workspace-edit-provider", "workspace-edit", "workspace-tools", ["workspace_edit"]),
    local("workspace-grep-provider", "workspace-grep", "workspace-tools", ["workspace_grep"], {
      filesystem: "read-only",
      process: "none",
      sideEffect: "none"
    }),
    local("attachment-provider", "attachments", "attachment-tools", ["attachment_save"]),
    local("webfetch-provider", "webfetch", "extra-tools", ["webfetch"], {
      filesystem: "none",
      process: "none",
      network: "restricted",
      sideEffect: "none"
    }),
    local("time-provider", "time", "time-tools", ["time_now"], {
      filesystem: "none",
      process: "none",
      sideEffect: "none"
    })
  ],
  brokerProviders: [
    broker("planner-delegation-provider", "planner-delegation", "planner-delegation-control", [
      workspaceMutation("delegate", "none"),
      observation("delegate_status")
    ]),
    broker("schedule-observation-provider", "schedule-observation", "schedule-control", [
      observation("schedule_list")
    ]),
    broker("schedule-mutation-provider", "schedule-mutation", "schedule-control", [
      externalMutation("schedule_create"),
      externalMutation("schedule_update"),
      externalMutation("schedule_delete", true),
      externalMutation("schedule_run_now")
    ])
  ],
  runtimeFeatures: []
};

export interface CoreRuntimeImagePinsV2 {
  base: string;
  isolated: string;
}

/** Returns target V2 runtime policies using deployment-supplied immutable image pins. */
export function coreRuntimeClassesV2(images: CoreRuntimeImagePinsV2): RuntimeClassPinV2[] {
  return [
    {
      id: "base",
      image: images.base,
      mountPolicy: "read-write",
      networkPolicy: "restricted",
      featureIds: [],
      resourceCeiling: {
        timeoutSeconds: 3600,
        tokenBudget: 1000000,
        maxConcurrentRuns: 1,
        memoryMiB: 4096,
        cpuMillicores: 4000,
        pids: 512,
        maxOutputBytes: 1000000
      }
    },
    {
      id: "isolated",
      image: images.isolated,
      mountPolicy: "scoped-write",
      networkPolicy: "none",
      featureIds: [],
      resourceCeiling: {
        timeoutSeconds: 3600,
        tokenBudget: 1000000,
        maxConcurrentRuns: 2,
        memoryMiB: 2048,
        cpuMillicores: 2000,
        pids: 256,
        maxOutputBytes: 1000000
      }
    }
  ];
}
