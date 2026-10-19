import type {
  ActionProposalService,
  AgentCollaborationRepositoryPort,
  InboundMessageRepositoryPort,
  OutboundRepositoryPort,
  ScheduleRepositoryPort
} from "@second-brain/application";
import { OutboundResponseFactory } from "@second-brain/application";
import type { ActionProposalV1, InternalJobV1 } from "@second-brain/contracts";
import type { IdGeneratorPort } from "@second-brain/domain";

import type { InspectableJobQueue } from "../routes/job-routes.js";

const MAX_RUN_ANCESTORS = 32;

export interface ApprovalPromptPublisherOptions {
  jobs: Pick<InspectableJobQueue, "snapshot">;
  inbound: Pick<InboundMessageRepositoryPort, "get">;
  outbounds: OutboundRepositoryPort;
  ids: IdGeneratorPort;
  proposals: Pick<ActionProposalService, "bindPrompt">;
  schedules?: Pick<ScheduleRepositoryPort, "get">;
  runs?: Pick<AgentCollaborationRepositoryPort, "getRun">;
}

/** Publishes and durably binds one Matrix prompt for a pending action proposal. */
export class ApprovalPromptPublisher {
  private readonly responses: OutboundResponseFactory;
  private readonly jobs: ApprovalPromptPublisherOptions["jobs"];
  private readonly inbound: ApprovalPromptPublisherOptions["inbound"];
  private readonly proposals: ApprovalPromptPublisherOptions["proposals"];
  private readonly schedules: ApprovalPromptPublisherOptions["schedules"];
  private readonly runs: ApprovalPromptPublisherOptions["runs"];

  constructor(options: ApprovalPromptPublisherOptions) {
    this.jobs = options.jobs;
    this.inbound = options.inbound;
    this.proposals = options.proposals;
    this.schedules = options.schedules;
    this.runs = options.runs;
    this.responses = new OutboundResponseFactory(options.outbounds, options.ids);
  }

  async publish(proposal: ActionProposalV1): Promise<void> {
    const job = await this.originatingJob(proposal.runId);
    const source = await this.matrixOrigin(job, proposal.workspaceId);
    const outbound = await this.responses.getOrBuild({
      idempotencyKey: `action-proposal:${proposal.id}:prompt`,
      traceId: source.traceId,
      conversationId: source.conversationId,
      workspaceId: proposal.workspaceId,
      text: approvalPrompt(proposal),
      ...(source.threadRootExternalEventId
        ? {
            replyToExternalEventId: source.threadRootExternalEventId,
            threadRootExternalEventId: source.threadRootExternalEventId
          }
        : {})
    });
    const created = await this.responses.create(outbound);
    await this.proposals.bindPrompt({
      proposalId: proposal.id,
      workspaceId: proposal.workspaceId,
      outboundMessageId: created.id
    });
  }

  private async matrixOrigin(
    job: InternalJobV1,
    workspaceId: string
  ): Promise<{ traceId: string; conversationId: string; threadRootExternalEventId?: string }> {
    const inboundMessageId = stringField(job.payload, "inboundMessageId");
    if (job.type === "process_inbound" && inboundMessageId) {
      const source = await this.inbound.get(inboundMessageId);
      if (!source || source.workspaceId !== workspaceId) {
        throw new Error("Approval request Matrix origin is unavailable.");
      }
      return {
        traceId: source.traceId,
        conversationId: source.conversationId,
        threadRootExternalEventId: source.threadRootExternalEventId ?? source.externalEventId
      };
    }
    const scheduleId = stringField(job.payload, "scheduleId");
    if (job.type === "run_schedule" && scheduleId && this.schedules) {
      const schedule = await this.schedules.get(scheduleId);
      if (schedule?.workspaceId === workspaceId && schedule.destinationConversationId) {
        return {
          traceId: `schedule:${stringField(job.payload, "executionId") ?? job.id}`,
          conversationId: schedule.destinationConversationId
        };
      }
    }
    throw new Error("Approval request has no originating Matrix destination.");
  }

  private async originatingJob(runId: string): Promise<InternalJobV1> {
    let rootId = runId;
    if (this.runs) {
      for (let depth = 0; depth < MAX_RUN_ANCESTORS; depth += 1) {
        const run = await this.runs.getRun(rootId);
        if (!run?.parentRunId) break;
        rootId = run.parentRunId;
      }
    }
    const jobs = await this.jobs.snapshot();
    const job = jobs.find(({ id }) => id === rootId);
    if (!job) throw new Error("Approval request originating job is unavailable.");
    return job;
  }
}

function approvalPrompt(proposal: ActionProposalV1): string {
  return [
    "**Jarvis · Approval required**",
    "",
    proposal.summary,
    "",
    `@${proposal.agentId} · expires in 24 hours`,
    "Reply to **this message**: `/yes` approve · `/no` reject"
  ].join("\n");
}

function stringField(value: Record<string, unknown>, field: string): string | undefined {
  return typeof value[field] === "string" ? value[field] : undefined;
}
