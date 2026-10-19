import {
  minimumTokenBudget,
  type AgentRunV1,
  type InternalJobV1,
  type PiRunRequestV1,
  type TokenBudget
} from "@second-brain/contracts";
import {
  effectiveDelegatedTools,
  type AgentCatalog,
  type ClockPort,
  type IdGeneratorPort
} from "@second-brain/domain";

import type { AgentCollaborationRepositoryPort, JobQueuePort, PiRunnerPort } from "../../ports.js";
import { requireStringJobPayload } from "../../workers/worker-job-input.js";
import { TerminalWorkerError } from "../../workers/worker-errors.js";
import type { WorkspaceWriteLeaseService } from "../../workspaces/runtime/workspace-write-lease-service.js";
import { selectEffectiveRunPolicy } from "../../policy/effective-run-policy-selector.js";
import { validateDelegationLineage } from "./agent-run-lineage-validation.js";
import { delegatedPaths, delegatedTools, sameValues } from "./agent-run-job-payload.js";
import { assertExecutionIdentity, terminal } from "./agent-run-job-state.js";

export interface AgentRunJobHandlerOptions {
  runs: Pick<
    AgentCollaborationRepositoryPort,
    "getRun" | "getGrant" | "updateRun" | "createArtifact"
  >;
  pi: Pick<PiRunnerPort, "run">;
  jobs: Pick<JobQueuePort, "complete">;
  workerId: string;
  clock: ClockPort;
  ids: IdGeneratorPort;
  activeCatalog: AgentCatalog;
  leases?: Pick<WorkspaceWriteLeaseService, "acquire" | "release"> | undefined;
  authorization?: { run<T>(token: string, action: () => Promise<T>): Promise<T> } | undefined;
}

/** Executes a durable child run and records a terminal status before job completion. */
export class AgentRunJobHandler {
  private readonly runs: AgentRunJobHandlerOptions["runs"];
  private readonly pi: AgentRunJobHandlerOptions["pi"];
  private readonly jobs: AgentRunJobHandlerOptions["jobs"];
  private readonly workerId: string;
  private readonly clock: ClockPort;
  private readonly ids: IdGeneratorPort;
  private readonly activeCatalog: AgentCatalog;
  private readonly leases: AgentRunJobHandlerOptions["leases"];
  private readonly authorization: AgentRunJobHandlerOptions["authorization"];

