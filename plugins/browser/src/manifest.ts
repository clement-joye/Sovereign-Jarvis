import { definePlugin } from "@second-brain/plugin-sdk";
import type { RuntimeClassPinV2 } from "@second-brain/contracts";

const model = {
  providerId: "omlx",
  modelId: "Qwen3.6-35B-A3B-OptiQ-4bit:profile-qwen-general"
};

export const BROWSER_RUNTIME_CLASS_POLICY = Object.freeze({
  id: "browser",
  mountPolicy: "none" as const,
  networkPolicy: "browser-restricted" as const,
  featureIds: ["browser-automation"],
  resourceCeiling: {
    timeoutSeconds: 900,
    tokenBudget: 1000000,
    maxConcurrentRuns: 1,
    memoryMiB: 4096,
    cpuMillicores: 2000,
    pids: 512,
    maxOutputBytes: 1000000
  }
});

export function browserRuntimeClassV2(image: string): RuntimeClassPinV2 {
  return {
    ...BROWSER_RUNTIME_CLASS_POLICY,
    featureIds: [...BROWSER_RUNTIME_CLASS_POLICY.featureIds],
    image
  };
}

const observation = (toolName: string) => ({
  id: toolName.replaceAll("_", "-"),
  toolName,
  sideEffect: "none" as const,
  approvalPolicy: "none" as const,
  idempotencyPolicy: "not-applicable" as const
});

export const BROWSER_PLUGIN_MANIFEST_V2 = definePlugin({
  schemaVersion: 2,
  id: "browser",
  displayName: "Browser",
  activation: "workspace",
  agents: [
    {
      id: "browser",
      runtimeClass: "browser",
      promptPath: "browser/AGENTS.md",
      skillPaths: ["browser/skills"],
      extensionPaths: ["extensions/browser/index.ts"],
      capabilityIds: ["browser-observation", "browser-mutation"],
      runtimeFeatureIds: ["browser-automation"],
      workspaceAccess: "none",
      threadContextPolicy: "fresh_session_with_thread_history",
      routing: {
        keywords: ["browse", "browser", "website", "web page"],
        confidence: 0.85,
        reason: "Browser research intent",
        confirmationRequirements: []
      },
      model,
      timeoutSeconds: 900,
      tokenBudget: 800000,
      maxConcurrentRunsPerWorkspace: 1
    }
  ],
  localToolProviders: [
    {
      id: "browser-observation-provider",
      capabilityId: "browser-observation",
      factoryId: "browser-tools",
      toolNames: [
        "websearch",
        "web_fetch",
        "browser_navigate",
        "browser_scroll",
        "browser_extract",
        "browser_back",
        "browser_history"
      ],
      filesystem: "none",
      process: "sandboxed",
      network: "restricted",
      sideEffect: "none"
    }
  ],
  brokerProviders: [
    {
      id: "browser-mutation-provider",
      capabilityId: "browser-mutation",
      providerId: "browser-control",
      configurationSchema: {},
      operations: [
        {
          ...observation("browser_click"),
          sideEffect: "external",
          approvalPolicy: "owner",
          idempotencyPolicy: "required"
        },
        {
          ...observation("browser_type"),
          sideEffect: "external",
          approvalPolicy: "owner",
          idempotencyPolicy: "required"
        }
      ]
    }
  ],
  runtimeFeatures: [{ id: "browser-automation" }]
});
