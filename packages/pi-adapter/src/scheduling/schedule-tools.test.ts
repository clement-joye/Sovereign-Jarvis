import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ActionProposalPendingV1,
  ScheduleMutationResultV1,
  ScheduledExecutionV1,
  ScheduledJobV1
} from "@second-brain/contracts";

import {
  createScheduleTools,
  HttpScheduleControlClient,
  type ScheduleControlPort,
  type ScheduleToolOptions
} from "./schedule-tools.js";

describe("schedule tools", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the schedule token as a bearer header when one is configured", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([schedule()]));
    vi.stubGlobal("fetch", fetchMock);

    await new HttpScheduleControlClient(
      "http://control.test",
      "shared-secret",
      "workspace-1"
    ).list();

    const call = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(call.headers).toMatchObject({
      authorization: "Bearer shared-secret",
      "x-jarvis-workspace-id": "workspace-1"
    });
  });

  it("omits authentication headers when no token or workspace is provided", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([schedule()]));
    vi.stubGlobal("fetch", fetchMock);

    await new HttpScheduleControlClient("http://control.test").list();

    const call = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(call.headers).toBeUndefined();
  });

  it("validates schedule-list responses from the control plane", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([schedule()])));

    await expect(new HttpScheduleControlClient("http://control.test").list()).resolves.toEqual([
      schedule()
    ]);
  });

  it("rejects malformed schedule-list responses from the control plane", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([{ id: "schedule-1" }]))
    );

    await expect(new HttpScheduleControlClient("http://control.test").list()).rejects.toThrow();
  });

  it("validates schedule mutation responses from the control plane", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(scheduleMutation()))
    );

    await expect(
      new HttpScheduleControlClient("http://control.test").create(
        {
          name: "Morning review",
          instruction: "Review.",
          schedule: { type: "once", runAt: "2026-08-01T09:00:00.000Z" }
        },
        "call-1"
      )
    ).resolves.toEqual(scheduleMutation());
  });

  it("leaves a pending approval to the dedicated system message", async () => {
    const control = new RecordingScheduleControl();
    vi.spyOn(control, "create").mockResolvedValue(pendingApproval());
    const tool = toolNamed(control, "schedule_create");

    const result = await tool.execute(
      "call-1",
      {
        name: "Say Hi Task",
        instruction: "say hi",
        scheduleType: "once",
        runAt: "2026-10-13T08:20:08+00:00"
      },
      new AbortController().signal,
      () => undefined,
      {} as never
    );

    expect(result.content).toEqual([
      {
        type: "text",
        text: "A schedule change was proposed, but no schedule was created yet. Only the owner can approve it through Jarvis's separate approval message; approval is never automatic. Do not retry because schedule_list omits pending proposals. Do not claim the schedule is active or will run."
      }
    ]);
  });

  it("sends the tool call id as the idempotency header for mutations", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(scheduleMutation()));
    vi.stubGlobal("fetch", fetchMock);

    await new HttpScheduleControlClient(
      "http://control.test",
      "shared-secret",
      "workspace-1"
    ).create(
      {
        name: "Morning review",
        instruction: "Review.",
        schedule: { type: "once", runAt: "2026-08-01T09:00:00.000Z" }
      },
      "call-123"
    );

    const call = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(call.headers).toMatchObject({ "x-jarvis-idempotency-key": "call-123" });
    expect(JSON.parse(typeof call.body === "string" ? call.body : "")).toEqual({
      name: "Morning review",
      instruction: "Review.",
      schedule: { type: "once", runAt: "2026-08-01T09:00:00.000Z" }
    });
  });

  it("includes the idempotency header even without other client headers", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(scheduleMutation()));
    vi.stubGlobal("fetch", fetchMock);

    await new HttpScheduleControlClient("http://control.test").create(
      {
        name: "Morning review",
        instruction: "Review.",
        schedule: { type: "once", runAt: "2026-08-01T09:00:00.000Z" }
      },
      "call-123"
    );

    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
      "x-jarvis-idempotency-key": "call-123"
    });
  });

  it("rejects malformed schedule mutation responses from the control plane", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ schedule: schedule() }))
    );

    await expect(
      new HttpScheduleControlClient("http://control.test").create(
        {
          name: "Morning review",
          instruction: "Review.",
          schedule: { type: "once", runAt: "2026-08-01T09:00:00.000Z" }
        },
        "call-1"
      )
    ).rejects.toThrow();
  });

  it("creates a cron schedule using the tool call id as its idempotency key", async () => {
    const control = new RecordingScheduleControl();
    const tool = toolNamed(control, "schedule_create");

    await tool.execute(
      "call-1",
      {
        name: "Morning review",
        instruction: "Summarize my priorities.",
        agentId: "browser",
        scheduleType: "cron",
        cronExpression: "0 9 * * 1-5",
        timezone: "Europe/Stockholm"
      },
      new AbortController().signal,
      () => undefined,
      {} as never
    );

    expect(control.created).toEqual({
      name: "Morning review",
      instruction: "Summarize my priorities.",
      agentId: "browser",
      schedule: { type: "cron", expression: "0 9 * * 1-5", timezone: "Europe/Stockholm" }
    });
  });

  it("targets the originating thread by default and allows a separate thread", async () => {
    const control = new RecordingScheduleControl();
    const tool = toolNamed(control, "schedule_create", {
      destinationConversationId: "!room:example",
      destinationThreadRootExternalEventId: "$current-thread:example"
    });
    const input = {
      name: "Say hi",
      instruction: "say hi",
      scheduleType: "once",
      runAt: "2026-10-14T08:22:43Z"
    };

    await tool.execute("call-1", input, undefined, undefined, {} as never);
    expect(control.created).toMatchObject({
      destinationConversationId: "!room:example",
      destinationThreadRootExternalEventId: "$current-thread:example"
    });

    await tool.execute(
      "call-2",
      { ...input, deliveryThread: "new" },
      undefined,
      undefined,
      {} as never
    );
    expect(control.created).not.toHaveProperty("destinationThreadRootExternalEventId");
  });

  it("does not move an existing schedule to the caller's thread on update", async () => {
    const control = new RecordingScheduleControl();
    const tool = toolNamed(control, "schedule_update", {
      destinationConversationId: "!current-room:example",
      destinationThreadRootExternalEventId: "$current-thread:example"
    });

    await tool.execute(
      "call-1",
      { id: "schedule-1", expectedVersion: 1, name: "Renamed" },
      undefined,
      undefined,
      {} as never
    );

    expect(control.updated).toMatchObject({ name: "Renamed", expectedVersion: 1 });
    expect(control.updated).not.toHaveProperty("destinationConversationId");
    expect(control.updated).not.toHaveProperty("destinationThreadRootExternalEventId");
  });

  it("passes the tool call id to destructive mutations for durable approval", async () => {
    const control = new RecordingScheduleControl();
    const tool = toolNamed(control, "schedule_delete");

    await expect(
      tool.execute(
        "call-1",
        { id: "schedule-1", expectedVersion: 1 },
        new AbortController().signal,
        () => undefined,
        {} as never
      )
    ).resolves.toBeDefined();
    expect(control.deleted).toEqual({
      id: "schedule-1",
      expectedVersion: 1,
      idempotencyKey: "call-1"
    });
  });

  it("defaults recurring schedules to the supplied Matrix profile timezone", async () => {
    const control = new RecordingScheduleControl();
    const tool = toolNamed(control, "schedule_create", { defaultTimezone: "Europe/Stockholm" });

    await tool.execute(
      "call-1",
      {
        name: "Daily review",
        instruction: "Review my priorities.",
        scheduleType: "cron",
        cronExpression: "0 9 * * *"
      },
      new AbortController().signal,
      () => undefined,
      {} as never
    );

    expect(control.created).toMatchObject({
      schedule: { type: "cron", expression: "0 9 * * *", timezone: "Europe/Stockholm" }
    });
  });

  it("requires an explicit timezone when Matrix has no profile timezone", async () => {
    const control = new RecordingScheduleControl();
    const tool = toolNamed(control, "schedule_create");

    await expect(
      tool.execute(
        "call-1",
        {
          name: "Daily review",
          instruction: "Review my priorities.",
          scheduleType: "cron",
          cronExpression: "0 9 * * *"
        },
        new AbortController().signal,
        () => undefined,
        {} as never
      )
    ).rejects.toThrow("timezone is required");
  });

  it("uses the configured user timezone when a recurring schedule omits one", async () => {
    const control = new RecordingScheduleControl();
    const tool = toolNamed(control, "schedule_create", { defaultTimezone: "America/New_York" });

    await tool.execute(
      "call-1",
      {
        name: "Daily review",
        instruction: "Review my priorities.",
        scheduleType: "cron",
        cronExpression: "0 9 * * *"
      },
      new AbortController().signal,
      () => undefined,
      {} as never
    );

    expect(control.created).toMatchObject({
      schedule: { type: "cron", expression: "0 9 * * *", timezone: "America/New_York" }
    });
  });

  it("passes execution policies to the control API", async () => {
    const control = new RecordingScheduleControl();
    const tool = toolNamed(control, "schedule_create");

    await tool.execute(
      "call-1",
      {
        name: "End-of-day review",
        instruction: "Review the day.",
        scheduleType: "cron",
        cronExpression: "30 20 * * 1-5",
        timezone: "Europe/Stockholm",
        sessionPolicy: { type: "fresh" },
        overlapPolicy: "skip",
        missedRunPolicy: "skip",
        timeoutSeconds: 300,
        notificationPolicy: "always"
      },
      new AbortController().signal,
      () => undefined,
      {} as never
    );

    expect(control.created).toMatchObject({
      sessionPolicy: { type: "fresh" },
      overlapPolicy: "skip",
      missedRunPolicy: "skip",
      timeoutSeconds: 300,
      notificationPolicy: "always"
    });
  });
});