  constructor(options: AgentRunJobHandlerOptions) {
    this.runs = options.runs;
    this.pi = options.pi;
    this.jobs = options.jobs;
    this.workerId = options.workerId;
    this.clock = options.clock;
    this.ids = options.ids;
    this.activeCatalog = options.activeCatalog;
    this.leases = options.leases;
    this.authorization = options.authorization;
  }
  async process(job: InternalJobV1): Promise<void> {
    if (job.runAuthorization) {
      if (!this.authorization)
        throw new TerminalWorkerError("Run authorization context is unavailable.");
      return this.authorization.run(job.runAuthorization, () => this.processAuthorized(job));
    }
    return this.processAuthorized(job);
  }
  private async processAuthorized(job: InternalJobV1): Promise<void> {
    const runId = requireStringJobPayload(job, "runId");
    const task = requireStringJobPayload(job, "task");
    const run = await this.runs.getRun(runId);
    if (!run) throw new TerminalWorkerError(`Unknown agent run: ${runId}`);
    if (run.status === "completed" || run.status === "cancelled") return this.complete(job);
    if (run.workspaceId !== job.workspaceId) {
      throw new TerminalWorkerError("Agent run job workspace does not match its durable run.");
    }
    let current = run;
    let leaseAcquired = false;
    try {
      const authority = await this.resolveAuthority(run, job);
      const effectiveRunPolicy = selectEffectiveRunPolicy(job.effectiveRunPolicies, {
        workspaceId: run.workspaceId,
        agentId: run.agentId
      });
      if (!effectiveRunPolicy) {
        throw new TerminalWorkerError("Agent run is missing its effective policy snapshot.");
      }
      assertExecutionIdentity(run, job, effectiveRunPolicy);
      current = await this.runs.updateRun({
        ...run,
        status: "running",
        startedAt: this.clock.now().toISOString()
      });
      const needsWriteLease = authority.allowedTools.some(
        (tool) => tool === "workspace_write" || tool === "workspace_edit"
      );
      if (needsWriteLease) {
        if (!this.leases)
          throw new TerminalWorkerError("Workspace writer run requires lease support.");
        await this.leases.acquire({
          workspaceId: run.workspaceId,
          ownerRunId: run.id,
          leaseMs: authority.timeoutSeconds * 1_000
        });
        leaseAcquired = true;
      }
      const request: PiRunRequestV1 = {
        schemaVersion: 1,
        id: run.id,
        catalogDigest: run.catalogDigest,
        workspaceId: run.workspaceId,
        agentId: run.agentId,
        traceId: run.id,
        sessionId: `agent-run-${run.id}`,
        inputText: task,
        images: [],
        sourceReferences: delegatedSourceReferences(run),
        ...(run.noticeOrigin ? { noticeOrigin: run.noticeOrigin } : {}),
        delegatedToolPolicy: authority.allowedTools,
        ...(job.runAuthorization ? { runAuthorization: job.runAuthorization } : {}),
        readablePaths: authority.readablePaths,
        writablePaths: authority.writablePaths,
        timeoutSeconds: authority.timeoutSeconds,
        tokenBudget: authority.tokenBudget,
        priority: "background"
      };
      const result = await this.pi.run({
        ...request,
        effectiveRunPolicy
      });
      await this.runs.updateRun(
        terminal(
          current,
          result.status === "cancelled"
            ? "cancelled"
            : result.status === "completed"
              ? "completed"
              : "failed",
          this.clock.now(),
          result.text
        )
      );
      await this.storeArtifacts(run, result.generatedFiles);
    } catch (error) {
      await this.runs.updateRun(terminal(current, "failed", this.clock.now()));
      throw error;
    } finally {
      if (leaseAcquired && this.leases) {
        await this.leases.release({ workspaceId: run.workspaceId, ownerRunId: run.id });
      }
    }
    await this.complete(job);
  }
  private async resolveAuthority(
    run: AgentRunV1,
    job: InternalJobV1
  ): Promise<{
    allowedTools: string[];
    readablePaths: string[];
    writablePaths: string[];
    timeoutSeconds: number;
    tokenBudget: TokenBudget;
  }> {
    const now = this.clock.now();
    const remainingSeconds = Math.floor(
      (new Date(run.deadlineAt).getTime() - now.getTime()) / 1_000
    );
    if (remainingSeconds <= 0) throw new TerminalWorkerError("Agent run deadline has expired.");
    const definition = this.activeCatalog.require(run.agentId);
    const runtime = this.activeCatalog.runtimeClass(run.agentId);
    const baseTimeout = Math.min(
      run.timeoutSeconds,
      remainingSeconds,
      definition.timeoutSeconds,
      runtime.timeoutSeconds
    );
    if (!run.parentRunId && !run.delegationGrantId) {
      return {
        allowedTools: delegatedTools(job),
        readablePaths: delegatedPaths(job, "readablePaths"),
        writablePaths: delegatedPaths(job, "writablePaths"),
        timeoutSeconds: baseTimeout,
        tokenBudget: minimumTokenBudget(run.tokenBudget, definition.tokenBudget)
      };
    }
    if (!run.parentRunId || !run.delegationGrantId)
      throw new TerminalWorkerError("Delegated run has incomplete parent or grant lineage.");
    if (requireStringJobPayload(job, "parentRunId") !== run.parentRunId)
      throw new TerminalWorkerError(
        "Agent run job parent does not match durable delegation lineage."
      );
    if (requireStringJobPayload(job, "rootRunId") !== run.rootRunId)
      throw new TerminalWorkerError(
        "Agent run job root does not match durable delegation lineage."
      );
    const [parent, grant] = await Promise.all([
      this.runs.getRun(run.parentRunId),
      this.runs.getGrant(run.delegationGrantId)
    ]);
    if (!parent) throw new TerminalWorkerError("Delegation parent run does not exist.");
    if (!grant) throw new TerminalWorkerError("Delegation grant does not exist.");
    validateDelegationLineage(run, parent, grant, now);
    const allowedTools = effectiveDelegatedTools(
      this.activeCatalog,
      parent.agentId,
      run.agentId,
      grant
    );
    if (!sameValues(delegatedTools(job), allowedTools))
      throw new TerminalWorkerError("Agent run job tools do not match its delegation grant.");
    if (!sameValues(delegatedPaths(job, "readablePaths"), grant.readablePaths))
      throw new TerminalWorkerError(
        "Agent run job readable paths do not match its delegation grant."
      );
    if (!sameValues(delegatedPaths(job, "writablePaths"), grant.writablePaths))
      throw new TerminalWorkerError(
        "Agent run job writable paths do not match its delegation grant."
      );
    return {
      allowedTools: [...allowedTools],
      readablePaths: [...grant.readablePaths],
      writablePaths: [...grant.writablePaths],
      timeoutSeconds: Math.min(baseTimeout, grant.timeoutSeconds, parent.timeoutSeconds),
      tokenBudget: minimumTokenBudget(run.tokenBudget, grant.tokenBudget, definition.tokenBudget)
    };
  }
  private complete(job: InternalJobV1): Promise<void> {
    return this.jobs.complete({ jobId: job.id, leaseOwner: this.workerId });
  }
  private async storeArtifacts(
    run: AgentRunV1,
    files: Awaited<ReturnType<PiRunnerPort["run"]>>["generatedFiles"]
  ): Promise<void> {
    await Promise.all(
      files.map((file) =>
        this.runs.createArtifact({
          schemaVersion: 1,
          id: this.ids.nextId("agent-artifact"),
          workspaceId: run.workspaceId,
          producingRunId: run.id,
          ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
          agentId: run.agentId,
          catalogVersion: run.catalogVersion,
          catalogDigest: run.catalogDigest,
          kind: "evidence",
          storageKey: file.storageKey,
          sha256: file.sha256,
          createdAt: this.clock.now().toISOString()
        })
      )
    );
  }
}

function delegatedSourceReferences(run: AgentRunV1): PiRunRequestV1["sourceReferences"] {
  if (!run.noticeOrigin) return [];
  return [
    {
      schemaVersion: 1,
      conversationId: run.noticeOrigin.conversationId,
      externalEventId: run.noticeOrigin.replyToExternalEventId,
      attachmentIds: []
    }
  ];
}
