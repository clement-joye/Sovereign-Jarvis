import { describe, expect, it, vi } from "vitest";

import { SingleFlight } from "./single-flight.js";

describe("SingleFlight", () => {
  it("shares active work and starts fresh work after it settles", async () => {
    const singleFlight = new SingleFlight<number>();
    const gate = deferred<number>();
    const operation = vi.fn(() => gate.promise);

    const first = singleFlight.run(operation);
    const second = singleFlight.run(operation);

    expect(operation).toHaveBeenCalledTimes(1);
    gate.resolve(1);
    await expect(Promise.all([first, second])).resolves.toEqual([1, 1]);

    await expect(singleFlight.run(async () => 2)).resolves.toBe(2);
  });

  it("allows a retry after a failed operation", async () => {
    const singleFlight = new SingleFlight<void>();

    await expect(singleFlight.run(async () => Promise.reject(new Error("failed")))).rejects.toThrow(
      "failed"
    );
    await expect(singleFlight.run(async () => undefined)).resolves.toBeUndefined();
  });

  it("waits for active work to settle without surfacing its failure", async () => {
    const singleFlight = new SingleFlight<void>();
    const gate = deferred<void>();
    const active = singleFlight.run(() => gate.promise);
    const idle = singleFlight.waitForIdle();

    gate.resolve(undefined);
    await expect(idle).resolves.toBe(true);
    await expect(active).resolves.toBeUndefined();

    await singleFlight.run(async () => Promise.reject(new Error("failed"))).catch(() => undefined);
    await expect(singleFlight.waitForIdle()).resolves.toBe(true);
  });

  it("reports a bounded drain timeout without cancelling active work", async () => {
    const singleFlight = new SingleFlight<void>();
    const gate = deferred<void>();
    const active = singleFlight.run(() => gate.promise);

    await expect(singleFlight.waitForIdle(1)).resolves.toBe(false);
    gate.resolve(undefined);
    await expect(active).resolves.toBeUndefined();
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolveDeferred!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolveDeferred = resolve;
  });
  return { promise, resolve: resolveDeferred };
}
