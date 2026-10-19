import { describe, expect, it } from "vitest";

import { createWorkerInstanceId } from "./worker-identity.js";

describe("worker instance identity", () => {
  it("keeps the service role while assigning a unique lease owner per process", () => {
    const ids = ["instance-one", "instance-two"];
    const createUniqueId = (): string => ids.shift()!;

    expect(createWorkerInstanceId("brain-delegation-worker", createUniqueId)).toBe(
      "brain-delegation-worker-instance-one"
    );
    expect(createWorkerInstanceId("brain-delegation-worker", createUniqueId)).toBe(
      "brain-delegation-worker-instance-two"
    );
  });
});
