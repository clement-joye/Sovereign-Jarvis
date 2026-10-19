import { beforeEach, describe, expect, it } from "vitest";

import type { OutboundRepositoryPort } from "@second-brain/application";
import type { OutboundMessageV1 } from "@second-brain/contracts";

export interface OutboundRepositoryContractSubject {
  name: string;
  beforeEach?(): Promise<void> | void;
  create(): OutboundRepositoryPort;
}

export function outboundRepositoryContract(subject: OutboundRepositoryContractSubject): void {
  describe(`${subject.name} outbound repository contract`, () => {
    beforeEach(async () => {
      await subject.beforeEach?.();
    });

    it("creates and loads outbound messages idempotently by idempotency key", async () => {
      const repository = subject.create();
      const first = outbound({ id: "outbound-1", idempotencyKey: "same" });
      const second = outbound({ id: "outbound-2", idempotencyKey: "same" });

      await expect(repository.create(first)).resolves.toEqual(first);
      await expect(repository.create(second)).resolves.toEqual(first);
      await expect(repository.get("outbound-1")).resolves.toEqual(first);
      await expect(repository.getByIdempotencyKey("same", "workspace-example")).resolves.toEqual(
        first
      );
    });

    it("keeps matching idempotency keys isolated by workspace", async () => {
      const repository = subject.create();
      const workspaceOne = outbound({
        id: "outbound-workspace-one",
        workspaceId: "workspace-one",
        idempotencyKey: "same"
      });
      const workspaceTwo = outbound({
        id: "outbound-workspace-two",
        workspaceId: "workspace-two",
        idempotencyKey: "same"
      });

      await expect(repository.create(workspaceOne)).resolves.toEqual(workspaceOne);
      await expect(repository.create(workspaceTwo)).resolves.toEqual(workspaceTwo);
      await expect(repository.getByIdempotencyKey("same", "workspace-one")).resolves.toEqual(
        workspaceOne
      );
      await expect(repository.getByIdempotencyKey("same", "workspace-two")).resolves.toEqual(
        workspaceTwo
      );
    });
  });
}

function outbound(overrides: Partial<OutboundMessageV1> = {}): OutboundMessageV1 {
  return {
    schemaVersion: 1,
    id: "outbound-1",
    traceId: "trace-1",
    conversationId: "!room:example",
    text: "Done.",
    images: [],
    presentation: "assistant",
    urgency: "normal",
    idempotencyKey: "outbound:trace-1:done",
    workspaceId: "workspace-example",
    ...overrides
  };
}
