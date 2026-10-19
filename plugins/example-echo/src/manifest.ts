import { definePlugin } from "@second-brain/plugin-sdk";

export const EXAMPLE_ECHO_PLUGIN_MANIFEST_V2 = definePlugin({
  schemaVersion: 2,
  id: "example-echo",
  displayName: "Example echo",
  activation: "workspace",
  agents: [
    {
      id: "echo",
      runtimeClass: "isolated",
      promptPath: "echo/AGENTS.md",
      skillPaths: ["echo/skills"],
      extensionPaths: [],
      capabilityIds: ["echo"],
      runtimeFeatureIds: [],
      workspaceAccess: "none",
      threadContextPolicy: "fresh_session_with_thread_history",
      model: { providerId: "omlx", modelId: "Qwen3.6-35B-A3B-OptiQ-4bit:profile-qwen-general" },
      timeoutSeconds: 60,
      tokenBudget: 800000,
      maxConcurrentRunsPerWorkspace: 1
    }
  ],
  localToolProviders: [
    {
      id: "echo-provider",
      capabilityId: "echo",
      factoryId: "example-echo-tools",
      toolNames: ["echo"],
      filesystem: "none",
      process: "none",
      network: "none",
      sideEffect: "none"
    }
  ],
  brokerProviders: [],
  runtimeFeatures: []
});
