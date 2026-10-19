import type { PiRunResultV1, ScheduledExecutionV1 } from "@second-brain/contracts";
import type { ClockPort, SessionRecord } from "@second-brain/domain";

import type { ExecutionRepositoryPort } from "../../ports.js";

type ScheduledExecutionStore = Pick<ExecutionRepositoryPort, "update">;

export interface ScheduledExecutionLifecycleOptions {
  executions: ScheduledExecutionStore;
  clock: ClockPort;
}

/** Applies durable state transitions around a scheduled Pi execution. */
export class ScheduledExecutionLifecycle {
  constructor(private readonly options: ScheduledExecutionLifecycleOptions) {}

  start(execution: ScheduledExecutionV1, session: SessionRecord): Promise<ScheduledExecutionV1> {
    return this.options.executions.update({
      ...execution,
      status: "running",
      attempt: execution.attempt + 1,
      sessionId: session.id,
      startedAt: this.options.clock.now().toISOString()
    });
  }

  finish(running: ScheduledExecutionV1, result: PiRunResultV1): Promise<ScheduledExecutionV1> {
    const fingerprint = result.text ? stableFingerprint(result.text) : undefined;
    return this.options.executions.update({
      ...running,
      status: result.status === "completed" ? "succeeded" : result.status,
      ...(fingerprint ? { resultFingerprint: fingerprint } : {}),
      ...(result.error ? { error: result.error } : {}),
      finishedAt: this.options.clock.now().toISOString()
    });
  }

  skip(execution: ScheduledExecutionV1): Promise<ScheduledExecutionV1> {
    return this.options.executions.update({
      ...execution,
      status: "skipped",
      finishedAt: this.options.clock.now().toISOString()
    });
  }
}

function stableFingerprint(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
