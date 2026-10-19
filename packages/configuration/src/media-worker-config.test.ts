import { describe, expect, it } from "vitest";

import {
  loadBrainWorkerConfig,
  loadBrainControlRuntimeConfig,
  loadPlatformCatalogPath,
  loadRuntimeProvisionerClientConfig,
  loadMediaWorkerConfig,
  loadMediaWorkerRuntimeConfig,
  loadMatrixGatewayRuntimeConfig,
  loadPiRunnerRuntimeConfig,
  loadRetentionWorkerRuntimeConfig,
  loadSchedulerRuntimeConfig,
  loadServicePortConfig
} from "./index.js";

describe("loadPlatformCatalogPath", () => {
  it("requires one explicit release artifact path", () => {
    expect(
      loadPlatformCatalogPath({ PLATFORM_CATALOG_PATH: "/release/platform-catalog.json" })
    ).toBe("/release/platform-catalog.json");
    expect(() => loadPlatformCatalogPath({})).toThrow();
    expect(() => loadPlatformCatalogPath({ PLATFORM_CATALOG_PATH: "" })).toThrow();
  });
});

describe("loadBrainWorkerConfig", () => {
  it("uses service ports that match the control and media executables", () => {
    expect(loadBrainWorkerConfig({})).toMatchObject({
      controlUrl: "http://brain-control:3000",
      mediaWorkerUrl: "http://media-worker:3030",
      controlRequestTimeoutMs: 30000,
      mediaRequestTimeoutMs: 240000,
      leaseMs: 660000,
      jobTypes: ["process_inbound", "run_schedule", "run_agent", "progress_notice"]
    });
  });

  it("rejects malformed URLs and non-positive operational limits", () => {
    expect(() => loadBrainWorkerConfig({ BRAIN_CONTROL_URL: "not a URL" })).toThrow();
    expect(() => loadBrainWorkerConfig({ BRAIN_WORKER_CLAIM_LIMIT: "0" })).toThrow();
    expect(() => loadBrainWorkerConfig({ BRAIN_WORKER_LEASE_MS: "NaN" })).toThrow();
    expect(() => loadBrainWorkerConfig({ BRAIN_WORKER_JOB_TYPES: "unknown" })).toThrow();
    expect(() =>
      loadBrainWorkerConfig({ BRAIN_WORKER_LEASE_MS: "30000", PI_TIMEOUT_SECONDS: "600" })
    ).toThrow("must be at least");
    expect(() => loadBrainWorkerConfig({ BRAIN_WORKER_CONTROL_REQUEST_TIMEOUT_MS: "0" })).toThrow();
    expect(() => loadBrainWorkerConfig({ BRAIN_WORKER_MEDIA_REQUEST_TIMEOUT_MS: "0" })).toThrow();
  });
});

describe("loadServicePortConfig", () => {
  it("requires ports in the TCP range", () => {
    expect(loadServicePortConfig(undefined, 3010)).toEqual({ port: 3010 });
    expect(() => loadServicePortConfig("0", 3010)).toThrow();
    expect(() => loadServicePortConfig("70000", 3010)).toThrow();
  });
});

describe("periodic worker runtime configuration", () => {
  it("uses valid defaults and rejects invalid operational values", () => {
    expect(loadSchedulerRuntimeConfig({})).toMatchObject({
      controlBaseUrl: "http://localhost:3000",
      intervalMs: 30000,
      claimLimit: 10,
      runOnStart: false
    });
    expect(loadRetentionWorkerRuntimeConfig({})).toMatchObject({
      intervalMs: 3600000,
      dryRun: true,
      limit: 100,
      runOnStart: false
    });

    expect(() => loadSchedulerRuntimeConfig({ SCHEDULER_POLL_INTERVAL_MS: "0" })).toThrow();
    expect(() => loadRetentionWorkerRuntimeConfig({ RETENTION_BATCH_LIMIT: "bad" })).toThrow();
    expect(() => loadSchedulerRuntimeConfig({ BRAIN_CONTROL_URL: "ftp://example.test" })).toThrow();
  });
});

