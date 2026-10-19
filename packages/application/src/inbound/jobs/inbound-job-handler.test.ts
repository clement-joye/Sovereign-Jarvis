import { describe, expect, it, vi } from "vitest";

import {
  exampleInboundMessage,
  type InternalJobV1,
  type PiRunResultV1
} from "@second-brain/contracts";
import { INITIAL_AGENT_CATALOG } from "@second-brain/domain";

import { InboundJobHandler } from "./inbound-job-handler.js";
import { InboundAgentRoutingPolicy } from "../acceptance/inbound-agent-routing-policy.js";
import { InboundJobCompletion } from "./inbound-job-completion.js";
import { InboundMessageResolver } from "../turns/inbound-message-resolver.js";
import { InboundPiTurnRunner } from "../turns/inbound-pi-turn-runner.js";
import { InboundTurnPresenter } from "../turns/inbound-turn-presenter.js";
import { InboundTurnProcessor } from "../turns/inbound-turn-processor.js";
import { TerminalWorkerError } from "../../workers/worker-errors.js";

describe("InboundJobHandler", () => {
  it("completes an already-delivered inbound job without routing or rerunning Pi", async () => {
    const subject = createSubject({ outboundExists: true });

    await subject.handler.process(job());

    expect(subject.jobs.complete).toHaveBeenCalledWith({ jobId: "job-1", leaseOwner: "worker-1" });
    expect(subject.routing.routeInbound).not.toHaveBeenCalled();
    expect(subject.pi.run).not.toHaveBeenCalled();
  });

  it("creates and completes a command response without invoking Pi", async () => {
    const subject = createSubject({
      routingResult: { kind: "command-response", command: "sessions", text: "Recent sessions" }
    });

    await subject.handler.process(job());

    expect(subject.commands.create).toHaveBeenCalledWith(
      exampleInboundMessage,
      "process_inbound:inbound-1:outbound",
      expect.objectContaining({ command: "sessions" })
    );
    expect(subject.outbounds.createAndComplete).toHaveBeenCalledWith(
      job(),
      subject.commandResponse
    );
    expect(subject.pi.run).not.toHaveBeenCalled();
  });

  it("silently completes a cancelled Pi run", async () => {
    const subject = createSubject({ result: result({ status: "cancelled" }) });

    await subject.handler.process(job());

    expect(subject.jobs.complete).toHaveBeenCalledWith({ jobId: "job-1", leaseOwner: "worker-1" });
    expect(subject.responses.create).not.toHaveBeenCalled();
    expect(subject.outbounds.createAndComplete).not.toHaveBeenCalled();
  });

  it("runs and presents only the agent selected by Router", async () => {
    const message = {
      ...exampleInboundMessage,
      agentId: "router",
      text: "Analyze the attached document."
    };
    const subject = createSubject({ message, routerAgentId: "document-analyzer" });

    await subject.handler.process(job());

    expect(subject.routing.routeInbound).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "document-analyzer" })
    );
    expect(subject.requests.create).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "document-analyzer" }),
      "turn-inbound-1",
      "fresh_session_with_thread_history"
    );
    expect(subject.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ agentId: "document-analyzer" })
      })
    );
  });

  it("uses an ephemeral per-message Pi session for the default Brain policy", async () => {
    const subject = createSubject({ message: { ...exampleInboundMessage, agentId: "brain" } });

    await subject.handler.process(job());

    expect(subject.requests.create).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "brain" }),
      "turn-inbound-1",
      "fresh_session_with_thread_history"
    );
  });

  it("applies persistent session and bounded history overrides", async () => {
    const subject = createSubject({
      message: { ...exampleInboundMessage, agentId: "brain" },
      sessionContext: { mode: "persistent", historyLimit: 4 }
    });

    await subject.handler.process(job());

    expect(subject.requests.create).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "brain" }),
      "session-1",
      "reuse_session",
      4
    );
  });

  it("rejects a missing inbound message as terminal", async () => {
    const subject = createSubject({ message: undefined });

    await expect(subject.handler.process(job())).rejects.toEqual(
      new TerminalWorkerError("Unknown inbound message: inbound-1")
    );
  });
});

function createSubject(
  overrides: {
    outboundExists?: boolean;
    message?: typeof exampleInboundMessage | undefined;
    result?: PiRunResultV1;
    routerAgentId?: string;
    sessionContext?: { mode?: "persistent"; historyLimit?: number };
    routingResult?:
      | { kind: "send-to-pi"; resolution: { sessionId: string } }
      | { kind: "command-response"; command: "sessions"; text: string };
  } = {}
) {
  const commandResponse = {
    idempotencyKey: "process_inbound:inbound-1:outbound",
    traceId: exampleInboundMessage.traceId,
    conversationId: exampleInboundMessage.conversationId,
    text: "Active session"
  };
  const response = { ...commandResponse, text: "Pi response" };
  const inboundMessages = {
    get: vi
      .fn()
      .mockResolvedValue("message" in overrides ? overrides.message : exampleInboundMessage)
  };
  const routing = {
    routeInbound: vi
      .fn()
      .mockResolvedValue(
        overrides.routingResult ?? { kind: "send-to-pi", resolution: { sessionId: "session-1" } }
      )
  };
  const pi = { run: vi.fn().mockResolvedValue(overrides.result ?? result()) };
  const requests = { create: vi.fn().mockResolvedValue({ id: "run-1" }) };
  const responses = { create: vi.fn().mockResolvedValue(response) };
  const commands = { create: vi.fn().mockResolvedValue(commandResponse) };
  const outbounds = {
    outboundExists: vi.fn().mockResolvedValue(overrides.outboundExists ?? false),
    createAndComplete: vi.fn().mockResolvedValue(undefined)
  };
  const jobs = { complete: vi.fn().mockResolvedValue(undefined) };
  const router = overrides.routerAgentId
    ? { route: vi.fn().mockReturnValue({ primaryAgentId: overrides.routerAgentId }) }
    : undefined;

  return {
    handler: new InboundJobHandler(
      new InboundMessageResolver(inboundMessages),
      new InboundTurnProcessor(
        routing,
        new InboundAgentRoutingPolicy(INITIAL_AGENT_CATALOG, router),
        new InboundPiTurnRunner(pi, requests),
        {
          presenter: new InboundTurnPresenter(commands, responses),
          preferences: {
            getSessionContext: vi.fn().mockResolvedValue(overrides.sessionContext ?? {})
          }
        }
      ),
      new InboundJobCompletion(outbounds, jobs, "worker-1")
    ),
    inboundMessages,
    routing,
    pi,
    requests,
    responses,
    commands,
    outbounds,
    jobs,
    commandResponse
  };
}

function job(): InternalJobV1 {
  return {
    schemaVersion: 1,
    id: "job-1",
    type: "process_inbound",
    payload: { inboundMessageId: "inbound-1" },
    priority: 100,
    status: "leased",
    attempts: 0,
    availableAt: "2026-07-27T10:00:00.000Z",
    idempotencyKey: "job-1"
  };
}

function result(overrides: Partial<PiRunResultV1> = {}): PiRunResultV1 {
  return {
    schemaVersion: 1,
    id: "run-1",
    traceId: "trace-1",
    sessionId: "session-1",
    status: "completed",
    generatedFiles: [],
    startedAt: "2026-07-27T10:00:00.000Z",
    finishedAt: "2026-07-27T10:00:01.000Z",
    ...overrides
  };
}
