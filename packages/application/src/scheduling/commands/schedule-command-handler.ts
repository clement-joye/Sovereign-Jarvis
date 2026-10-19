import { requireWorkspaceId, type ClockPort } from "@second-brain/domain";
import type { ScheduledJobV1 } from "@second-brain/contracts";

import type { ScheduleRepositoryPort } from "../../ports.js";
import { numberedListPosition } from "../../shared/numbered-list-position.js";
import {
  formatSchedule,
  formatSchedulePolicy,
  formatScheduleSessionPolicy,
  formatTimestampInTimezone
} from "../presentation/schedule-presentation.js";
import type { SessionRoutingResult } from "../../sessions/routing/session-routing-result.js";

type CommandResponse = Extract<SessionRoutingResult, { kind: "command-response" }>;

/**
 * Disabled scheduled jobs older than this window are hard-deleted
 * by the next `/schedules` invocation if older than 14 days".
 */
const STALE_DISABLED_HARD_DELETE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

/** Handles scheduled-job command queries and mutations for session routing. */
export class ScheduleCommandHandler {
  constructor(
    private readonly schedules:
      | Pick<ScheduleRepositoryPort, "list" | "delete" | "hardDeleteDisabledOlderThan">
      | undefined,
    private readonly clock: ClockPort,
    private readonly displayTimezone: string,
    private runNow?: (scheduleId: string) => Promise<void>
  ) {}

  setRunNow(runNow: (scheduleId: string) => Promise<void>): void {
    this.runNow = runNow;
  }

  async list(workspaceId?: string): Promise<CommandResponse> {
    const schedules = this.requireSchedules();
    const all = this.inWorkspace(await schedules.list(), workspaceId);
    const now = this.clock.now();
    const cutoff = new Date(now.getTime() - STALE_DISABLED_HARD_DELETE_AFTER_MS);
    const hardDeleteIds = new Set(
      all
        .filter((job) => !job.enabled && new Date(job.updatedAt).getTime() < cutoff.getTime())
        .map((job) => job.id)
    );
    const hardDeletedCount = await schedules.hardDeleteDisabledOlderThan({
      cutoff,
      workspaceId: requireWorkspaceId(workspaceId, "Schedule command")
    });
    const remaining = all.filter((job) => !hardDeleteIds.has(job.id));
    const visible = this.filterVisible(remaining);

    const active = visible.filter((job) => job.enabled);
    const visibleDisabled = visible.filter((job) => !job.enabled);
    const softDeletedCount = await this.softDeleteSeen(visibleDisabled, now);

    if (active.length === 0 && visibleDisabled.length === 0) {
      return {
        kind: "command-response",
        command: "schedules",
        text: `No scheduled jobs${this.formatPurgeNote(softDeletedCount, hardDeletedCount)}`
      };
    }

    const lines: string[] = ["Scheduled jobs"];
    if (active.length > 0) {
      lines.push("", `Active (${active.length})`, "");
      active.forEach((job, index) => {
        const position = index + 1;
        lines.push(`${position}. ${job.name} · Next run: ${this.formatNextRun(job.nextRunAt)}`, "");
      });
    }
    if (visibleDisabled.length > 0) {
      lines.push("", `Disabled (${visibleDisabled.length})`, "");
      visibleDisabled.forEach((job, index) => {
        const position = active.length + index + 1;
        lines.push(
          `${position}. ${job.name} · Disabled ${this.formatTimestamp(new Date(job.updatedAt))}`,
          ""
        );
      });
    }
    const note = this.formatPurgeNote(softDeletedCount, hardDeletedCount);
    if (note) {
      lines.push("", note.trim());
    }

    return {
      kind: "command-response",
      command: "schedules",
      text: lines.join("\n")
    };
  }

  async describe(selector: string | undefined, workspaceId?: string): Promise<CommandResponse> {
    const position = selector ? numberedListPosition(selector) : undefined;
    if (position === undefined) {
      return {
        kind: "command-response",
        command: "schedule",
        presentation: "error",
        text: "Provide a schedule number. Use `/schedules`, then `/schedule <number>`."
      };
    }
    const job = (await this.visibleSchedules(workspaceId))[position - 1];
    if (!job) {
      return {
        kind: "command-response",
        command: "schedule",
        presentation: "error",
        text: `No schedule matches number ${position}.`
      };
    }
    return {
      kind: "command-response",
      command: "schedule",
      text: [
        job.name,
        "",
        `Status: ${job.enabled ? "Active" : "Disabled"}`,
        "",
        "When",
        `Schedule: ${formatSchedule(job.schedule, this.displayTimezone)}`,
        `Next run: ${job.nextRunAt ? this.formatTimestamp(new Date(job.nextRunAt)) : "None"}`,
        `Last run: ${job.lastRunAt ? this.formatTimestamp(new Date(job.lastRunAt)) : "Never"}`,
        "",
        "Behavior",
        `Session: ${formatScheduleSessionPolicy(job.sessionPolicy)}`,
        `Notifications: ${formatSchedulePolicy(job.notificationPolicy)}`,
        `Instruction: ${job.instruction}`
      ].join("\n")
    };
  }

