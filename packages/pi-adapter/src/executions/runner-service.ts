import type { PiRunnerPort } from "@second-brain/application";
import { structuredError } from "@second-brain/application";
import type { PiRunRequestV1, PiRunResultV1 } from "@second-brain/contracts";

import type { PiModelProvider } from "../providers/model-provider.js";
import type { PiSessionStore } from "../sessions/session-store.js";
import { executeRuntimeAction } from "../runtime/execution/runtime-action-control.js";

interface ActiveRun {
  sessionId: string;
  controller: AbortController;
  cancelled: boolean;
}

export interface PiRunnerServiceOptions {
  sessionStore: PiSessionStore;
  modelProvider: PiModelProvider;
}

export class PiRunnerService implements PiRunnerPort {
  private readonly sessionStore: PiSessionStore;
  private readonly modelProvider: PiModelProvider;
  private readonly sessionQueues = new Map<string, Promise<void>>();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly pendingCancellations = new Set<string>();

  constructor(options: PiRunnerServiceOptions) {
    this.sessionStore = options.sessionStore;
    this.modelProvider = options.modelProvider;
  }

  async createSession(sessionId: string) {
    return this.sessionStore.create(sessionId);
  }

  async resumeSession(sessionId: string) {
    return this.sessionStore.resume(sessionId);
  }

  async closeSession(sessionId: string) {
    return this.sessionStore.close(sessionId);
  }

  async sessionHealth(sessionId: string) {
    return this.sessionStore.health(sessionId);
  }

  async runtimeAction(operationId: string, parameters: Record<string, unknown>) {
    return executeRuntimeAction(operationId, parameters);
  }

  async run(request: PiRunRequestV1): Promise<PiRunResultV1> {
    const active: ActiveRun = {
      sessionId: request.sessionId,
      controller: new AbortController(),
      cancelled: this.pendingCancellations.delete(request.id)
    };
    this.activeRuns.set(request.id, active);
    if (active.cancelled) {
      active.controller.abort();
    }

    const prior = this.sessionQueues.get(request.sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = prior.then(
      () => current,
      () => current
    );
    this.sessionQueues.set(request.sessionId, queued);

    await prior.catch(() => undefined);
    try {
      return await this.executeRun(request, active);
    } finally {
      release();
      this.activeRuns.delete(request.id);
      if (this.sessionQueues.get(request.sessionId) === queued) {
        this.sessionQueues.delete(request.sessionId);
      }
    }
  }

  async cancel(runId: string): Promise<void> {
    const active = this.activeRuns.get(runId);
    if (!active) {
      this.pendingCancellations.add(runId);
      return;
    }
    active.cancelled = true;
    active.controller.abort();
  }

  async cancelSession(sessionId: string): Promise<void> {
    for (const active of this.activeRuns.values()) {
      if (active.sessionId === sessionId) {
        active.cancelled = true;
        active.controller.abort();
      }
    }
  }

  private async executeRun(request: PiRunRequestV1, active: ActiveRun): Promise<PiRunResultV1> {
    const startedAt = new Date().toISOString();
    if (active.cancelled) {
      return this.cancelledResult(request, startedAt);
    }

    const session = await this.sessionStore.resume(request.sessionId);
    const { controller } = active;
    const timeout = setTimeout(() => controller.abort(), request.timeoutSeconds * 1000);

    try {
      const result = await this.modelProvider.run({ request, session, signal: controller.signal });
      if (active.cancelled) {
        return this.cancelledResult(request, startedAt);
      }
      if (controller.signal.aborted) {
        return this.timedOutResult(request, startedAt);
      }
      return result;
    } catch (error) {
      if (active.cancelled) {
        return this.cancelledResult(request, startedAt);
      }
      if (controller.signal.aborted) {
        return this.timedOutResult(request, startedAt);
      }
      return {
        schemaVersion: 1,
        id: request.id,
        traceId: request.traceId,
        sessionId: request.sessionId,
        status: "failed",
        generatedFiles: [],
        error: structuredError({
          code: "pi_runner_error",
          category: "internal",
          message: error instanceof Error ? error.message : "Unknown Pi runner error.",
          retryable: false
        }),
        startedAt,
        finishedAt: new Date().toISOString()
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private cancelledResult(request: PiRunRequestV1, startedAt: string): PiRunResultV1 {
    return {
      schemaVersion: 1,
      id: request.id,
      traceId: request.traceId,
      sessionId: request.sessionId,
      status: "cancelled",
      generatedFiles: [],
      startedAt,
      finishedAt: new Date().toISOString()
    };
  }

  private timedOutResult(request: PiRunRequestV1, startedAt: string): PiRunResultV1 {
    return {
      schemaVersion: 1,
      id: request.id,
      traceId: request.traceId,
      sessionId: request.sessionId,
      status: "timed_out",
      generatedFiles: [],
      error: structuredError({
        code: "pi_run_timed_out",
        category: "timeout",
        message: "Pi run exceeded its configured timeout.",
        retryable: false
      }),
      startedAt,
      finishedAt: new Date().toISOString()
    };
  }
}
