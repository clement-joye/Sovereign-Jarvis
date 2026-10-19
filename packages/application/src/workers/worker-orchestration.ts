import type { InternalJobV1 } from "@second-brain/contracts";
import type { ClockPort } from "@second-brain/domain";

import type { JobQueuePort, PiRunnerPort } from "../ports.js";
import type { AgentRunJobHandler } from "../agents/runs/agent-run-job-handler.js";
import { JobFailureHandler } from "./job-failure-handler.js";
import type { InboundJobHandler } from "../inbound/jobs/inbound-job-handler.js";
import { LeaseLostWorkerError, TerminalWorkerError } from "./worker-errors.js";
import type { ScheduleJobHandler } from "../scheduling/execution/schedule-job-handler.js";
import { createWorkerJobHandlers } from "./worker-job-handler-factory.js";
import type {
  WorkerOrchestrationConfig,
  WorkerOrchestrationOptions
} from "./worker-orchestration-options.js";

export type {
  WorkerOrchestrationConfig,
  WorkerOrchestrationOptions
} from "./worker-orchestration-options.js";

export interface WorkerPollResult {
  claimed: number;
  completed: number;
  failed: number;
}

export class WorkerOrchestrationService {
  private readonly jobs: JobQueuePort;
  private readonly failures: JobFailureHandler;
  private readonly inboundJobs: InboundJobHandler;
  private readonly scheduleJobs: ScheduleJobHandler;
  private readonly agentRuns: AgentRunJobHandler | undefined;
  private readonly clock: ClockPort;
  private readonly config: WorkerOrchestrationConfig;
  private readonly onJobFailure: WorkerOrchestrationOptions["onJobFailure"];
  private readonly pi: Pick<PiRunnerPort, "cancel">;
  private readonly inboundMessages: WorkerOrchestrationOptions["inboundMessages"];
  private readonly outbounds: WorkerOrchestrationOptions["outbounds"];
  private readonly collaboration: WorkerOrchestrationOptions["collaboration"];
  private readonly ids: WorkerOrchestrationOptions["ids"];
  private activePoll: Promise<WorkerPollResult> | undefined;

  constructor(options: WorkerOrchestrationOptions) {
    this.jobs = options.jobs;
    this.pi = options.pi;
    this.inboundMessages = options.inboundMessages;
    this.outbounds = options.outbounds;
    this.collaboration = options.collaboration;
    this.ids = options.ids;
    this.failures = new JobFailureHandler(options.jobs, options.clock, options.config);
    const handlers = createWorkerJobHandlers(options);
    this.inboundJobs = handlers.inbound;
    this.scheduleJobs = handlers.schedules;
    this.agentRuns = handlers.agentRuns;
    this.clock = options.clock;
    this.config = options.config;
    this.onJobFailure = options.onJobFailure;
  }

  pollOnce(): Promise<WorkerPollResult> {
    if (this.activePoll) {
      return this.activePoll;
    }
    const activePoll = this.pollClaimedJobs().finally(() => {
      if (this.activePoll === activePoll) {
        this.activePoll = undefined;
      }
    });
    this.activePoll = activePoll;
    return activePoll;
  }

  private async pollClaimedJobs(): Promise<WorkerPollResult> {
    const claimed = await this.jobs.claim({
      workerId: this.config.workerId,
      limit: this.config.claimLimit,
      now: this.clock.now(),
      leaseMs: this.config.leaseMs,
      jobTypes: this.config.jobTypes
    });
    return this.processClaimedJobsSerially(claimed);
  }

  /** Claim batches stay serial per worker; deployment-wide capacity is database-enforced. */
  private async processClaimedJobsSerially(claimed: InternalJobV1[]): Promise<WorkerPollResult> {
    let completed = 0;
    let failed = 0;

    for (const job of claimed) {
      try {
        await this.processClaimedJobWithHeartbeat(job);
        completed += 1;
      } catch (error) {
        failed += 1;
        this.onJobFailure?.({ jobId: job.id, jobType: job.type, error });
        if (!(error instanceof LeaseLostWorkerError)) {
          const failedJob = await this.failures.fail(job, error);
          if (failedJob.status === "dead_letter") await this.createTerminalFailureNotice(job);
        }
      }
    }

    return { claimed: claimed.length, completed, failed };
  }

  private async createTerminalFailureNotice(job: InternalJobV1): Promise<void> {
    if (job.type !== "process_inbound") return;
    const inboundMessageId = job.payload.inboundMessageId;
    if (typeof inboundMessageId !== "string") return;
    const message = await this.inboundMessages.get(inboundMessageId);
    if (!message) return;
    const threadRootExternalEventId = message.threadRootExternalEventId ?? message.externalEventId;
    await this.outbounds.create({
      schemaVersion: 1,
      id: this.ids.nextId("outbound"),
      traceId: message.traceId,
      ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
      conversationId: message.conversationId,
      text: "I couldn’t complete that request. Please try again later.",
      images: [],
      replyToExternalEventId: threadRootExternalEventId,
      threadRootExternalEventId,
      presentation: "error",
      urgency: "normal",
      idempotencyKey: `process_inbound:${message.id}:terminal_failure`
    });
  }

