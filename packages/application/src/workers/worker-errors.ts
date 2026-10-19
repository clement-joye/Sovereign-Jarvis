export class TerminalWorkerError extends Error {
  readonly retryable = false;
}

/** The durable lease has already moved on, so this worker must not mutate the job again. */
export class LeaseLostWorkerError extends Error {}
