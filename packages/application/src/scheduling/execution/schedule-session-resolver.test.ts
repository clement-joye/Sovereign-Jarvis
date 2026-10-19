import { describe, expect, it, vi } from "vitest";

import type { ScheduledJobV1 } from "@second-brain/contracts";
import type { SessionRecord } from "@second-brain/domain";

import {
  ScheduleSessionResolver,
  TerminalScheduleSessionError
} from "./schedule-session-resolver.js";

describe("ScheduleSessionResolver", () => {
  it("returns an existing-policy session and rejects an unknown one", async () => {
    const sessions = repository({ get: vi.fn().mockResolvedValue(session("existing-session")) });
    const resolver = createResolver(sessions);

    await expect(
      resolver.resolve(schedule({ type: "existing", sessionId: "existing-session" }))
    ).resolves.toMatchObject({ id: "existing-session" });
    sessions.get.mockResolvedValueOnce(undefined);
    await expect(
      resolver.resolve(schedule({ type: "existing", sessionId: "missing-session" }))
    ).rejects.toBeInstanceOf(TerminalScheduleSessionError);
  });

  it("touches a dedicated binding instead of creating a replacement", async () => {
    const dedicated = session("dedicated-session");
    const sessions = repository({
      getActiveBinding: vi.fn().mockResolvedValue(dedicated),
      touch: vi.fn().mockResolvedValue(dedicated)
    });
    const resolver = createResolver(sessions);

    await expect(resolver.resolve(schedule({ type: "dedicated" }))).resolves.toBe(dedicated);
    expect(sessions.createAndBind).not.toHaveBeenCalled();
  });

  it("creates and binds a new dedicated session", async () => {
    const sessions = repository();
    const resolver = createResolver(sessions);

    const resolved = await resolver.resolve(schedule({ type: "dedicated" }));
    expect(sessions.createAndBind).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "!default:example", scheduleId: "schedule-1" })
    );
    expect(resolved).toMatchObject({ sourceType: "scheduled", sourceScheduleId: "schedule-1" });
  });
});

function createResolver(sessions: ReturnType<typeof repository>): ScheduleSessionResolver {
  return new ScheduleSessionResolver({
    sessions,
    ids: { nextId: () => "session-new" },
    clock: { now: () => new Date("2026-01-01T00:00:00.000Z") }
  });
}

function repository(overrides: Record<string, unknown> = {}) {
  const create = vi.fn(async (value: SessionRecord) => value);
  const createAndBind = vi.fn(async ({ session: value }: { session: SessionRecord }) => value);
  return {
    create,
    createAndBind,
    get: vi.fn(),
    getActiveBinding: vi.fn(),
    touch: vi.fn(),
    ...overrides
  };
}

function schedule(sessionPolicy: ScheduledJobV1["sessionPolicy"]): ScheduledJobV1 {
  return {
    schemaVersion: 1,
    id: "schedule-1",
    workspaceId: "workspace-example",
    agentId: "brain",
    name: "Daily summary",
    instruction: "Summarize the day.",
    destinationConversationId: "!default:example",
    schedule: { type: "cron", expression: "0 9 * * *", timezone: "Europe/Stockholm" },
    enabled: true,
    timeoutSeconds: 60,
    sessionPolicy,
    notificationPolicy: "always",
    overlapPolicy: "skip",
    missedRunPolicy: "skip",
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function session(id: string): SessionRecord {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id,
    workspaceId: "workspace-example",
    label: "Schedule",
    status: "active",
    createdAt: now,
    lastActiveAt: now,
    idleExpiresAt: now,
    absoluteExpiresAt: now,
    piSessionKey: id,
    sourceType: "scheduled",
    sourceConversationId: "!default:example",
    sourceScheduleId: "schedule-1"
  };
}
