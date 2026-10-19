import type { PiRunRequestV1, ScheduledExecutionV1, ScheduledJobV1 } from "@second-brain/contracts";
import {
  requireWorkspaceId,
  type AgentCatalog,
  type IdGeneratorPort,
  type SessionRecord
} from "@second-brain/domain";

import { boundedAgentTimeoutSeconds } from "../../agents/catalog/agent-resource-policy.js";
import { requireScheduleDestination } from "../policy/schedule-destination.js";
import { buildScheduleInputText } from "../policy/schedule-silence-protocol.js";

export interface ScheduledPiRequestFactoryOptions {
  ids: IdGeneratorPort;
  agentCatalog: AgentCatalog;
}

/** Builds background Pi requests from a scheduled execution and its resolved session. */
export class ScheduledPiRequestFactory {
  constructor(private readonly options: ScheduledPiRequestFactoryOptions) {}

  create(
    schedule: ScheduledJobV1,
    execution: ScheduledExecutionV1,
    session: SessionRecord
  ): PiRunRequestV1 {
    const inputText = buildScheduleInputText(schedule.instruction);
    return {
      schemaVersion: 1,
      id: this.options.ids.nextId("pi-run"),
      agentId: schedule.agentId,
      workspaceId: requireWorkspaceId(schedule.workspaceId, "Scheduled Pi request"),
      ...(schedule.schedule.type === "cron" ? { userTimezone: schedule.schedule.timezone } : {}),
      traceId: `schedule:${execution.id}`,
      sessionId: session.id,
      inputText,
      images: [],
      attachments: [],
      sourceReferences: [
        {
          schemaVersion: 1,
          conversationId: requireScheduleDestination(schedule),
          textExcerpt: schedule.instruction.slice(0, 500),
          attachmentIds: []
        }
      ],
      timeoutSeconds: boundedAgentTimeoutSeconds(
        this.options.agentCatalog,
        schedule.agentId,
        schedule.timeoutSeconds
      ),
      priority: "background"
    };
  }
}
