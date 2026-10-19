import type { PiRunRequestV1, PiRunResultV1 } from "@second-brain/contracts";

import type { PiRunnerPort, WorkspaceRuntimePort } from "../../ports.js";

/**
 * Routes every room-scoped run, including the seeded default workspace, through
 * its reviewed shared runtime.
 */
export class WorkspaceScopedPiRunner implements PiRunnerPort {
  private readonly workspaceRuns = new Map<string, string>();
  private readonly workspaceSessions = new Map<string, Map<string, number>>();

  constructor(
    private readonly workspaceRuntime?: Pick<WorkspaceRuntimePort, "provision" | "run" | "cancel">,
    private readonly roomRuntimeTemplate?: { id: string; version: string }
  ) {}

  async run(request: PiRunRequestV1): Promise<PiRunResultV1> {
    if (!request.workspaceId) return unavailableRoomWorkspaceResult(request);
    const { workspaceId, ...workspaceRequest } = request;
    if (!this.workspaceRuntime || !this.roomRuntimeTemplate) {
      return unavailableRoomWorkspaceResult(request);
    }
    await this.workspaceRuntime.provision({
      workspaceId,
      templateId: this.roomRuntimeTemplate.id,
      templateVersion: this.roomRuntimeTemplate.version,
      configuration: {}
    });
    this.workspaceRuns.set(request.id, workspaceId);
    const sessions = this.workspaceSessions.get(request.sessionId) ?? new Map<string, number>();
    sessions.set(workspaceId, (sessions.get(workspaceId) ?? 0) + 1);
    this.workspaceSessions.set(request.sessionId, sessions);
    try {
      return await this.workspaceRuntime.run({ workspaceId, request: workspaceRequest });
    } finally {
      this.workspaceRuns.delete(request.id);
      const activeRuns = sessions.get(workspaceId) ?? 0;
      if (activeRuns <= 1) sessions.delete(workspaceId);
      else sessions.set(workspaceId, activeRuns - 1);
      if (sessions.size === 0) this.workspaceSessions.delete(request.sessionId);
    }
  }

  async cancel(runId: string): Promise<void> {
    const workspaceId = this.workspaceRuns.get(runId);
    if (!workspaceId || !this.workspaceRuntime) return;
    await this.workspaceRuntime.cancel(workspaceId);
  }

  cancelSession(sessionId: string): Promise<void> {
    const workspaces = this.workspaceSessions.get(sessionId);
    if (!workspaces || workspaces.size === 0 || !this.workspaceRuntime) return Promise.resolve();
    const runtime = this.workspaceRuntime;
    return Promise.all(
      [...workspaces.keys()].map((workspaceId) => runtime.cancel(workspaceId))
    ).then(() => undefined);
  }
}

function unavailableRoomWorkspaceResult(request: PiRunRequestV1): PiRunResultV1 {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: request.id,
    traceId: request.traceId,
    sessionId: request.sessionId,
    status: "failed",
    generatedFiles: [],
    error: {
      schemaVersion: 1,
      code: "room_workspace_unavailable",
      category: "dependency",
      message: "Room workspace is unavailable: no reviewed shared runtime profile is configured.",
      retryable: false
    },
    startedAt: now,
    finishedAt: now
  };
}
