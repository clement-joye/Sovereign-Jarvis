import type { AgentDefinitionV1 } from "@second-brain/contracts";

export const INITIAL_ORCHESTRATOR_AGENT = {
  schemaVersion: 1 as const,
  id: "orchestrator",
  version: "1.0.0",
  runtimeClass: "isolated",
  promptPath: "orchestrator/AGENTS.md",
  skillPaths: ["orchestrator/skills"],
  extensionPaths: [],
  toolPolicy: [
    "workspace_list",
    "workspace_read",
    "workspace_write",
    "workspace_edit",
    "workspace_grep",
    "delegate",
    "delegate_status"
  ],
  networkPolicy: "none" as const,
  workspaceAccess: "scoped-write" as const,
  threadContextPolicy: "fresh_session_with_thread_history" as const,
  routing: {
    keywords: ["orchestrate", "coordinate", "multi-step", "plan", "decompose", "break down"],
    confidence: 0.9,
    reason: "Multi-step work requiring durable coordination",
    confirmationRequirements: []
  },
  model: { providerId: "omlx", modelId: "Qwen3.6-35B-A3B-OptiQ-4bit:profile-qwen-general" },
  timeoutSeconds: 3200,
  tokenBudget: 800_000,
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
} satisfies AgentDefinitionV1;
