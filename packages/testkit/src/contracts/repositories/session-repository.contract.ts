import { beforeEach, describe, expect, it } from "vitest";

import type { SessionRepositoryPort } from "@second-brain/application";
import type { SessionRecord } from "@second-brain/domain";

export interface SessionRepositoryContractSubject {
  name: string;
  beforeEach?(): Promise<void> | void;
  create(): SessionRepositoryPort;
}

export function sessionRepositoryContract(subject: SessionRepositoryContractSubject): void {
  describe(`${subject.name} session repository contract`, () => {
    beforeEach(async () => {
      await subject.beforeEach?.();
    });

    it("creates and resolves active default, thread, and schedule bindings independently", async () => {
      const repository = subject.create();
      const defaultSession = session({ id: "session-default" });
      const threadSession = session({ id: "session-thread", sourceThreadRootId: "$thread" });
      const scheduleSession = session({
        id: "session-schedule",
        sourceType: "scheduled",
        sourceScheduleId: "schedule-1"
      });

      await repository.createAndBind({
        session: defaultSession,
        workspaceId: "workspace-example",
        conversationId: "!room:example"
      });
      await repository.createAndBind({
        session: threadSession,
        workspaceId: "workspace-example",
        conversationId: "!room:example",
        threadRootExternalEventId: "$thread"
      });
      await repository.createAndBind({
        session: scheduleSession,
        workspaceId: "workspace-example",
        conversationId: "!room:example",
        scheduleId: "schedule-1"
      });

      await expect(
        repository.getActiveBinding({
          workspaceId: "workspace-example",
          conversationId: "!room:example"
        })
      ).resolves.toMatchObject({ id: "session-default" });
      await expect(
        repository.getActiveBinding({
          workspaceId: "workspace-example",
          conversationId: "!room:example",
          threadRootExternalEventId: "$thread"
        })
      ).resolves.toMatchObject({ id: "session-thread" });
      await expect(
        repository.getActiveBinding({
          workspaceId: "workspace-example",
          conversationId: "!room:example",
          scheduleId: "schedule-1"
        })
      ).resolves.toMatchObject({ id: "session-schedule" });
    });

    it("can activate an existing session for a binding and close it later", async () => {
      const repository = subject.create();
      await repository.createAndBind({
        session: session({ id: "session-1" }),
        workspaceId: "workspace-example",
        conversationId: "!room:example"
      });
      await repository.createAndBind({
        session: session({ id: "session-2" }),
        workspaceId: "workspace-example",
        conversationId: "!other:example"
      });

      await expect(
        repository.activateBinding({
          sessionId: "session-2",
          workspaceId: "workspace-example",
          conversationId: "!room:example"
        })
      ).resolves.toMatchObject({ id: "session-2" });
      await expect(
        repository.getActiveBinding({
          workspaceId: "workspace-example",
          conversationId: "!room:example"
        })
      ).resolves.toMatchObject({ id: "session-2" });
      await expect(
        repository.close({
          sessionId: "session-2",
          workspaceId: "workspace-example",
          now: new Date("2026-07-17T16:00:00.000Z")
        })
      ).resolves.toMatchObject({ id: "session-2", status: "closed" });
    });

    it("keeps matching room bindings and recent sessions isolated by workspace", async () => {
      const repository = subject.create();
      const workspaceOne = session({ id: "session-workspace-one", workspaceId: "workspace-one" });
      const workspaceTwo = session({ id: "session-workspace-two", workspaceId: "workspace-two" });

      await repository.createAndBind({
        session: workspaceOne,
        workspaceId: "workspace-one",
        conversationId: "!same-room-shape:example"
      });
      await repository.createAndBind({
        session: workspaceTwo,
        workspaceId: "workspace-two",
        conversationId: "!same-room-shape:example"
      });

      await expect(
        repository.getActiveBinding({
          workspaceId: "workspace-one",
          conversationId: "!same-room-shape:example"
        })
      ).resolves.toMatchObject({ id: "session-workspace-one" });
      await expect(
        repository.getActiveBinding({
          workspaceId: "workspace-two",
          conversationId: "!same-room-shape:example"
        })
      ).resolves.toMatchObject({ id: "session-workspace-two" });
      await expect(
        repository.listRecent({
          workspaceId: "workspace-one",
          now: new Date("2026-07-17T15:00:00.000Z"),
          limit: 10,
          includeClosed: false
        })
      ).resolves.toMatchObject([{ id: "session-workspace-one" }]);
    });
  });
}

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const now = new Date("2026-07-17T15:00:00.000Z");
  return {
    id: "session-1",
    workspaceId: "workspace-example",
    status: "active",
    createdAt: now,
    lastActiveAt: now,
    idleExpiresAt: new Date("2026-07-18T15:00:00.000Z"),
    absoluteExpiresAt: new Date("2026-07-24T15:00:00.000Z"),
    piSessionKey: "pi-session-1",
    sourceType: "default-room",
    sourceConversationId: "!room:example",
    ...overrides
  };
}