  async delete(selectors: string[] | undefined, workspaceId?: string): Promise<CommandResponse> {
    const positions = selectors ? [...new Set(selectors.map(numberedListPosition))] : [];
    if (positions.length === 0 || positions.some((position) => position === undefined)) {
      return {
        kind: "command-response",
        command: "schedule-delete",
        presentation: "error",
        text: "Provide one or more schedule numbers. Use `/schedules`, then `/schedule delete <number> [number ...]`."
      };
    }
    const schedules = this.requireSchedules();
    const visible = await this.visibleSchedules(workspaceId);
    const selected = positions.map((position) => visible[position! - 1]);
    const missing = positions.filter((position, index) => !selected[index]);
    if (missing.length > 0) {
      return {
        kind: "command-response",
        command: "schedule-delete",
        presentation: "error",
        text: `No schedule matches number${missing.length === 1 ? "" : "s"} ${missing.join(", ")}.`
      };
    }
    const deleted = await Promise.all(
      selected.map((job) =>
        schedules.delete({ id: job!.id, now: this.clock.now(), expectedVersion: job!.version })
      )
    );
    return {
      kind: "command-response",
      command: "schedule-delete",
      text:
        deleted.length === 1
          ? `Deleted ${deleted[0]!.name}. It will not run again.`
          : [
              `Deleted ${deleted.length} schedules`,
              "",
              ...deleted.map((job) => `• ${job.name}`)
            ].join("\n")
    };
  }

  async run(selector: string | undefined, workspaceId?: string): Promise<CommandResponse> {
    const position = selector ? numberedListPosition(selector) : undefined;
    if (position === undefined) {
      return {
        kind: "command-response",
        command: "schedule-run",
        presentation: "error",
        text: "Provide a schedule number. Use `/schedules`, then `/schedule <number> run`."
      };
    }
    const job = (await this.visibleSchedules(workspaceId))[position - 1];
    if (!job) {
      return {
        kind: "command-response",
        command: "schedule-run",
        presentation: "error",
        text: `No schedule matches number ${position}.`
      };
    }
    if (!this.runNow) throw new Error("Manual schedule runs are unavailable.");
    await this.runNow(job.id);
    return {
      kind: "command-response",
      command: "schedule-run",
      text: `Queued ${job.name} to run shortly.`
    };
  }

  private async visibleSchedules(workspaceId?: string): Promise<ScheduledJobV1[]> {
    return this.filterVisible(this.inWorkspace(await this.requireSchedules().list(), workspaceId));
  }

  private inWorkspace(all: ScheduledJobV1[], workspaceId: string | undefined): ScheduledJobV1[] {
    const scope = requireWorkspaceId(workspaceId, "Schedule command");
    return all.filter((job) => requireWorkspaceId(job.workspaceId, "Persisted schedule") === scope);
  }

  private filterVisible(all: ScheduledJobV1[]): ScheduledJobV1[] {
    return [...all].sort((left, right) => {
      const leftNext = left.nextRunAt ?? "9999-12-31T23:59:59.999Z";
      const rightNext = right.nextRunAt ?? "9999-12-31T23:59:59.999Z";
      return leftNext.localeCompare(rightNext) || left.name.localeCompare(right.name);
    });
  }

  private async softDeleteSeen(jobs: ScheduledJobV1[], now: Date): Promise<number> {
    if (jobs.length === 0) return 0;
    const schedules = this.requireSchedules();
    let count = 0;
    for (const job of jobs) {
      try {
        await schedules.delete({ id: job.id, now, expectedVersion: job.version });
        count += 1;
      } catch {
        // Best-effort; skip rows that another process modified.
      }
    }
    return count;
  }

  private formatPurgeNote(softDeletedCount: number, hardDeletedCount: number): string {
    const parts: string[] = [];
    if (softDeletedCount > 0) {
      parts.push(
        `${softDeletedCount} disabled schedule${softDeletedCount === 1 ? "" : "s"} marked as seen.`
      );
    }
    if (hardDeletedCount > 0) {
      parts.push(
        `${hardDeletedCount} disabled schedule${hardDeletedCount === 1 ? "" : "s"} older than 2 weeks removed.`
      );
    }
    return parts.length === 0 ? "" : "\n\n" + parts.join("\n");
  }

  private requireSchedules(): Pick<
    ScheduleRepositoryPort,
    "list" | "delete" | "hardDeleteDisabledOlderThan"
  > {
    if (!this.schedules) throw new Error("Schedule commands are not configured.");
    return this.schedules;
  }

  private formatTimestamp(timestamp: Date): string {
    return formatTimestampInTimezone(timestamp, this.displayTimezone);
  }

  private formatNextRun(nextRunAt: string | undefined): string {
    return nextRunAt ? this.formatTimestamp(new Date(nextRunAt)) : "No future run";
  }
}
