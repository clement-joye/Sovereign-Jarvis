import { AgentRunJobHandler } from "../agents/runs/agent-run-job-handler.js";
import { CatalogDigestPiRunner } from "../agents/runs/catalog-digest-pi-runner.js";
import { DurableAgentRunPiRunner } from "../agents/runs/durable-agent-run-pi-runner.js";
import { RootAgentRunLifecycle } from "../agents/runs/root-agent-run-lifecycle.js";
import { InboundAgentRoutingPolicy } from "../inbound/acceptance/inbound-agent-routing-policy.js";
import { InboundCommandResponseHandler } from "../inbound/commands/inbound-command-response-handler.js";
import { InboundJobCompletion } from "../inbound/jobs/inbound-job-completion.js";
import { InboundJobHandler } from "../inbound/jobs/inbound-job-handler.js";
import { InboundMessageResolver } from "../inbound/turns/inbound-message-resolver.js";
import { InboundPiRequestFactory } from "../inbound/turns/inbound-pi-request-factory.js";
import { InboundPiResponseFactory } from "../inbound/turns/inbound-pi-response-factory.js";
import { InboundPiTurnRunner } from "../inbound/turns/inbound-pi-turn-runner.js";
import { InboundTurnPresenter } from "../inbound/turns/inbound-turn-presenter.js";
import { InboundTurnProcessor } from "../inbound/turns/inbound-turn-processor.js";
import { OutboundJobCompleter } from "../outbound/outbound-job-completer.js";
import { OutboundResponseFactory } from "../outbound/outbound-response-factory.js";
import { RouterService } from "../agents/catalog/router-service.js";
import { ScheduleJobHandler } from "../scheduling/execution/schedule-job-handler.js";
import { ScheduleNotificationPolicy } from "../scheduling/policy/schedule-notification-policy.js";
import { ScheduleSessionResolver } from "../scheduling/execution/schedule-session-resolver.js";
import { ScheduledExecutionLifecycle } from "../scheduling/execution/scheduled-execution-lifecycle.js";
import { ScheduledPiRequestFactory } from "../scheduling/execution/scheduled-pi-request-factory.js";
import type { WorkerOrchestrationOptions } from "./worker-orchestration-options.js";

export interface WorkerJobHandlers {
  inbound: InboundJobHandler;
  schedules: ScheduleJobHandler;
  agentRuns: AgentRunJobHandler | undefined;
}

export function createWorkerJobHandlers(options: WorkerOrchestrationOptions): WorkerJobHandlers {
  const pi = createAttributedPiRunner(options);
  const outbounds = new OutboundJobCompleter(
    new OutboundResponseFactory(options.outbounds, options.ids),
    options.jobs,
    options.config.workerId,
    options.outboundCompletions
  );
  return {
    inbound: createInboundHandler(options, pi, outbounds),
    schedules: createScheduleHandler(options, pi, outbounds),
    agentRuns: createAgentRunHandler(options, pi)
  };
}

function createAttributedPiRunner(options: WorkerOrchestrationOptions) {
  const durablePi =
    options.collaboration && options.runAuthorization
      ? new DurableAgentRunPiRunner(
          options.pi,
          new RootAgentRunLifecycle(options.collaboration, options.activeCatalog, options.clock),
          options.runAuthorization
        )
      : options.pi;
  return new CatalogDigestPiRunner(durablePi, { catalogDigest: options.activeCatalog.digest });
}

function createInboundHandler(
  options: WorkerOrchestrationOptions,
  pi: CatalogDigestPiRunner,
  outbounds: OutboundJobCompleter
): InboundJobHandler {
  const requests = new InboundPiRequestFactory({
    media: options.media,
    transcriptStore: options.inboundMessages,
    ids: options.ids,
    agentCatalog: options.activeCatalog,
    timeoutSeconds: options.config.piTimeoutSeconds,
    ...(options.inboundMessages.listThreadHistory
      ? {
          threadHistory: {
            listThreadHistory: options.inboundMessages.listThreadHistory.bind(
              options.inboundMessages
            )
          }
        }
      : {})
  });
  const presenter = new InboundTurnPresenter(
    new InboundCommandResponseHandler(),
    new InboundPiResponseFactory(options.media, options.preferences)
  );
  const turns = new InboundTurnProcessor(
    options.sessionRouting,
    new InboundAgentRoutingPolicy(options.activeCatalog, new RouterService(options.activeCatalog)),
    new InboundPiTurnRunner(pi, requests),
    { presenter, ...(options.preferences ? { preferences: options.preferences } : {}) }
  );
  return new InboundJobHandler(
    new InboundMessageResolver(options.inboundMessages),
    turns,
    new InboundJobCompletion(outbounds, options.jobs, options.config.workerId)
  );
}

function createScheduleHandler(
  options: WorkerOrchestrationOptions,
  pi: CatalogDigestPiRunner,
  outbounds: OutboundJobCompleter
): ScheduleJobHandler {
  return new ScheduleJobHandler({
    schedules: options.schedules,
    executions: options.executions,
    sessions: new ScheduleSessionResolver({
      sessions: options.sessions,
      ids: options.ids,
      clock: options.clock
    }),
    lifecycle: new ScheduledExecutionLifecycle({
      executions: options.executions,
      clock: options.clock
    }),
    requests: new ScheduledPiRequestFactory({
      ids: options.ids,
      agentCatalog: options.activeCatalog
    }),
    pi,
    notifications: new ScheduleNotificationPolicy(options.executions),
    outbounds,
    jobs: options.jobs,
    workerId: options.config.workerId
  });
}

function createAgentRunHandler(
  options: WorkerOrchestrationOptions,
  pi: CatalogDigestPiRunner
): AgentRunJobHandler | undefined {
  return options.collaboration
    ? new AgentRunJobHandler({
        runs: options.collaboration,
        pi,
        jobs: options.jobs,
        workerId: options.config.workerId,
        clock: options.clock,
        ids: options.ids,
        activeCatalog: options.activeCatalog,
        leases: options.writeLeases,
        authorization: options.runAuthorization
      })
    : undefined;
}
