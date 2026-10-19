/** Coalesces concurrent delivery attempts for the same durable runtime run. */
export class ActiveRuntimeRuns<Result> {
  private readonly runs = new Map<string, Promise<Result>>();

  joinOrStart(key: string, start: () => Promise<Result>): Promise<Result> {
    const active = this.runs.get(key);
    if (active) return active;

    const execution = start();
    this.runs.set(key, execution);
    void execution.then(
      () => this.clear(key, execution),
      () => this.clear(key, execution)
    );
    return execution;
  }

  private clear(key: string, execution: Promise<Result>): void {
    if (this.runs.get(key) === execution) this.runs.delete(key);
  }
}
