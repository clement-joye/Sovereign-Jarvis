import type { ScheduledJobV1 } from "@second-brain/contracts";
import {
  requireWorkspaceId,
  type ClockPort,
  type IdGeneratorPort,
  type SessionRecord
} from "@second-brain/domain";

import type { SessionRepositoryPort } from "../../ports.js";
import { requireScheduleDestination } from "../policy/schedule-destination.js";

type ScheduleSessionRepository = Pick<
  SessionRepositoryPort,
  "create" | "createAndBind" | "get" | "getActiveBinding" | "touch"
>;

export interface ScheduleSessionResolverOptions {
  sessions: ScheduleSessionRepository;
  ids: IdGeneratorPort;
  clock: ClockPort;
}

export class TerminalScheduleSessionError extends Error {
  readonly retryable = false;
}

/** Resolves the durable session selected by a scheduled job's session policy. */
export class ScheduleSessionResolver {
  constructor(private readonly options: ScheduleSessionResolverOptions) {}

  async resolve(schedule: ScheduledJobV1): Promise<SessionRecord> {
    const workspaceId = requireWorkspaceId(schedule.workspaceId, "Schedule session resolution");
    const conversationId = requireScheduleDestination(schedule);
    const now = this.options.clock.now();
    if (schedule.sessionPolicy.type === "existing") {
      const existing = await this.options.sessions.get(
        schedule.sessionPolicy.sessionId,
        workspaceId
      );
      if (!existing) {
        throw new TerminalScheduleSessionError(
          `Unknown schedule session: ${schedule.sessionPolicy.sessionId}`
        );
      }
      return existing;
    }

    if (schedule.sessionPolicy.type === "dedicated") {
      const dedicated = await this.options.sessions.getActiveBinding({
        workspaceId,
        conversationId,
        scheduleId: schedule.id
      });
      if (dedicated) {
        return this.options.sessions.touch({
          sessionId: dedicated.id,
          workspaceId,
          now
        });
      }
    }

    const session: SessionRecord = {
      id: this.options.ids.nextId("session"),
      workspaceId,
      label: schedule.name,
      status: "active",
      createdAt: now,
      lastActiveAt: now,
      idleExpiresAt: new Date(now.getTime() + 86_400_000),
      absoluteExpiresAt: new Date(now.getTime() + 604_800_000),
      piSessionKey: `${schedule.sessionPolicy.type}:${schedule.id}:${now.toISOString()}`,
      sourceType: "scheduled",
      sourceConversationId: conversationId,
      sourceScheduleId: schedule.id
    };

    if (schedule.sessionPolicy.type === "dedicated") {
      return this.options.sessions.createAndBind({
        session,
        workspaceId,
        conversationId,
        scheduleId: schedule.id
      });
    }
    return this.options.sessions.create(session);
  }
}
