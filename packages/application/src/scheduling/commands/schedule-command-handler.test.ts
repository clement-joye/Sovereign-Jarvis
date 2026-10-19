import { describe, expect, it, vi } from "vitest";

import { exampleScheduledJob, type ScheduledJobV1 } from "@second-brain/contracts";

import { ScheduleCommandHandler } from "./schedule-command-handler.js";
import type { ScheduleRepositoryPort } from "../../ports.js";

const RECENT_UPDATED_AT = "2026-07-27T09:00:00.000Z";
const STALE_DISABLED_UPDATED_AT = "2026-07-01T00:00:00.000Z";
const FIXED_NOW = new Date("2026-07-27T10:00:00.000Z");
const WORKSPACE_ID = "workspace-example";

describe("ScheduleCommandHandler", () => {
  it("lists schedules in next-run order across both sections", async () => {
    const later = {
      ...exampleScheduledJob,
      id: "schedule-2",
      name: "Later",
      nextRunAt: "2026-07-28T10:00:00.000Z",
      updatedAt: RECENT_UPDATED_AT
    };
    const earlier = {
      ...exampleScheduledJob,
      id: "schedule-1",
      name: "Earlier",
      nextRunAt: "2026-07-27T10:00:00.000Z",
      updatedAt: RECENT_UPDATED_AT
    };
    const schedules = repository([later, earlier]);
    const handler = createHandler(schedules);

    await expect(handler.list(WORKSPACE_ID)).resolves.toMatchObject({
      command: "schedules",
      text: expect.stringMatching(/1\. Earlier[\s\S]*2\. Later/)
    });
  });

  it("limits schedule commands to the current workspace", async () => {
    const currentWorkspace = {
      ...exampleScheduledJob,
      id: "schedule-current",
      name: "Current room schedule",
      workspaceId: "workspace-current",
      nextRunAt: "2026-07-27T10:00:00.000Z"
    };
    const otherWorkspace = {
      ...exampleScheduledJob,
      id: "schedule-other",
      name: "Other room schedule",
      workspaceId: "workspace-other",
      nextRunAt: "2026-07-27T09:00:00.000Z"
    };
    const schedules = repository([currentWorkspace, otherWorkspace]);
    const handler = createHandler(schedules);

    await expect(handler.list("workspace-current")).resolves.toMatchObject({
      text: expect.stringContaining("Current room schedule")
    });
    await expect(handler.list("workspace-current")).resolves.toMatchObject({
      text: expect.not.stringContaining("Other room schedule")
    });
    await expect(handler.describe("2", "workspace-current")).resolves.toMatchObject({
      text: expect.stringContaining("No schedule matches")
    });
    await expect(handler.delete(["2"], "workspace-current")).resolves.toMatchObject({
      text: expect.stringContaining("No schedule matches")
    });
    expect(schedules.hardDeleteDisabledOlderThan).toHaveBeenCalledWith({
      cutoff: expect.any(Date),
      workspaceId: "workspace-current"
    });
    expect(schedules.delete).not.toHaveBeenCalled();
  });

  it("separates enabled and disabled schedules into Active and Disabled sections", async () => {
    const active = {
      ...exampleScheduledJob,
      id: "schedule-active",
      name: "Daily summary",
      enabled: true,
      nextRunAt: "2026-07-27T20:00:00.000Z",
      updatedAt: RECENT_UPDATED_AT
    };
    const disabled = {
      ...exampleScheduledJob,
      id: "schedule-disabled",
      name: "Weekly review",
      enabled: false,
      nextRunAt: "2026-07-30T09:00:00.000Z",
      updatedAt: RECENT_UPDATED_AT
    };
    const schedules = repository([disabled, active]);
    const handler = createHandler(schedules);

    const text = (await handler.list(WORKSPACE_ID)).text;

    expect(text).toContain("Active (1)");
    expect(text).toContain("Disabled (1)");
    expect(text.indexOf("Active (1)")).toBeLessThan(text.indexOf("Disabled (1)"));
    expect(text.indexOf("1. Daily summary")).toBeLessThan(text.indexOf("2. Weekly review"));
    expect(text).toContain("Next run: 2026-07-27 22:00:00 Europe/Stockholm");
    expect(text).toContain("Disabled 2026-07-27 11:00:00 Europe/Stockholm");
    // Both schedules are recent (within the 2-week window) so nothing
    // gets hard-deleted. The disabled schedule was soft-deleted after
    // being shown, so the reply notes that the schedule was marked as seen.
    expect(schedules.delete).toHaveBeenCalledWith({
      id: "schedule-disabled",
      now: FIXED_NOW,
      expectedVersion: disabled.version
    });
    expect(text).toMatch(/1 disabled schedule marked as seen\./);
    expect(text).not.toMatch(/purged/);
  });

  it("hides soft-deleted disabled schedules from the next /schedules call", async () => {
    const disabled = {
      ...exampleScheduledJob,
      id: "schedule-disabled",
      name: "Weekly review",
      enabled: false,
      nextRunAt: "2026-07-30T09:00:00.000Z",
      updatedAt: RECENT_UPDATED_AT
    };
    const schedules = repository([disabled]);
    const handler = createHandler(schedules);

    const firstReply = await handler.list(WORKSPACE_ID);
    expect(firstReply.text).toContain("Disabled (1)");
    expect(firstReply.text).toMatch(/1 disabled schedule marked as seen\./);

    // The disabled schedule was soft-deleted on the first call, so the
    // second call should show no schedules at all.
    const secondReply = await handler.list(WORKSPACE_ID);
    expect(secondReply.text).toBe("No scheduled jobs");
    expect(secondReply.text).not.toMatch(/marked as seen/);
    expect(secondReply.text).not.toMatch(/purged/);
  });

  it("hard-deletes disabled schedules older than 2 weeks during /schedules", async () => {
    const stale = {
      ...exampleScheduledJob,
      id: "schedule-stale",
      name: "Old weekly",
      enabled: false,
      nextRunAt: "2026-07-30T09:00:00.000Z",
      updatedAt: STALE_DISABLED_UPDATED_AT
    };
    const fresh = {
      ...exampleScheduledJob,
      id: "schedule-fresh",
      name: "Fresh daily",
      enabled: false,
      nextRunAt: "2026-07-28T10:00:00.000Z",
      updatedAt: RECENT_UPDATED_AT
    };
    const schedules = repository([stale, fresh]);
    const handler = createHandler(schedules);

    const text = (await handler.list(WORKSPACE_ID)).text;

    expect(schedules.hardDeleteDisabledOlderThan).toHaveBeenCalledTimes(1);
    const cutoff = vi.mocked(schedules.hardDeleteDisabledOlderThan).mock.calls[0]?.[0]?.cutoff;
    expect(cutoff).toBeInstanceOf(Date);
    expect(cutoff?.toISOString()).toBe("2026-07-13T10:00:00.000Z");
    expect(text).toContain("Disabled (1)");
    expect(text).toContain("1. Fresh daily");
    expect(text).toMatch(/1 disabled schedule older than 2 weeks removed\./);
  });

  it("keeps the empty-list reply compact when nothing is scheduled", async () => {
    const schedules = repository([]);
    const handler = createHandler(schedules);

    await expect(handler.list(WORKSPACE_ID)).resolves.toMatchObject({
      command: "schedules",
      text: "No scheduled jobs"
    });
  });

  it("reports how many disabled schedules were hard-deleted when nothing remains visible", async () => {
    const stale = {
      ...exampleScheduledJob,
      id: "schedule-stale",
      name: "Old weekly",
      enabled: false,
      nextRunAt: "2026-07-30T09:00:00.000Z",
      updatedAt: STALE_DISABLED_UPDATED_AT
    };
    const schedules = repository([stale]);
    const handler = createHandler(schedules);

    await expect(handler.list(WORKSPACE_ID)).resolves.toMatchObject({
      command: "schedules",
      text: "No scheduled jobs\n\n1 disabled schedule older than 2 weeks removed."
    });
  });

  it("describes schedules using the filtered (visible) list so soft-deleted entries stay unreachable by position", async () => {
    const stale = {
      ...exampleScheduledJob,
      id: "schedule-stale",
      name: "Old weekly",
      enabled: false,
      nextRunAt: "2026-07-30T09:00:00.000Z",
      updatedAt: STALE_DISABLED_UPDATED_AT
    };
    const fresh = {
      ...exampleScheduledJob,
      id: "schedule-fresh",
      name: "Fresh daily",
      enabled: false,
      nextRunAt: "2026-07-28T10:00:00.000Z",
      updatedAt: RECENT_UPDATED_AT
    };
    const schedules = repository([stale, fresh]);
    const handler = createHandler(schedules);

    const reply = await handler.describe("1", WORKSPACE_ID);

    expect(reply).toMatchObject({
      command: "schedule",
      text: expect.stringContaining("Fresh daily")
    });
    expect(schedules.delete).not.toHaveBeenCalled();
  });

  it("requires a numbered selector before describing a schedule", async () => {
    const handler = createHandler(repository([exampleScheduledJob]));

    await expect(handler.describe(undefined)).resolves.toMatchObject({
      command: "schedule",
      text: expect.stringContaining("Provide a schedule number")
    });
  });

  it("queues the selected schedule for an immediate run", async () => {
    const runNow = vi.fn().mockResolvedValue(undefined);
    const handler = new ScheduleCommandHandler(
      repository([exampleScheduledJob]),
      { now: () => FIXED_NOW },
      "Europe/Stockholm",
      runNow
    );

    await expect(handler.run("1", WORKSPACE_ID)).resolves.toMatchObject({
      command: "schedule-run",
      text: expect.stringContaining("Queued")
    });
    expect(runNow).toHaveBeenCalledWith(exampleScheduledJob.id);
  });

  it("deletes the selected schedule using its displayed version", async () => {
    const scheduled = {
      ...exampleScheduledJob,
      nextRunAt: "2026-07-27T10:00:00.000Z",
      version: 3,
      updatedAt: RECENT_UPDATED_AT
    };
    const schedules = repository([scheduled]);
    const handler = createHandler(schedules);

    await expect(handler.delete(["1"], WORKSPACE_ID)).resolves.toMatchObject({
      command: "schedule-delete",
      text: expect.stringContaining(scheduled.name)
    });
    expect(schedules.delete).toHaveBeenCalledWith({
      id: scheduled.id,
      now: FIXED_NOW,
      expectedVersion: 3
    });
  });

  it("deletes several schedules selected from one stable /schedules list", async () => {
    const first = {
      ...exampleScheduledJob,
      id: "schedule-1",
      name: "First",
      nextRunAt: "2026-07-27T10:00:00.000Z",
      updatedAt: RECENT_UPDATED_AT
    };
    const second = {
      ...exampleScheduledJob,
      id: "schedule-2",
      name: "Second",
      nextRunAt: "2026-07-28T10:00:00.000Z",
      updatedAt: RECENT_UPDATED_AT
    };
    const schedules = repository([first, second]);
    const handler = createHandler(schedules);

    await expect(handler.delete(["1", "2"], WORKSPACE_ID)).resolves.toMatchObject({
      command: "schedule-delete",
      text: expect.stringContaining("Deleted 2 schedules")
    });
    expect(schedules.delete).toHaveBeenCalledWith({
      id: "schedule-1",
      now: FIXED_NOW,
      expectedVersion: first.version
    });
    expect(schedules.delete).toHaveBeenCalledWith({
      id: "schedule-2",
      now: FIXED_NOW,
      expectedVersion: second.version
    });
  });
});