describe("service runtime configuration", () => {
  it("uses matching service defaults and rejects invalid ports or URLs", () => {
    expect(loadBrainControlRuntimeConfig({})).toMatchObject({
      port: 3000,
      sessionRetentionMs: 604800000,
      retentionMs: 604800000,
      agentRootConcurrency: 1,
      agentAdmissionLeaseSeconds: 90,
      agentAdmissionHeartbeatSeconds: 30
    });
    expect(
      loadPiRunnerRuntimeConfig({
        PI_MODEL_PROVIDER_ID: "test-provider",
        PI_MODEL_ID: "test-model"
      })
    ).toMatchObject({
      port: 3010,
      brainControlUrl: "http://brain-control:3000",
      runnerImplementation: "deterministic",
      providerId: "test-provider",
      modelId: "test-model"
    });
    expect(
      loadPiRunnerRuntimeConfig({
        PI_RUNNER_IMPLEMENTATION: "pi-coding-agent",
        PI_MODEL_PROVIDER_ID: "reviewed-provider",
        PI_MODEL_ID: "reviewed-model"
      })
    ).toMatchObject({
      runnerImplementation: "pi-coding-agent",
      providerId: "reviewed-provider",
      modelId: "reviewed-model"
    });
    expect(
      loadPiRunnerRuntimeConfig({
        PI_PROFILE_ROOT: "/opt/profile",
        PI_RESOURCE_ROOT: "/opt/role-resources",
        PI_MODEL_PROVIDER_ID: "test-provider",
        PI_MODEL_ID: "test-model"
      })
    ).toMatchObject({
      profileRoot: "/opt/profile",
      resourceRoot: "/opt/role-resources"
    });
    expect(
      loadPiRunnerRuntimeConfig({
        PI_ALLOWED_TOOLS: "workspace_read, workspace_write",
        PI_MODEL_PROVIDER_ID: "test-provider",
        PI_MODEL_ID: "test-model"
      }).allowedTools
    ).toEqual(["workspace_read", "workspace_write"]);
    expect(
      loadPiRunnerRuntimeConfig({
        PI_BRAIN_ALLOWED_TOOLS: "workspace_read",
        PI_CODE_ALLOWED_TOOLS: "workspace_read, workspace_write",
        PI_MODEL_PROVIDER_ID: "test-provider",
        PI_MODEL_ID: "test-model"
      })
    ).not.toHaveProperty("brainAllowedTools");
    expect(() =>
      loadPiRunnerRuntimeConfig({
        PI_ALLOWED_TOOLS: "workspace_read,../bash",
        PI_MODEL_PROVIDER_ID: "test-provider",
        PI_MODEL_ID: "test-model"
      })
    ).toThrow();
    expect(() =>
      loadPiRunnerRuntimeConfig({
        PI_PROFILE_ROOT: "relative-profile",
        PI_MODEL_PROVIDER_ID: "test-provider",
        PI_MODEL_ID: "test-model"
      })
    ).toThrow();
    expect(() =>
      loadPiRunnerRuntimeConfig({
        PI_RESOURCE_ROOT: "relative-role-resources",
        PI_MODEL_PROVIDER_ID: "test-provider",
        PI_MODEL_ID: "test-model"
      })
    ).toThrow();
    expect(loadMediaWorkerRuntimeConfig({})).toEqual({ port: 3030 });

    expect(() => loadBrainControlRuntimeConfig({ BRAIN_CONTROL_PORT: "70000" })).toThrow();
    expect(() =>
      loadPiRunnerRuntimeConfig({
        BRAIN_CONTROL_URL: "ftp://example.test",
        PI_MODEL_PROVIDER_ID: "test-provider",
        PI_MODEL_ID: "test-model"
      })
    ).toThrow();
    expect(() => loadPiRunnerRuntimeConfig({})).toThrow();
    expect(() => loadMediaWorkerRuntimeConfig({ MEDIA_WORKER_PORT: "0" })).toThrow();
  });

  it("validates Brain Control root-run admission settings", () => {
    expect(
      loadBrainControlRuntimeConfig({
        AGENT_ROOT_CONCURRENCY: "4",
        AGENT_ADMISSION_LEASE_SECONDS: "120",
        AGENT_ADMISSION_HEARTBEAT_SECONDS: "40"
      })
    ).toMatchObject({
      agentRootConcurrency: 4,
      agentAdmissionLeaseSeconds: 120,
      agentAdmissionHeartbeatSeconds: 40
    });

    expect(() => loadBrainControlRuntimeConfig({ AGENT_ROOT_CONCURRENCY: "0" })).toThrow();
    expect(() =>
      loadBrainControlRuntimeConfig({ AGENT_ADMISSION_LEASE_SECONDS: "not-a-number" })
    ).toThrow();
    expect(() =>
      loadBrainControlRuntimeConfig({ AGENT_ADMISSION_HEARTBEAT_SECONDS: "-1" })
    ).toThrow();
    expect(() =>
      loadBrainControlRuntimeConfig({
        AGENT_ADMISSION_LEASE_SECONDS: "59",
        AGENT_ADMISSION_HEARTBEAT_SECONDS: "20"
      })
    ).toThrow(
      "AGENT_ADMISSION_LEASE_SECONDS must be at least three times AGENT_ADMISSION_HEARTBEAT_SECONDS"
    );
  });

  it("requires both provisioner endpoint and token when either is configured", () => {
    expect(loadRuntimeProvisionerClientConfig({})).toBeUndefined();
    expect(
      loadRuntimeProvisionerClientConfig({
        RUNTIME_PROVISIONER_URL: "http://runtime-provisioner:3040",
        RUNTIME_PROVISIONER_TOKEN: "secret"
      })
    ).toEqual({ baseUrl: "http://runtime-provisioner:3040", token: "secret" });
    expect(() =>
      loadRuntimeProvisionerClientConfig({
        RUNTIME_PROVISIONER_URL: "http://runtime-provisioner:3040"
      })
    ).toThrow();
  });
});

