import { INITIAL_ORCHESTRATOR_AGENT } from "./initial-orchestrator-agent.js";

export const initialCatalogContent = {
  schemaVersion: 1 as const,
  version: "1.0.0",
  runtimeClasses: [
    {
      id: "base",
      image: `sha256:${"0".repeat(64)}`,
      networkPolicy: "restricted" as const,
      maxConcurrentRuns: 1,
      timeoutSeconds: 3200,
      memoryMiB: 4096,
      cpuMillicores: 4000
    },
    {
      id: "browser",
      image: `sha256:${"1".repeat(64)}`,
      networkPolicy: "browser-restricted" as const,
      maxConcurrentRuns: 1,
      timeoutSeconds: 3200,
      memoryMiB: 4096,
      cpuMillicores: 2000
    },
    {
      id: "isolated",
      image: `sha256:${"2".repeat(64)}`,
      networkPolicy: "none" as const,
      maxConcurrentRuns: 2,
      timeoutSeconds: 3200,
      memoryMiB: 2048,
      cpuMillicores: 2000
    }
  ],
  agents: [
    {
      schemaVersion: 1 as const,
      id: "brain",
      version: "1.0.0",
      runtimeClass: "base",
      promptPath: "brain/AGENTS.md",
      skillPaths: ["brain/skills"],
      extensionPaths: ["extensions/extra-tools/index.ts"],
      toolPolicy: [
        "read",
        "bash",
        "workspace_list",
        "workspace_read",
        "workspace_write",
        "workspace_edit",
        "workspace_grep",
        "attachment_save",
        "delegate",
        "delegate_status"
      ],
      networkPolicy: "restricted" as const,
      workspaceAccess: "write" as const,
      threadContextPolicy: "fresh_session_with_thread_history" as const,
      defaultForWorkspace: true,
      model: { providerId: "omlx", modelId: "Qwen3.6-35B-A3B-OptiQ-4bit:profile-qwen-general" },
      timeoutSeconds: 1200,
      tokenBudget: 800_000,
      maxConcurrentRunsPerWorkspace: 1,
      delegation: {
        mayDelegateTo: ["browser", "document-analyzer", "scheduler"],
        toolPolicyByAgent: {
          browser: [
            "websearch",
            "web_fetch",
            "browser_navigate",
            "browser_scroll",
            "browser_extract",
            "browser_back",
            "browser_history",
            "browser_click",
            "browser_type"
          ],
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
    INITIAL_ORCHESTRATOR_AGENT,
    {
      schemaVersion: 1 as const,
      id: "router",
      version: "1.0.0",
      runtimeClass: "isolated",
      promptPath: "router/AGENTS.md",
      skillPaths: ["router/skills"],
      extensionPaths: [],
      toolPolicy: [],
      networkPolicy: "none" as const,
      workspaceAccess: "none" as const,
      threadContextPolicy: "fresh_session_with_thread_history" as const,
      routesInbound: true,
      model: { providerId: "omlx", modelId: "Qwen3.6-35B-A3B-OptiQ-4bit:profile-qwen-general" },
      timeoutSeconds: 120,
      tokenBudget: 800_000,
      maxConcurrentRunsPerWorkspace: 1
    },
    {
      schemaVersion: 1 as const,
      id: "browser",
      version: "1.2.0",
      runtimeClass: "browser",
      promptPath: "browser/AGENTS.md",
      skillPaths: ["browser/skills"],
      extensionPaths: ["extensions/browser/index.ts"],
      toolPolicy: [
        "websearch",
        "web_fetch",
        "browser_navigate",
        "browser_scroll",
        "browser_extract",
        "browser_back",
        "browser_history",
        "browser_click",
        "browser_type"
      ],
      networkPolicy: "browser-restricted" as const,
      workspaceAccess: "none" as const,
      threadContextPolicy: "fresh_session_with_thread_history" as const,
      routing: {
        keywords: ["browse", "browser", "website", "web page"],
        confidence: 0.85,
        reason: "Browser research intent",
        confirmationRequirements: []
      },
      model: {
        providerId: "omlx",
        modelId: "Qwen3.6-35B-A3B-OptiQ-4bit:profile-qwen-general"
      },
      timeoutSeconds: 2400,
      tokenBudget: 800_000,
      maxConcurrentRunsPerWorkspace: 1
    },
    {
      schemaVersion: 1 as const,
      id: "document-analyzer",
      version: "1.1.0",
      runtimeClass: "isolated",
      promptPath: "document-analyzer/AGENTS.md",
      skillPaths: ["document-analyzer/skills"],
      extensionPaths: [],
      toolPolicy: ["workspace_write", "attachment_save"],
      networkPolicy: "none" as const,
      workspaceAccess: "scoped-write" as const,
      threadContextPolicy: "fresh_session_with_thread_history" as const,
      routing: {
        keywords: ["attachment", "pdf", "document", "extract", "summarise", "summarize"],
        confidence: 0.9,
        reason: "Attachment or document analysis intent",
        confirmationRequirements: []
      },
      model: { providerId: "omlx", modelId: "Qwen3.6-35B-A3B-OptiQ-4bit:profile-qwen-general" },
      timeoutSeconds: 600,
      tokenBudget: 800_000,
      maxConcurrentRunsPerWorkspace: 1
    },
    {
      schemaVersion: 1 as const,
      id: "scheduler",
      version: "1.0.0",
      runtimeClass: "isolated",
      promptPath: "scheduler/AGENTS.md",
      skillPaths: ["scheduler/skills"],
      extensionPaths: [],
      toolPolicy: [
        "schedule_list",
        "schedule_create",
        "schedule_update",
        "schedule_delete",
        "schedule_run_now",
        "time_now"
      ],
      networkPolicy: "none" as const,
      workspaceAccess: "none" as const,
      threadContextPolicy: "fresh_session_with_thread_history" as const,
      routing: {
        keywords: ["schedule", "remind", "reminder", "calendar"],
        confidence: 0.95,
        reason: "Schedule intent",
        confirmationRequirements: ["Confirm schedule details before mutation."]
      },
      model: { providerId: "omlx", modelId: "Qwen3.6-35B-A3B-OptiQ-4bit:profile-qwen-general" },
      timeoutSeconds: 600,
      tokenBudget: 800_000,
      maxConcurrentRunsPerWorkspace: 1
    }
  ]
};