  private async processClaimedJobWithHeartbeat(job: InternalJobV1): Promise<void> {
    if (!this.jobs.renew) return this.processClaimedJob(job);
    const configured = job.payload.admissionHeartbeatMs;
    const configuredAdmissionLease = job.payload.admissionLeaseMs;
    const heartbeatMs =
      typeof configured === "number" && Number.isInteger(configured) && configured > 0
        ? configured
        : Math.max(250, Math.floor(this.config.leaseMs / 3));
    const admissionLeaseMs =
      typeof configuredAdmissionLease === "number" &&
      Number.isInteger(configuredAdmissionLease) &&
      configuredAdmissionLease > 0
        ? configuredAdmissionLease
        : undefined;
    const renewalWindowMs = Math.min(this.config.leaseMs, admissionLeaseMs ?? Infinity);
    let confirmedUntil = Math.min(
      job.leaseExpiresAt ? Date.parse(job.leaseExpiresAt) : Infinity,
      this.clock.now().getTime() + renewalWindowMs
    );
    let heartbeatActive = false;
    let leaseLost = false;
    let stopping = false;
    const loseLease = async (): Promise<void> => {
      if (leaseLost || stopping) return;
      leaseLost = true;
      const runId =
        job.type === "run_agent" && typeof job.payload.runId === "string"
          ? job.payload.runId
          : job.id;
      await this.pi.cancel(runId);
    };
    const heartbeat = async (): Promise<void> => {
      if (heartbeatActive || leaseLost) return;
      heartbeatActive = true;
      try {
        const now = this.clock.now();
        const renewed = await this.jobs.renew!({
          jobId: job.id,
          leaseOwner: this.config.workerId,
          now,
          leaseMs: this.config.leaseMs,
          ...(admissionLeaseMs ? { admissionLeaseMs } : {})
        });
        if (!renewed) await loseLease();
        else confirmedUntil = now.getTime() + renewalWindowMs;
      } catch (error) {
        // A transient control-plane error is retryable only while another full
        // heartbeat attempt still fits inside the last confirmed lease window.
        if (this.clock.now().getTime() + heartbeatMs >= confirmedUntil) await loseLease();
        else throw error;
      } finally {
        heartbeatActive = false;
      }
    };
    const timer = setInterval(() => void heartbeat().catch(() => undefined), heartbeatMs);
    try {
      try {
        await this.processClaimedJob(job);
      } catch (error) {
        if (leaseLost) {
          throw new LeaseLostWorkerError("Job admission lease was lost during execution.");
        }
        throw error;
      }
      if (leaseLost)
        throw new LeaseLostWorkerError("Job admission lease was lost during execution.");
    } finally {
      stopping = true;
      clearInterval(timer);
    }
  }

  async processClaimedJob(job: InternalJobV1): Promise<void> {
    if (job.leaseOwner !== this.config.workerId) {
      throw new Error("Worker cannot process a job leased by another owner.");
    }

    switch (job.type) {
      case "process_inbound":
        await this.inboundJobs.process(job);
        return;
      case "run_schedule":
        await this.scheduleJobs.process(job);
        return;
      case "run_agent":
        if (!this.agentRuns) throw new TerminalWorkerError("Agent collaboration is unavailable.");
        await this.agentRuns.process(job);
        return;
      case "progress_notice":
        await this.processProgressNotice(job);
        return;
      default:
        throw new TerminalWorkerError(`Unsupported worker job type: ${job.type}`);
    }
  }

  private async processProgressNotice(job: InternalJobV1): Promise<void> {
    const rootRunId = job.payload.rootRunId;
    if (typeof rootRunId !== "string" || !this.collaboration) {
      throw new TerminalWorkerError("Progress notice context is unavailable.");
    }
    const run = await this.collaboration.getRun(rootRunId);
    if (
      run &&
      run.id === run.rootRunId &&
      run.workspaceId === job.workspaceId &&
      run.status === "running" &&
      run.noticeOrigin
    ) {
      const origin = run.noticeOrigin;
      const activeChildren = (await this.collaboration.listChildren(run.id)).filter(
        (child) => child.status === "queued" || child.status === "running"
      );
      await this.outbounds.create({
        schemaVersion: 1,
        id: `progress-notice-${run.rootRunId}`,
        traceId: run.rootRunId,
        workspaceId: run.workspaceId,
        conversationId: origin.conversationId,
        text: progressNoticeText(activeChildren.map((child) => child.agentId)),
        images: [],
        replyToExternalEventId: origin.replyToExternalEventId,
        threadRootExternalEventId: origin.threadRootExternalEventId,
        presentation: "notice",
        urgency: "normal",
        idempotencyKey: `progress_notice:${run.workspaceId}:${run.rootRunId}:sent`
      });
    }
    await this.jobs.complete({ jobId: job.id, leaseOwner: this.config.workerId });
  }
}

function progressNoticeText(agentIds: string[]): string {
  if (agentIds.length === 0) return "I’m still working on your request…";
  const labels = agentIds.map(formatAgentLabel);
  if (labels.length === 1 && labels[0]) return `${labels[0]} is still working…`;
  if (labels.length === 2 && labels[0] && labels[1] && labels[0] !== labels[1]) {
    return `${labels[0]} and ${labels[1]} are still working…`;
  }
  return `${agentIds.length} delegated tasks are still running…`;
}

function formatAgentLabel(agentId: string): string {
  return agentId
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export { TerminalWorkerError } from "./worker-errors.js";