function createHandler(schedules: ReturnType<typeof repository>): ScheduleCommandHandler {
  return new ScheduleCommandHandler(schedules, { now: () => FIXED_NOW }, "Europe/Stockholm");
}

function repository(
  jobs: ScheduledJobV1[]
): Pick<ScheduleRepositoryPort, "list" | "delete" | "hardDeleteDisabledOlderThan"> {
  // The mock keeps an internal list so hardDeleteDisabledOlderThan and
  // delete actually remove the affected rows, mirroring the production
  // behavior across both Postgres and the in-memory adapter:
  //   * `list()` filters out soft-deleted rows (deleted_at IS NULL).
  //   * `delete()` flips enabled to false, bumps version, and adds the
  //     id to the soft-deleted set.
  //   * `hardDeleteDisabledOlderThan()` physically removes the row.
  const state = {
    jobs: [...jobs],
    deleted: new Set<string>()
  };
  return {
    list: vi
      .fn<ScheduleRepositoryPort["list"]>()
      .mockImplementation(async () => state.jobs.filter((job) => !state.deleted.has(job.id))),
    delete: vi.fn<ScheduleRepositoryPort["delete"]>().mockImplementation(async (input) => {
      const idx = state.jobs.findIndex((j) => j.id === input.id);
      if (idx < 0) {
        throw new Error(`Unknown schedule: ${input.id}`);
      }
      const existing = state.jobs[idx]!;
      const updated: ScheduledJobV1 = {
        ...existing,
        enabled: false,
        version: existing.version + 1,
        updatedAt: input.now.toISOString()
      };
      state.jobs[idx] = updated;
      state.deleted.add(input.id);
      return updated;
    }),
    hardDeleteDisabledOlderThan: vi
      .fn<ScheduleRepositoryPort["hardDeleteDisabledOlderThan"]>()
      .mockImplementation(async (input) => {
        const cutoff = input.cutoff.getTime();
        if (!input.workspaceId) throw new Error("workspaceId is required");
        const workspaceId = input.workspaceId;
        const before = state.jobs.length;
        state.jobs = state.jobs.filter(
          (job) =>
            job.enabled ||
            job.workspaceId !== workspaceId ||
            new Date(job.updatedAt).getTime() >= cutoff
        );
        // Drop any soft-deleted ids whose row has now been hard-deleted.
        for (const id of [...state.deleted]) {
          if (!state.jobs.some((j) => j.id === id)) {
            state.deleted.delete(id);
          }
        }
        return before - state.jobs.length;
      })
  };
}