describe("loadMatrixGatewayRuntimeConfig", () => {
  it("uses the existing Matrix Gateway defaults", () => {
    expect(loadMatrixGatewayRuntimeConfig({})).toMatchObject({
      port: 3020,
      controlBaseUrl: "http://localhost:3000",
      outboundPollMs: 2000,
      outboundClaimLimit: 10,
      maxMediaBytes: 26214400
    });
  });

  it("rejects invalid URLs and non-positive operational settings", () => {
    expect(() =>
      loadMatrixGatewayRuntimeConfig({ MATRIX_HOMESERVER_URL: "ftp://example.test" })
    ).toThrow();
    expect(() => loadMatrixGatewayRuntimeConfig({ MATRIX_OUTBOUND_POLL_MS: "0" })).toThrow();
    expect(() =>
      loadMatrixGatewayRuntimeConfig({ MATRIX_MAX_MEDIA_BYTES: "not-a-number" })
    ).toThrow();
  });
});

describe("loadMediaWorkerConfig", () => {
  it("uses the deterministic provider only outside production", () => {
    expect(loadMediaWorkerConfig({ SECOND_BRAIN_ENVIRONMENT: "dev" })).toMatchObject({
      sttProvider: "deterministic",
      exchangeRoot: "/brain/exchange"
    });
    expect(() =>
      loadMediaWorkerConfig({
        SECOND_BRAIN_ENVIRONMENT: "production",
        MEDIA_STT_PROVIDER: "deterministic"
      })
    ).toThrow("not permitted in production");
  });

  it("requires a pinned model identity for whisper.cpp", () => {
    expect(() =>
      loadMediaWorkerConfig({
        SECOND_BRAIN_ENVIRONMENT: "production",
        MEDIA_STT_PROVIDER: "whisper-cpp"
      })
    ).toThrow();

    expect(
      loadMediaWorkerConfig({
        SECOND_BRAIN_ENVIRONMENT: "production",
        MEDIA_STT_PROVIDER: "whisper-cpp",
        WHISPER_CPP_MODEL_PATH: "/opt/whisper-models/ggml-small.bin",
        WHISPER_CPP_RUNTIME_VERSION: "v1.7.4",
        WHISPER_CPP_MODEL_ID: "ggml-small",
        WHISPER_CPP_MODEL_SHA256: "a".repeat(64),
        PIPER_MODEL_PATH: "/opt/piper-models/en_US-lessac-medium.onnx",
        PIPER_RUNTIME_VERSION: "v1.0.0",
        PIPER_MODEL_ID: "en_US-lessac-medium",
        PIPER_MODEL_SHA256: "b".repeat(64)
      })
    ).toMatchObject({
      sttProvider: "whisper-cpp",
      sttMaxConcurrency: 1,
      sttTimeoutMs: 180000
    });
  });

  it("requires a pinned Piper model identity for local TTS", () => {
    expect(() =>
      loadMediaWorkerConfig({
        SECOND_BRAIN_ENVIRONMENT: "dev",
        MEDIA_TTS_PROVIDER: "piper"
      })
    ).toThrow("Piper TTS requires a pinned model identity");

    expect(
      loadMediaWorkerConfig({
        SECOND_BRAIN_ENVIRONMENT: "dev",
        MEDIA_TTS_PROVIDER: "piper",
        PIPER_MODEL_PATH: "/opt/piper-models/en_US-lessac-medium.onnx",
        PIPER_RUNTIME_VERSION: "v1.0.0",
        PIPER_MODEL_ID: "en_US-lessac-medium",
        PIPER_MODEL_SHA256: "b".repeat(64)
      })
    ).toMatchObject({
      ttsProvider: "piper",
      ttsTimeoutMs: 60000
    });
  });
});
