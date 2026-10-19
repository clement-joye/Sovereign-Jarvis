import { describe, expect, it } from "vitest";
import { exampleInboundMessage, exampleOutboundMessage } from "./examples.js";
import {
  ActionApprovalDecisionV1Schema,
  ActionOperationV1Schema,
  ActionProposalCreateRequestV1Schema,
  ActionProposalOutcomeV1Schema,
  ActionProposalV1Schema,
  ApprovalPolicyV1Schema,
  ConversationVoicePreferenceRequestV1Schema,
  ConversationVoicePreferenceResponseV1Schema,
  InboundAcceptanceResponseV1Schema,
  InboundMessageV1Schema,
  JobClaimRequestV1Schema,
  JobCompleteResponseV1Schema,
  JobCompleteWithOutboundRequestV1Schema,
  MediaSpeechResponseV1Schema,
  MediaTranscriptionResponseV1Schema,
  OutboundClaimRequestV1Schema,
  OutboundDeliveredRequestV1Schema,
  OutboundDeliveryFailureRequestV1Schema,
  OutboundMessageV1Schema,
  PiSessionCreateRequestV1Schema,
  PiRunCancelResponseV1Schema,
  PiSessionCancelResponseV1Schema,
  SessionBindingActivateRequestV1Schema,
  SessionBindingLookupRequestV1Schema,
  SessionCreateAndBindRequestV1Schema,
  SessionCreateRequestV1Schema,
  ScheduleCreateRequestV1Schema,
  ScheduleMutationResultV1Schema,
  ScheduleUpdateRequestV1Schema,
  HostLocalRuntimeProfileManifestV1Schema,
  ProfileArtifactManifestV1Schema,
  AgentCatalogV1Schema,
  AgentArtifactV1Schema,
  AgentRunV1Schema,
  DelegationGrantV1Schema,
  PlannerDelegationSpecV1Schema,
  WorkspaceTemplateManifestV1Schema
} from "./schemas.js";

