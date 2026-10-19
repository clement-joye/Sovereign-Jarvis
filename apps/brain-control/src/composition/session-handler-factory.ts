import {
  ConversationSessionHandler,
  ScheduleCommandHandler,
  SessionLifecycleCommandHandler,
  SessionOverviewCommandHandler,
  SessionRecordFactory,
  VoicePreferenceCommandHandler,
  type ConversationPreferencePort,
  type ScheduleRepositoryPort,
  type SessionRepositoryPort
} from "@second-brain/application";
import { type InboundMessageV1 } from "@second-brain/contracts";
import { type ClockPort, type IdGeneratorPort } from "@second-brain/domain";

export interface SessionHandlerFactoryConfig {
  readonly sessionIdleContinuationMs: number;
  readonly sessionRetentionMs: number;
  readonly scheduleDisplayTimezone: string;
}

export interface SessionHandlerFactoryDependencies {
  readonly sessions: SessionRepositoryPort;
  readonly preferences: ConversationPreferencePort | undefined;
  readonly schedules: ScheduleRepositoryPort | undefined;
  readonly clock: ClockPort;
  readonly ids: IdGeneratorPort;
  readonly config: SessionHandlerFactoryConfig;
}

/**
 * Returns the bound handler set that `SessionRoutingService` consumes.
 *
 * The composition root owns the wiring so that `SessionRoutingService`
 * itself stays focused on routing logic. The `bindReplyThread` helper
 * closes the reply-thread side-effect that both the lifecycle and
 * overview handlers need.
 */
export function buildSessionHandlers(deps: SessionHandlerFactoryDependencies) {
  const bindReplyThread = async (message: InboundMessageV1, sessionId: string): Promise<void> => {
    if (message.threadRootExternalEventId) return;
    await deps.sessions.activateBinding({
      sessionId,
      conversationId: message.conversationId,
      threadRootExternalEventId: message.externalEventId
    });
  };

  return {
    voicePreferences: new VoicePreferenceCommandHandler(deps.preferences),
    scheduleCommands: new ScheduleCommandHandler(
      deps.schedules,
      deps.clock,
      deps.config.scheduleDisplayTimezone
    ),
    lifecycleCommands: new SessionLifecycleCommandHandler(
      deps.sessions,
      deps.clock,
      bindReplyThread
    ),
    overviewCommands: new SessionOverviewCommandHandler(
      deps.sessions,
      new SessionRecordFactory(deps.clock, deps.ids, {
        idleContinuationMs: deps.config.sessionIdleContinuationMs,
        retentionMs: deps.config.sessionRetentionMs
      }),
      () => deps.clock.now(),
      bindReplyThread
    ),
    conversations: new ConversationSessionHandler(deps.sessions, deps.clock, deps.ids, {
      idleContinuationMs: deps.config.sessionIdleContinuationMs,
      retentionMs: deps.config.sessionRetentionMs
    })
  };
}
