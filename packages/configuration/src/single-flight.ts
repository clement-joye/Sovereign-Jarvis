/** Ensures concurrent triggers share a single asynchronous operation. */
export class SingleFlight<T> {
  private active: Promise<T> | undefined;

  run(operation: () => Promise<T>): Promise<T> {
    if (this.active) {
      return this.active;
    }
    const active = operation().finally(() => {
      if (this.active === active) {
        this.active = undefined;
      }
    });
    this.active = active;
    return active;
  }

  /** Waits for active work to settle without propagating its result or failure. */
  async waitForIdle(timeoutMs?: number): Promise<boolean> {
    const active = this.active?.then(
      () => undefined,
      () => undefined
    );
    if (!active) return true;
    if (timeoutMs === undefined) {
      await active;
      return true;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), timeoutMs);
      void active.then(() => {
        clearTimeout(timeout);
        resolve(true);
      });
    });
  }
}