describe("contract schemas", () => {
  it("validates generic durable approval proposals and trusted decisions", () => {
    const proposal = {
      schemaVersion: 1,
      id: "proposal-1",
      operationDigest: `sha256:${"a".repeat(64)}`,
      workspaceId: "workspace-1",
      agentId: "fixture-agent",
      runId: "run-1",
      pluginId: "publishing-test",
      capabilityId: "publishing",
      operationId: "publish",
      operationVersion: "1.0.0",
      summary: "Publish reviewed content",
      parameters: { target: "reviewed" },
      approvalMode: "owner",
      requiredApprover: "owner",
      idempotencyKey: "push:workspace-1:run-1:1",
      status: "proposed",
      createdAt: "2026-08-29T12:00:00.000Z",
      expiresAt: "2026-08-29T12:05:00.000Z"
    };
    expect(ActionProposalV1Schema.parse(proposal)).toEqual(proposal);
    expect(ActionProposalV1Schema.parse({ ...proposal, status: "rejected" }).status).toBe(
      "rejected"
    );
    expect(
      ActionProposalCreateRequestV1Schema.parse({
        schemaVersion: 1,
        workspaceId: proposal.workspaceId,
        agentId: proposal.agentId,
        runId: proposal.runId,
        pluginId: proposal.pluginId,
        operation: {
          capabilityId: proposal.capabilityId,
          operationId: proposal.operationId,
          operationVersion: proposal.operationVersion,
          approvalPolicy: { minimumMode: "owner" }
        },
        operationDigest: proposal.operationDigest,
        summary: proposal.summary,
        parameters: proposal.parameters,
        approvalMode: proposal.approvalMode,
        idempotencyKey: proposal.idempotencyKey,
        expiresAt: proposal.expiresAt
      })
    ).toMatchObject({ operation: { approvalPolicy: { userMayStrengthen: true } } });
    expect(
      ActionApprovalDecisionV1Schema.parse({
        schemaVersion: 1,
        proposalId: proposal.id,
        workspaceId: proposal.workspaceId,
        ownerId: "owner-1",
        decision: "approve",
        decidedBy: "owner",
        decidedAt: "2026-08-29T12:01:00.000Z",
        externalEventId: "$event-1"
      }).decidedBy
    ).toBe("owner");
    expect(
      ActionProposalOutcomeV1Schema.parse({
        schemaVersion: 1,
        outcome: "pending",
        proposal
      }).outcome
    ).toBe("pending");
  });

  it("rejects model-authored decisions and malformed approval policy", () => {
    expect(() =>
      ActionApprovalDecisionV1Schema.parse({
        schemaVersion: 1,
        proposalId: "proposal-1",
        workspaceId: "workspace-1",
        ownerId: "owner-1",
        decision: "approve",
        decidedBy: "model",
        decidedAt: "2026-08-29T12:01:00.000Z"
      })
    ).toThrow();
    expect(() =>
      ApprovalPolicyV1Schema.parse({ minimumMode: "owner", userMayStrengthen: false })
    ).toThrow();
    expect(() =>
      ActionProposalV1Schema.parse({
        schemaVersion: 1,
        id: "proposal-mismatch",
        operationDigest: `sha256:${"a".repeat(64)}`,
        workspaceId: "workspace-1",
        agentId: "fixture-agent",
        runId: "run-1",
        pluginId: "publishing-test",
        capabilityId: "publishing",
        operationId: "publish",
        operationVersion: "1.0.0",
        summary: "Publish reviewed content",
        parameters: {},
        approvalMode: "owner",
        requiredApprover: "none",
        idempotencyKey: "push:workspace-1:run-1:mismatch",
        status: "proposed",
        createdAt: "2026-08-29T12:00:00.000Z",
        expiresAt: "2026-08-29T12:05:00.000Z"
      })
    ).toThrow("effective approval mode");
    expect(() =>
      ActionOperationV1Schema.parse({
        capabilityId: "publishing",
        operationId: "publish",
        operationVersion: "1.0",
        approvalPolicy: { minimumMode: "owner" }
      })
    ).toThrow();
  });

  it("validates durable collaboration records without secret fields", () => {
    const grant = {
      schemaVersion: 1,
      id: "grant-1",
      parentRunId: "run-parent",
      workspaceId: "workspace-1",
      childAgentId: "document-analyzer",
      allowedTools: ["workspace_read"],
      readablePaths: ["notes/project"],
      writablePaths: ["notes/project"],
      timeoutSeconds: 60,
      tokenBudget: 1000,
      expiresAt: "2026-08-18T21:00:00.000Z"
    };
    expect(DelegationGrantV1Schema.parse(grant)).toEqual(grant);
    expect(DelegationGrantV1Schema.parse({ ...grant, allowedTools: [] }).allowedTools).toEqual([]);
    expect(() => DelegationGrantV1Schema.parse({ ...grant, credential: "secret" })).toThrow();
    expect(
      PlannerDelegationSpecV1Schema.parse({
        targetAgentId: "brain",
        task: "State your mission in one sentence."
      })
    ).toMatchObject({
      targetAgentId: "brain",
      allowedTools: [],
      readablePaths: [],
      writablePaths: []
    });
    expect(
      PlannerDelegationSpecV1Schema.safeParse({
        targetAgentId: "brain",
        task: "State your mission in one sentence.",
        tokenBudget: 5_000
      }).success
    ).toBe(false);
    expect(
      AgentRunV1Schema.parse({
        schemaVersion: 1,
        id: "run-child",
        workspaceId: "workspace-1",
        agentId: "document-analyzer",
        catalogVersion: "1.0.0",
        catalogDigest: `sha256:${"a".repeat(64)}`,
        status: "queued",
        rootRunId: "run-parent",
        parentRunId: "run-parent",
        delegationGrantId: "grant-1",
        deadlineAt: "2026-08-18T21:00:00.000Z",
        timeoutSeconds: 60,
        tokenBudget: 1000,
        createdAt: "2026-08-18T20:00:00.000Z"
      })
    ).toMatchObject({ rootRunId: "run-parent", parentRunId: "run-parent" });
    expect(() =>
      AgentRunV1Schema.parse({
        schemaVersion: 1,
        id: "run-root",
        rootRunId: "different-root",
        workspaceId: "workspace-1",
        agentId: "document-analyzer",
        catalogVersion: "1.0.0",
        catalogDigest: `sha256:${"a".repeat(64)}`,
        status: "queued",
        deadlineAt: "2026-08-18T21:00:00.000Z",
        timeoutSeconds: 60,
        tokenBudget: 1000,
        createdAt: "2026-08-18T20:00:00.000Z"
      })
    ).toThrow(/own ID/);
    expect(
      AgentArtifactV1Schema.parse({
        schemaVersion: 1,
        id: "artifact-1",
        workspaceId: "workspace-1",
        producingRunId: "run-child",
        parentRunId: "run-parent",
        agentId: "document-analyzer",
        catalogVersion: "1.0.0",
        catalogDigest: `sha256:${"a".repeat(64)}`,
        kind: "draft",
        storageKey: "artifacts/draft.md",
        sha256: "b".repeat(64),
        createdAt: "2026-08-18T20:00:00.000Z"
      }).kind
    ).toBe("draft");
  });
  it("validates bounded reviewed agent catalogs", () => {
    const catalog = {
      schemaVersion: 1,
      version: "1.0.0",
      digest: `sha256:${"a".repeat(64)}`,
      runtimeClasses: [
        {
          id: "base",
          image: `sha256:${"b".repeat(64)}`,
          networkPolicy: "restricted",
          maxConcurrentRuns: 1,
          timeoutSeconds: 600,
          memoryMiB: 4096,
          cpuMillicores: 4000
        }
      ],
      agents: [
        {
          schemaVersion: 1,
          id: "brain",
          defaultForWorkspace: true,
          version: "1.0.0",
          runtimeClass: "base",
          promptPath: "brain/AGENTS.md",
          skillPaths: ["brain/skills"],
          extensionPaths: [],
          toolPolicy: ["workspace_read"],
          networkPolicy: "restricted",
          workspaceAccess: "write",
          timeoutSeconds: 600,
          tokenBudget: 100000,
          maxConcurrentRunsPerWorkspace: 1
        }
      ]
    };
    expect(AgentCatalogV1Schema.parse(catalog)).toEqual(catalog);
    expect(() =>
      AgentCatalogV1Schema.parse({
        ...catalog,
        agents: [{ ...catalog.agents[0], runtimeClass: "unreviewed" }]
      })
    ).toThrow("Unknown runtime class");
    expect(() =>
      AgentCatalogV1Schema.parse({
        ...catalog,
        agents: [{ ...catalog.agents[0], credential: "secret" }]
      })
    ).toThrow();
  });
  it("requires a complete immutable profile artifact inventory", () => {
    const manifest = {
      schemaVersion: 1,
      id: "pi-jarvis",
      version: "1.0.0",
      source: {
        repository: "https://github.com/clement-joye/pi-local-profile",
        revision: "a".repeat(40),
        digest: `sha256:${"b".repeat(64)}`
      },
      runtimeImage: `jarvis/assistant-runtime@sha256:${"c".repeat(64)}`,
      modelsPath: "models.json",
      resources: [
        {
          path: "extensions/tool-gating/index.ts",
          kind: "extension",
          compatibility: "sdk-compatible",
          rationale: "Uses SDK tool hooks and a fixed policy allowlist."
        }
      ]
    };
    expect(ProfileArtifactManifestV1Schema.parse(manifest)).toEqual(manifest);
    expect(() =>
      ProfileArtifactManifestV1Schema.parse({
        ...manifest,
        resources: [...manifest.resources, manifest.resources[0]]
      })
    ).toThrow("Duplicate profile resource path");
  });

  it("permits model access only through the reviewed restricted network", () => {
    const profileArtifact = {
      schemaVersion: 1,
      id: "pi-jarvis",
      version: "1.0.0",
      source: {
        repository: "https://example.test/profile",
        revision: "a".repeat(40),
        digest: `sha256:${"b".repeat(64)}`
      },
      runtimeImage: `sha256:${"c".repeat(64)}`,
      modelsPath: "models.json",
      resources: [
        {
          path: "skills",
          kind: "skill",
          compatibility: "sdk-compatible",
          rationale: "Reviewed static skills."
        }
      ]
    };
    const base = {
      schemaVersion: 1,
      profileArtifact,
      currentRuntime: {
        templateId: "code-project",
        templateVersion: "1.0.0",
        imageId: `sha256:${"c".repeat(64)}`,
        network: "restricted"
      }
    };

    expect(HostLocalRuntimeProfileManifestV1Schema.parse(base).currentRuntime).toMatchObject({
      modelNetwork: "none"
    });
    expect(() =>
      HostLocalRuntimeProfileManifestV1Schema.parse({
        ...base,
        currentRuntime: { ...base.currentRuntime, modelNetwork: "public" }
      })
    ).toThrow();
  });

  it("accepts an optional immutable release-relative resource bundle", () => {
    const profileArtifact = {
      schemaVersion: 1,
      id: "pi-jarvis",
      version: "1.0.0",
      source: {
        repository: "https://example.test/profile",
        revision: "a".repeat(40),
        digest: `sha256:${"b".repeat(64)}`
      },
      runtimeImage: `sha256:${"c".repeat(64)}`,
      modelsPath: "models.json",
      resources: [
        {
          path: "skills",
          kind: "skill",
          compatibility: "sdk-compatible",
          rationale: "Reviewed static skills."
        }
      ]
    };
    const base = {
      schemaVersion: 1,
      profileArtifact,
      currentRuntime: {
        templateId: "code-project",
        templateVersion: "1.0.0",
        imageId: `sha256:${"c".repeat(64)}`,
        network: "restricted"
      }
    };

    expect(
      HostLocalRuntimeProfileManifestV1Schema.parse({
        ...base,
        currentRuntime: {
          ...base.currentRuntime,
          resourceBundle: {
            digest: `sha256:${"d".repeat(64)}`,
            artifactName: "role-resources"
          }
        }
      }).currentRuntime.resourceBundle
    ).toEqual({ digest: `sha256:${"d".repeat(64)}`, artifactName: "role-resources" });
    expect(() =>
      HostLocalRuntimeProfileManifestV1Schema.parse({
        ...base,
        currentRuntime: {
          ...base.currentRuntime,
          resourceBundle: {
            digest: `sha256:${"d".repeat(64)}`,
            artifactName: "/etc/jarvis/roles"
          }
        }
      })
    ).toThrow();
  });

  it("accepts the canonical inbound message example", () => {
    expect(InboundMessageV1Schema.parse(exampleInboundMessage)).toEqual(exampleInboundMessage);
  });

  it("validates inbound acceptance responses", () => {
    expect(
      InboundAcceptanceResponseV1Schema.parse({
        inboundMessageId: "inbound-1",
        duplicate: false,
        jobId: "job-1"
      })
    ).toMatchObject({ duplicate: false });
    expect(() =>
      InboundAcceptanceResponseV1Schema.parse({
        inboundMessageId: "inbound-1",
        duplicate: "false",
        jobId: "job-1"
      })
    ).toThrow();
  });

  it("rejects inbound messages without content", () => {
    expect(() =>
      InboundMessageV1Schema.parse({ ...exampleInboundMessage, text: undefined, attachments: [] })
    ).toThrow(/require text or attachments/);
  });

  it("rejects outbound messages without output", () => {
    expect(() =>
      OutboundMessageV1Schema.parse({ ...exampleOutboundMessage, text: undefined, images: [] })
    ).toThrow(/require text, audio, images, or files/);
  });

  it("requires an explicit supported outbound presentation", () => {
    expect(() =>
      OutboundMessageV1Schema.parse({ ...exampleOutboundMessage, presentation: undefined })
    ).toThrow();
    expect(() =>
      OutboundMessageV1Schema.parse({ ...exampleOutboundMessage, presentation: "progress" })
    ).toThrow();
  });

  it("validates Media Worker responses", () => {
    expect(MediaTranscriptionResponseV1Schema.parse({ text: "Hello", language: "en" })).toEqual({
      text: "Hello",
      language: "en"
    });
    expect(() => MediaSpeechResponseV1Schema.parse({ audio: {} })).toThrow();
  });

  it("validates a versioned workspace template manifest", () => {
    const manifest = {
      schemaVersion: 1,
      id: "code-project",
      version: "1.0.0",
      displayName: "Code project",
      runtimeClass: "code-project" as const,
      systemPromptPath: "prompts/system.md",
      profileArtifact: {
        id: "pi-jarvis",
        digest: `sha256:${"a".repeat(64)}`,
        modelsPath: "models.json"
      },
      skills: ["skills/protocols/task-decomposition.md"],
      extensions: ["extensions/tool-gating/index.ts"],
      tools: ["workspace-read", "workspace-write"],
      capabilities: {
        filesystem: "workspace-write" as const,
        network: "restricted" as const,
        subagents: true
      },
      onboarding: [
        {
          id: "repository-name",
          label: "Repository name",
          type: "text" as const,
          required: true
        },
        {
          id: "language",
          label: "Language",
          type: "select" as const,
          required: true,
          options: ["TypeScript", "Python"]
        }
      ]
    };

    expect(WorkspaceTemplateManifestV1Schema.parse(manifest)).toEqual(manifest);
  });

  it("rejects unsafe template resources and malformed onboarding", () => {
    const base = {
      schemaVersion: 1,
      id: "second-brain",
      version: "1.0.0",
      displayName: "Second brain",
      runtimeClass: "second-brain" as const,
      systemPromptPath: "prompts/system.md",
      profileArtifact: {
        id: "second-brain-profile",
        digest: `sha256:${"b".repeat(64)}`,
        modelsPath: "models.json"
      },
      skills: [],
      extensions: [],
      tools: ["workspace-read"],
      capabilities: {
        filesystem: "read-only" as const,
        network: "none" as const,
        subagents: false
      },
      onboarding: []
    };

    expect(() =>
      WorkspaceTemplateManifestV1Schema.parse({ ...base, systemPromptPath: "../prompts/system.md" })
    ).toThrow(/relative paths/);
    expect(() =>
      WorkspaceTemplateManifestV1Schema.parse({
        ...base,
        onboarding: [
          {
            id: "language",
            label: "Language",
            type: "select",
            required: true
          }
        ]
      })
    ).toThrow(/require options/);
  });

  it("accepts valid schedule policy controls and rejects invalid values", () => {
    expect(
      ScheduleCreateRequestV1Schema.parse({
        name: "Daily review",
        instruction: "Review.",
        schedule: { type: "cron", expression: "0 9 * * *", timezone: "Europe/Stockholm" },
        sessionPolicy: { type: "fresh" },
        overlapPolicy: "skip",
        missedRunPolicy: "skip",
        timeoutSeconds: 300
      })
    ).toMatchObject({ missedRunPolicy: "skip" });

    expect(() =>
      ScheduleCreateRequestV1Schema.parse({
        name: "Daily review",
        instruction: "Review.",
        schedule: { type: "cron", expression: "0 9 * * *", timezone: "Europe/Stockholm" },
        missedRunPolicy: "replay_all"
      })
    ).toThrow();
  });

  it("requires one-time schedule timestamps to include a UTC offset", () => {
    const input = {
      name: "One-time reminder",
      instruction: "Remind me.",
      schedule: { type: "once" as const, runAt: "2026-08-01T09:00:00+02:00" }
    };
    expect(ScheduleCreateRequestV1Schema.parse(input)).toMatchObject(input);
    expect(() =>
      ScheduleCreateRequestV1Schema.parse({
        ...input,
        schedule: { type: "once", runAt: "2026-08-01T09:00:00" }
      })
    ).toThrow();
  });

  it("requires an expected version for schedule updates", () => {
    expect(() => ScheduleUpdateRequestV1Schema.parse({ name: "Renamed" })).toThrow();
    expect(ScheduleUpdateRequestV1Schema.parse({ name: "Renamed", expectedVersion: 1 })).toEqual({
      name: "Renamed",
      expectedVersion: 1
    });
  });

  it("validates schedule mutation results", () => {
    const result = {
      schedule: {
        schemaVersion: 1,
        id: "schedule-1",
        agentId: "brain",
        name: "Daily review",
        instruction: "Review.",
        schedule: { type: "cron" as const, expression: "0 9 * * *", timezone: "Europe/Stockholm" },
        enabled: true,
        sessionPolicy: { type: "fresh" as const },
        notificationPolicy: "always" as const,
        overlapPolicy: "skip" as const,
        missedRunPolicy: "run_once" as const,
        timeoutSeconds: 300,
        version: 1,
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z"
      },
      preview: { occurrences: ["2026-07-28T09:00:00.000Z"] }
    };
    expect(ScheduleMutationResultV1Schema.parse(result)).toEqual(result);
    expect(() => ScheduleMutationResultV1Schema.parse({ ...result, preview: {} })).toThrow();
  });

  it("accepts only a non-empty session id when creating Pi sessions", () => {
    expect(PiSessionCreateRequestV1Schema.parse({ sessionId: "session-1" })).toEqual({
      sessionId: "session-1"
    });
    expect(() => PiSessionCreateRequestV1Schema.parse({ sessionId: "", extra: true })).toThrow();
    expect(PiRunCancelResponseV1Schema.parse({ cancelled: true, runId: "run-1" })).toEqual({
      cancelled: true,
      runId: "run-1"
    });
    expect(
      PiSessionCancelResponseV1Schema.parse({ cancelled: true, sessionId: "session-1" })
    ).toEqual({
      cancelled: true,
      sessionId: "session-1"
    });
  });

  it("validates session binding lookup and activation requests", () => {
    expect(
      SessionBindingLookupRequestV1Schema.parse({
        conversationId: "room-1",
        threadRootExternalEventId: "$thread-1",
        agentId: "fixture-agent"
      })
    ).toMatchObject({ conversationId: "room-1", agentId: "fixture-agent" });
    expect(() =>
      SessionBindingLookupRequestV1Schema.parse({ conversationId: "", extra: true })
    ).toThrow();
    expect(
      SessionBindingActivateRequestV1Schema.parse({
        sessionId: "session-1",
        conversationId: "room-1",
        agentId: "brain"
      })
    ).toMatchObject({ sessionId: "session-1", agentId: "brain" });
  });

  it("validates session creation and binding records", () => {
    const session = {
      id: "session-1",
      status: "active" as const,
      createdAt: "2026-07-26T00:00:00.000Z",
      lastActiveAt: "2026-07-26T00:00:00.000Z",
      idleExpiresAt: "2026-07-26T01:00:00.000Z",
      absoluteExpiresAt: "2026-07-27T00:00:00.000Z",
      piSessionKey: "pi-session-1",
      sourceType: "default-room" as const
    };

    expect(SessionCreateRequestV1Schema.parse(session)).toEqual(session);
    expect(() =>
      SessionCreateRequestV1Schema.parse({ ...session, createdAt: "not-a-timestamp" })
    ).toThrow();
    expect(
      SessionCreateAndBindRequestV1Schema.parse({ session, conversationId: "room-1" })
    ).toMatchObject({ conversationId: "room-1", session: { id: "session-1" } });
    expect(() =>
      SessionCreateAndBindRequestV1Schema.parse({ session, conversationId: "room-1", extra: true })
    ).toThrow();
  });

  it("validates voice-preference lookup and update requests", () => {
    expect(
      ConversationVoicePreferenceRequestV1Schema.parse({
        workspaceId: "workspace-1",
        conversationId: "room-1",
        enabled: true
      })
    ).toMatchObject({ enabled: true });
    expect(() =>
      ConversationVoicePreferenceRequestV1Schema.parse({ conversationId: "room-1", enabled: "yes" })
    ).toThrow();
    expect(ConversationVoicePreferenceResponseV1Schema.parse({ enabled: true })).toEqual({
      enabled: true
    });
    expect(() => ConversationVoicePreferenceResponseV1Schema.parse({ enabled: "yes" })).toThrow();
  });

  it("validates strict job-control request bodies", () => {
    expect(
      JobClaimRequestV1Schema.parse({
        workerId: "worker-1",
        limit: 2,
        leaseMs: 30_000,
        jobTypes: ["run_agent"]
      })
    ).toMatchObject({ workerId: "worker-1" });
    expect(() => JobClaimRequestV1Schema.parse({ workerId: "", limit: 0 })).toThrow();
    expect(() =>
      JobClaimRequestV1Schema.parse({ workerId: "worker-1", jobTypes: ["unknown"] })
    ).toThrow();
    expect(JobCompleteResponseV1Schema.parse({ ok: true })).toEqual({ ok: true });
    expect(() => JobCompleteResponseV1Schema.parse({ ok: false })).toThrow();
    expect(() =>
      JobCompleteWithOutboundRequestV1Schema.parse({
        leaseOwner: "worker-1",
        outbound: exampleOutboundMessage,
        ignored: true
      })
    ).toThrow();
  });

  it("validates strict outbound delivery request bodies", () => {
    expect(OutboundClaimRequestV1Schema.parse({ limit: 10 })).toEqual({ limit: 10 });
    expect(() => OutboundClaimRequestV1Schema.parse({ limit: 0 })).toThrow();
    expect(() =>
      OutboundDeliveredRequestV1Schema.parse({ externalEventId: "", extra: true })
    ).toThrow();
    expect(
      OutboundDeliveryFailureRequestV1Schema.parse({
        error: {
          schemaVersion: 1,
          code: "matrix_unavailable",
          category: "dependency",
          message: "Matrix is unavailable.",
          retryable: true
        }
      })
    ).toMatchObject({ error: { code: "matrix_unavailable" } });
  });
});
