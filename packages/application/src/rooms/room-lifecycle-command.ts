import type { InboundMessageV1, OutboundMessageV1 } from "@second-brain/contracts";
import {
  parseWorkspaceCommand,
  transitionWorkspace,
  type ClockPort,
  type IdGeneratorPort
} from "@second-brain/domain";

import type {
  OutboundRepositoryPort,
  ScheduleRepositoryPort,
  WorkspaceRepositoryPort,
  WorkspaceRuntimePort
} from "../ports.js";

export interface RoomLifecycleCommandOptions {
  workspaces: Pick<WorkspaceRepositoryPort, "get" | "update">;
  outbounds: Pick<OutboundRepositoryPort, "create">;
  ids: IdGeneratorPort;
  clock: ClockPort;
  runtime?: Pick<WorkspaceRuntimePort, "health" | "cancel" | "archive"> | undefined;
  schedules?: Pick<ScheduleRepositoryPort, "disableByWorkspace"> | undefined;
}

/** Handles the small room lifecycle command surface. */
export class RoomLifecycleCommandSubmissionService {
  private readonly workspaces: RoomLifecycleCommandOptions["workspaces"];
  private readonly outbounds: RoomLifecycleCommandOptions["outbounds"];
  private readonly ids: IdGeneratorPort;
  private readonly clock: ClockPort;
  private readonly runtime: RoomLifecycleCommandOptions["runtime"];
  private readonly schedules: RoomLifecycleCommandOptions["schedules"];

  constructor(options: RoomLifecycleCommandOptions) {
    this.workspaces = options.workspaces;
    this.outbounds = options.outbounds;
    this.ids = options.ids;
    this.clock = options.clock;
    this.runtime = options.runtime;
    this.schedules = options.schedules;
  }

  async submit(
    message: InboundMessageV1
  ): Promise<{ handled: boolean; outbound?: OutboundMessageV1 }> {
    if (!message.workspaceId || !message.text) return { handled: false };
    const command = parseWorkspaceCommand(message.text);
    if (command.type === "not-workspace-command") return { handled: false };
    const workspace = await this.workspaces.get(message.workspaceId);
    if (!workspace) throw new Error(`Unknown workspace: ${message.workspaceId}`);

    const text = await this.commandResponse(command.type, workspace);

    const threadRootExternalEventId = message.threadRootExternalEventId ?? message.externalEventId;
    const outbound = await this.outbounds.create({
      schemaVersion: 1,
      id: this.ids.nextId("outbound"),
      traceId: message.traceId,
      workspaceId: message.workspaceId,
      conversationId: message.conversationId,
      text,
      images: [],
      replyToExternalEventId: message.externalEventId,
      threadRootExternalEventId,
      presentation: command.type === "status" || command.type === "archive" ? "notice" : "error",
      urgency: "normal",
      idempotencyKey: `${message.workspaceId}:${message.externalEventId}:workspace-lifecycle`
    });
    return { handled: true, outbound };
  }

  private async commandResponse(
    command: string,
    workspace: NonNullable<Awaited<ReturnType<RoomLifecycleCommandOptions["workspaces"]["get"]>>>
  ): Promise<string> {
    if (command === "status") {
      const health = this.runtime ? await this.runtime.health(workspace.id) : undefined;
      return `Status: ${workspace.status} · runtime: ${health ?? "not managed"}.`;
    }
    if (command !== "archive") return "Use `/workspace status` or `/workspace archive`.";
    if (workspace.status === "archived") return "Already archived.";
    return this.archiveWorkspace(workspace);
  }

  private async archiveWorkspace(
    workspace: NonNullable<Awaited<ReturnType<RoomLifecycleCommandOptions["workspaces"]["get"]>>>
  ): Promise<string> {
    const disabledSchedules = this.schedules?.disableByWorkspace
      ? await this.schedules.disableByWorkspace({
          workspaceId: workspace.id,
          now: this.clock.now()
        })
      : 0;
    if (this.runtime) {
      await this.runtime.cancel(workspace.id);
      await this.runtime.archive(workspace.id);
    }
    await this.workspaces.update(transitionWorkspace(workspace, "archived", this.clock.now()));
    const suffix =
      disabledSchedules === 0
        ? ""
        : ` Disabled ${disabledSchedules} schedule${disabledSchedules === 1 ? "" : "s"}.`;
    return `Archived.${suffix}`;
  }
}