function toolNamed(control: ScheduleControlPort, name: string, options: ScheduleToolOptions = {}) {
  const tool = createScheduleTools(control, undefined, options).find(
    (candidate) => candidate.name === name
  );
  if (!tool) throw new Error(`Missing ${name}`);
  return tool;
}

class RecordingScheduleControl implements ScheduleControlPort {
  created: unknown;
  updated: unknown;
  deleted: unknown;

  async list(): Promise<ScheduledJobV1[]> {
    return [];
  }

  async create(input: unknown): Promise<ScheduleMutationResultV1 | ActionProposalPendingV1> {
    this.created = input;
    return scheduleMutation();
  }

  async update(_id: string, input: unknown): Promise<ScheduleMutationResultV1> {
    this.updated = input;
    return scheduleMutation();
  }

  async delete(
    id: string,
    expectedVersion: number,
    idempotencyKey: string
  ): Promise<ScheduledJobV1> {
    this.deleted = { id, expectedVersion, idempotencyKey };
    return schedule();
  }

  async runNow(): Promise<ScheduledExecutionV1> {
    return {
      schemaVersion: 1,
      id: "execution-1",
      scheduleId: "schedule-1",
      scheduledFor: "2026-07-27T09:00:00.000Z",
      status: "queued",
      attempt: 0,
      createdAt: "2026-07-27T09:00:00.000Z"
    };
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function schedule(): ScheduledJobV1 {
  return {
    schemaVersion: 1,
    id: "schedule-1",
    agentId: "brain",
    name: "Morning review",
    instruction: "Summarize priorities.",
    schedule: { type: "cron", expression: "0 9 * * 1-5", timezone: "Europe/Stockholm" },
    enabled: true,
    sessionPolicy: { type: "fresh" },
    notificationPolicy: "on_change",
    overlapPolicy: "skip",
    missedRunPolicy: "skip",
    timeoutSeconds: 300,
    version: 1,
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z"
  };
}

function scheduleMutation(): ScheduleMutationResultV1 {
  return {
    schedule: schedule(),
    preview: { occurrences: ["2026-07-28T09:00:00.000Z"] }
  };
}

function pendingApproval(): ActionProposalPendingV1 {
  return {
    schemaVersion: 1,
    outcome: "pending",
    proposal: {
      schemaVersion: 1,
      id: "proposal-1",
      operationDigest: `sha256:${"a".repeat(64)}`,
      workspaceId: "workspace-1",
      agentId: "scheduler",
      runId: "run-1",
      pluginId: "schedule-control",
      capabilityId: "schedule-mutation",
      operationId: "schedule-create",
      operationVersion: "1.0.0",
      summary: "Create schedule Say Hi Task",
      parameters: {},
      approvalMode: "owner",
      requiredApprover: "owner",
      idempotencyKey: "schedule-1",
      status: "proposed",
      createdAt: "2026-10-13T08:18:32.246Z",
      expiresAt: "2026-10-14T08:18:32.246Z"
    }
  };
}
