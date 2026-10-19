import type {
  InternalJobV1,
  PiRunResultV1,
  ScheduledExecutionV1,
  ScheduledJobV1
} from "@second-brain/contracts";
import { requireWorkspaceId, type SessionRecord } from "@second-brain/domain";

import type { OutboundJobCompleter } from "../../outbound/outbound-job-completer.js";
import { generatedImages, piResultText } from "../../outbound/pi-result-presentation.js";
import type {
  ExecutionRepositoryPort,
  JobQueuePort,
  PiRunnerPort,
  ScheduleRepositoryPort
} from "../../ports.js";
import type { ScheduleNotificationPolicy } from "../policy/schedule-notification-policy.js";
import { requireScheduleDestination } from "../policy/schedule-destination.js";
import { isScheduledSilenceResponse } from "../policy/schedule-silence-protocol.js";
import type { ScheduleSessionResolver } from "./schedule-session-resolver.js";
import type { ScheduledExecutionLifecycle } from "./scheduled-execution-lifecycle.js";
import type { ScheduledPiRequestFactory } from "./scheduled-pi-request-factory.js";
import { TerminalWorkerError } from "../../workers/worker-errors.js";
import { requireStringJobPayload } from "../../workers/worker-job-input.js";
import { selectEffectiveRunPolicy } from "../../policy/effective-run-policy-selector.js";

export interface ScheduleJobHandlerOptions {
  schedules: Pick<ScheduleRepositoryPort, "get">;
  executions: Pick<ExecutionRepositoryPort, "get">;
  sessions: Pick<ScheduleSessionResolver, "resolve">;
  lifecycle: Pick<ScheduledExecutionLifecycle, "start" | "finish" | "skip">;
  requests: Pick<ScheduledPiRequestFactory, "create">;
  pi: Pick<PiRunnerPort, "run">;
  notifications: Pick<ScheduleNotificationPolicy, "shouldNotify">;
  outbounds: Pick<OutboundJobCompleter, "createAndComplete">;
  jobs: Pick<JobQueuePort, "complete">;
  workerId: string;
}

/** Runs a scheduled job from durable lookup through optional outbound notification. */
export class ScheduleJobHandler {
  private readonly options: ScheduleJobHandlerOptions;

  constructor(options: ScheduleJobHandlerOptions) {
    this.options = options;
  }

  async process(job: InternalJobV1): Promise<void> {
    const { schedule, execution } = await this.requireScheduleExecution(job);
    if (isTerminalExecution(execution)) {
      await this.complete(job);
      return;
    }
    if (!schedule.enabled) {
      await this.options.lifecycle.skip(execution);
      await this.complete(job);
      return;
    }

    const session = await this.options.sessions.resolve(schedule);
    const running = await this.options.lifecycle.start(execution, session);
    const result = await this.runPi(job, schedule, execution, session);
    const finalExecution = await this.options.lifecycle.finish(running, result);

    const text = isScheduledSilenceResponse(result)
      ? ""
      : presentScheduledReply(schedule.agentId, piResultText(result));
    const images = generatedImages(result);
    if (!text && images.length === 0) {
      await this.complete(job);
      return;
    }

    if (await this.options.notifications.shouldNotify(schedule, finalExecution)) {
      await this.options.outbounds.createAndComplete(job, {
        idempotencyKey: `run_schedule:${execution.id}:outbound`,
        traceId: result.traceId,
        workspaceId: requireWorkspaceId(schedule.workspaceId, "Scheduled outbound"),
        conversationId: requireScheduleDestination(schedule),
        ...(text ? { text } : {}),
        images,
        ...(schedule.destinationThreadRootExternalEventId
          ? {
              replyToExternalEventId: schedule.destinationThreadRootExternalEventId,
              threadRootExternalEventId: schedule.destinationThreadRootExternalEventId
            }
          : { threadAnchorText: `_scheduled_ — ${schedule.name} · @${schedule.agentId}` })
      });
      return;
    }
    await this.complete(job);
  }

  private async requireScheduleExecution(job: InternalJobV1): Promise<{
    schedule: ScheduledJobV1;
    execution: ScheduledExecutionV1;
  }> {
    const scheduleId = requireStringJobPayload(job, "scheduleId");
    const executionId = requireStringJobPayload(job, "executionId");
    const schedule = await this.options.schedules.get(scheduleId);
    const execution = await this.options.executions.get(executionId);
    if (!schedule) {
      throw new TerminalWorkerError(`Unknown schedule: ${scheduleId}`);
    }
    if (!execution) {
      throw new TerminalWorkerError(`Unknown schedule execution: ${executionId}`);
    }
    return { schedule, execution };
  }

  private runPi(
    job: InternalJobV1,
    schedule: ScheduledJobV1,
    execution: ScheduledExecutionV1,
    session: SessionRecord
  ): Promise<PiRunResultV1> {
    const request = this.options.requests.create(schedule, execution, session);
    const effectiveRunPolicy = selectEffectiveRunPolicy(job.effectiveRunPolicies, request);
    return this.options.pi.run({
      ...request,
      ...(effectiveRunPolicy ? { effectiveRunPolicy } : {}),
      ...(job.runAuthorization ? { id: job.id, runAuthorization: job.runAuthorization } : {})
    });
  }

  private complete(job: InternalJobV1): Promise<void> {
    return this.options.jobs.complete({ jobId: job.id, leaseOwner: this.options.workerId });
  }
}

/** Matrix uses one bot account for all agents, so label scheduled output explicitly. */
function presentScheduledReply(agentId: string, text: string): string {
  return `**@${agentId}**\n\n${text}`;
}

function isTerminalExecution(execution: ScheduledExecutionV1): boolean {
  return (
    execution.status === "succeeded" ||
    execution.status === "failed" ||
    execution.status === "timed_out" ||
    execution.status === "cancelled" ||
    execution.status === "skipped"
  );
}
