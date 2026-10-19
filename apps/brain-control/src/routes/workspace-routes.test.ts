import { describe, expect, it, vi } from "vitest";

import {
  WorkspaceInvitationService,
  WorkspaceLifecycleRoomResolutionService,
  WorkspaceRoomRuntimeRecoveryService,
  WorkspaceResolutionService
} from "@second-brain/application";
import { InMemoryWorkspaceRepository, SequentialIdGenerator } from "@second-brain/testkit";

import { handleWorkspaceRoute } from "./workspace-routes.js";

describe("workspace routes", () => {
  it("returns the workspace resolved from an active Matrix room binding", async () => {
    const repository = new InMemoryWorkspaceRepository();
    await repository.create({
      id: "workspace-project",
      templateId: "code-project",
      templateVersion: "1.0.0",
      configuration: {},
      status: "active",
      origin: "matrix_invite",
      createdAt: new Date("2026-08-03T10:00:00.000Z"),
      updatedAt: new Date("2026-08-03T10:00:00.000Z")
    });
    await repository.bindRoom({
      id: "binding-project",
      workspaceId: "workspace-project",
      roomId: "!project:example",
      status: "active",
      createdAt: new Date("2026-08-03T10:00:00.000Z")
    });
    const writes: Array<{ status: number; body: unknown }> = [];

    const handled = await handleWorkspaceRoute(
      { method: "POST" } as never,
      {} as never,
      new URL("http://brain-control.local/v1/workspaces/resolve-room"),
      {
        workspaceResolution: new WorkspaceResolutionService(repository),
        workspaceInvitation: new WorkspaceInvitationService(
          repository,
          new SequentialIdGenerator(),
          { now: () => new Date() }
        ),
        readJson: async () => ({ roomId: "!project:example" }),
        writeJson: (_response, status, body) => writes.push({ status, body })
      }
    );

    expect(handled).toBe(true);
    expect(writes).toEqual([
      {
        status: 200,
        body: {
          workspaceId: "workspace-project",
          templateId: "code-project",
          templateVersion: "1.0.0",
          status: "active",
          defaultAgent: "brain"
        }
      }
    ]);
  });

  it("does not resolve unbound rooms", async () => {
    const writes: Array<{ status: number; body: unknown }> = [];
    const handled = await handleWorkspaceRoute(
      { method: "POST" } as never,
      {} as never,
      new URL("http://brain-control.local/v1/workspaces/resolve-room"),
      {
        workspaceResolution: new WorkspaceResolutionService(new InMemoryWorkspaceRepository()),
        workspaceInvitation: new WorkspaceInvitationService(
          new InMemoryWorkspaceRepository(),
          new SequentialIdGenerator(),
          { now: () => new Date() }
        ),
        readJson: async () => ({ roomId: "!unknown:example" }),
        writeJson: (_response, status, body) => writes.push({ status, body })
      }
    );

    expect(handled).toBe(true);
    expect(writes).toEqual([{ status: 404, body: { error: "workspace_room_not_found" } }]);
  });

  it("recovers a runtime by its bound room instead of accepting a workspace identifier", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const workspace = {
      id: "workspace-project",
      templateId: "code-project",
      templateVersion: "1.0.0",
      configuration: {},
      status: "active" as const,
      origin: "matrix_invite" as const,
      createdAt: new Date("2026-08-03T10:00:00.000Z"),
      updatedAt: new Date("2026-08-03T10:00:00.000Z")
    };
    await repository.create(workspace);
    await repository.bindRoom({
      id: "binding-project",
      workspaceId: workspace.id,
      roomId: "!project:example",
      status: "active",
      createdAt: workspace.createdAt
    });
    const recover = vi.fn().mockResolvedValue(workspace);
    const writes: Array<{ status: number; body: unknown }> = [];

    await expect(
      handleWorkspaceRoute(
        { method: "POST" } as never,
        {} as never,
        new URL("http://brain-control.local/v1/workspaces/recover-room"),
        {
          workspaceResolution: new WorkspaceResolutionService(repository),
          workspaceInvitation: new WorkspaceInvitationService(
            repository,
            new SequentialIdGenerator(),
            { now: () => new Date() }
          ),
          workspaceRoomRuntimeRecovery: new WorkspaceRoomRuntimeRecoveryService(repository, {
            recover
          }),
          readJson: async () => ({ roomId: "!project:example" }),
          writeJson: (_response, status, body) => writes.push({ status, body })
        }
      )
    ).resolves.toBe(true);

    expect(recover).toHaveBeenCalledWith("workspace-project");
    expect(writes).toEqual([{ status: 200, body: { status: "active" } }]);
  });

  it("rejects legacy configuring-room commands", async () => {
    const repository = new InMemoryWorkspaceRepository();
    await repository.create({
      id: "workspace-1",
      templateId: "workspace-onboarding",
      templateVersion: "0.0.0",
      configuration: {},
      status: "configuring",
      origin: "matrix_invite",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    await repository.bindRoom({
      id: "binding-1",
      workspaceId: "workspace-1",
      roomId: "!project:example",
      status: "active",
      createdAt: new Date()
    });
    const submitted: unknown[] = [];
    const writes: Array<{ status: number; body: unknown }> = [];

    await expect(
      handleWorkspaceRoute(
        { method: "POST" } as never,
        {} as never,
        new URL("http://brain-control.local/v1/workspaces/lifecycle-command"),
        {
          workspaceResolution: new WorkspaceResolutionService(repository),
          workspaceLifecycleResolution: new WorkspaceLifecycleRoomResolutionService(repository),
          workspaceInvitation: new WorkspaceInvitationService(
            repository,
            new SequentialIdGenerator(),
            { now: () => new Date() }
          ),
          roomLifecycleCommands: {
            submit: async (message: unknown) => {
              submitted.push(message);
              return { handled: true };
            }
          } as never,
          readJson: async () => ({
            roomId: "!project:example",
            externalEventId: "$event-1",
            traceId: "trace-1",
            text: "/workspace status"
          }),
          writeJson: (_response, status, body) => writes.push({ status, body })
        }
      )
    ).resolves.toBe(true);

    expect(submitted).toEqual([]);
    expect(writes).toEqual([{ status: 409, body: { error: "workspace_not_commandable" } }]);
  });

  it("submits active-room lifecycle commands with control-plane-derived workspace ownership", async () => {
    const repository = new InMemoryWorkspaceRepository();
    await repository.create({
      id: "workspace-active",
      templateId: "second-brain",
      templateVersion: "1.0.0",
      configuration: { timezone: "Europe/Stockholm" },
      status: "active",
      origin: "matrix_invite",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    await repository.bindRoom({
      id: "binding-active",
      workspaceId: "workspace-active",
      roomId: "!active:example",
      status: "active",
      createdAt: new Date()
    });
    const submit = vi.fn().mockResolvedValue({ handled: true });
    const writes: Array<{ status: number; body: unknown }> = [];

    await expect(
      handleWorkspaceRoute(
        { method: "POST" } as never,
        {} as never,
        new URL("http://brain-control.local/v1/workspaces/lifecycle-command"),
        {
          workspaceResolution: new WorkspaceResolutionService(repository),
          workspaceLifecycleResolution: new WorkspaceLifecycleRoomResolutionService(repository),
          workspaceInvitation: new WorkspaceInvitationService(
            repository,
            new SequentialIdGenerator(),
            { now: () => new Date() }
          ),
          roomLifecycleCommands: { submit } as never,
          readJson: async () => ({
            roomId: "!active:example",
            externalEventId: "$archive",
            traceId: "trace-archive",
            text: "/workspace archive"
          }),
          writeJson: (_response, status, body) => writes.push({ status, body })
        }
      )
    ).resolves.toBe(true);

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-active", text: "/workspace archive" })
    );
    expect(writes).toEqual([{ status: 200, body: { handled: true } }]);
  });

  it("creates an active Brain workspace only through the trusted invite route", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const writes: Array<{ status: number; body: unknown }> = [];
    const invitation = new WorkspaceInvitationService(repository, new SequentialIdGenerator(), {
      now: () => new Date("2026-08-04T12:00:00.000Z")
    });
    const dependencies = {
      workspaceResolution: new WorkspaceResolutionService(repository),
      workspaceInvitation: invitation,
      readJson: async () => ({ roomId: "!project:example" }),
      writeJson: (_response: unknown, status: number, body: unknown) =>
        writes.push({ status, body })
    };

    await expect(
      handleWorkspaceRoute(
        { method: "POST" } as never,
        {} as never,
        new URL("http://brain-control.local/v1/workspaces/accept-trusted-invite"),
        dependencies
      )
    ).resolves.toBe(true);
    await expect(
      handleWorkspaceRoute(
        { method: "POST" } as never,
        {} as never,
        new URL("http://brain-control.local/v1/workspaces/accept-trusted-invite"),
        dependencies
      )
    ).resolves.toBe(true);

    expect(writes).toEqual([
      {
        status: 200,
        body: {
          workspaceId: "workspace-1",
          templateId: "second-brain",
          templateVersion: "1.0.0",
          status: "active",
          defaultAgent: "brain",
          created: true
        }
      },
      {
        status: 200,
        body: {
          workspaceId: "workspace-1",
          templateId: "second-brain",
          templateVersion: "1.0.0",
          status: "active",
          defaultAgent: "brain",
          created: false
        }
      }
    ]);
  });

  it("lists every durable workspace when GET /v1/workspaces is requested", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const now = new Date("2026-08-04T11:00:00.000Z");
    await repository.create(workspaceRecord("workspace-active", "active", now));
    await repository.create(workspaceRecord("workspace-archived", "archived", now));
    const writes: Array<{ status: number; body: unknown }> = [];
    const handled = await handleWorkspaceRoute(
      { method: "GET" } as never,
      {} as never,
      new URL("http://brain-control.local/v1/workspaces"),
      {
        workspaceResolution: new WorkspaceResolutionService(repository),
        workspaceInvitation: new WorkspaceInvitationService(
          repository,
          new SequentialIdGenerator(),
          { now: () => now }
        ),
        readJson: async () => ({}),
        writeJson: (_response, status, body) => writes.push({ status, body })
      }
    );

    expect(handled).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.status).toBe(200);
    expect(writes[0]?.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "workspace-active", status: "active" }),
        expect.objectContaining({ id: "workspace-archived", status: "archived" })
      ])
    );
  });

  it("narrows the workspace list to the supplied status filter", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const now = new Date("2026-08-04T11:00:00.000Z");
    await repository.create(workspaceRecord("workspace-active", "active", now));
    await repository.create(workspaceRecord("workspace-archived", "archived", now));
    const writes: Array<{ status: number; body: unknown }> = [];
    const handled = await handleWorkspaceRoute(
      { method: "GET" } as never,
      {} as never,
      new URL("http://brain-control.local/v1/workspaces?status=archived"),
      {
        workspaceResolution: new WorkspaceResolutionService(repository),
        workspaceInvitation: new WorkspaceInvitationService(
          repository,
          new SequentialIdGenerator(),
          { now: () => now }
        ),
        readJson: async () => ({}),
        writeJson: (_response, status, body) => writes.push({ status, body })
      }
    );

    expect(handled).toBe(true);
    expect(writes).toEqual([
      {
        status: 200,
        body: [expect.objectContaining({ id: "workspace-archived", status: "archived" })]
      }
    ]);
  });

  it("rejects an invalid status filter with HTTP 400", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const writes: Array<{ status: number; body: unknown }> = [];
    const handled = await handleWorkspaceRoute(
      { method: "GET" } as never,
      {} as never,
      new URL("http://brain-control.local/v1/workspaces?status=unknown"),
      {
        workspaceResolution: new WorkspaceResolutionService(repository),
        workspaceInvitation: new WorkspaceInvitationService(
          repository,
          new SequentialIdGenerator(),
          { now: () => new Date() }
        ),
        readJson: async () => ({}),
        writeJson: (_response, status, body) => writes.push({ status, body })
      }
    );

    expect(handled).toBe(true);
    expect(writes[0]).toEqual({
      status: 400,
      body: { error: "invalid_workspace_status_filter", issues: expect.anything() }
    });
  });

  it("retrieves a single workspace by its identifier", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const target = await repository.create(
      workspaceRecord("workspace-x", "active", new Date("2026-08-04T11:00:00.000Z"))
    );
    const writes: Array<{ status: number; body: unknown }> = [];
    const handled = await handleWorkspaceRoute(
      { method: "GET" } as never,
      {} as never,
      new URL(`http://brain-control.local/v1/workspaces/${target.id}`),
      {
        workspaceResolution: new WorkspaceResolutionService(repository),
        workspaceInvitation: new WorkspaceInvitationService(
          repository,
          new SequentialIdGenerator(),
          { now: () => new Date() }
        ),
        readJson: async () => ({}),
        writeJson: (_response, status, body) => writes.push({ status, body })
      }
    );

    expect(handled).toBe(true);
    expect(writes).toEqual([
      {
        status: 200,
        body: expect.objectContaining({ id: target.id, status: "active" })
      }
    ]);
  });

  it("returns HTTP 404 when a single workspace is missing", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const writes: Array<{ status: number; body: unknown }> = [];
    const handled = await handleWorkspaceRoute(
      { method: "GET" } as never,
      {} as never,
      new URL("http://brain-control.local/v1/workspaces/workspace-missing"),
      {
        workspaceResolution: new WorkspaceResolutionService(repository),
        workspaceInvitation: new WorkspaceInvitationService(
          repository,
          new SequentialIdGenerator(),
          { now: () => new Date() }
        ),
        readJson: async () => ({}),
        writeJson: (_response, status, body) => writes.push({ status, body })
      }
    );

    expect(handled).toBe(true);
    expect(writes).toEqual([
      {
        status: 404,
        body: { error: "workspace_not_found" }
      }
    ]);
  });

  it("derives plugin-command workspace ownership from the trusted Matrix room", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const now = new Date("2026-09-08T15:00:00.000Z");
    await repository.create(workspaceRecord("workspace-plugin", "active", now));
    await repository.bindRoom({
      id: "binding-plugin",
      workspaceId: "workspace-plugin",
      roomId: "!plugin:example",
      status: "active",
      createdAt: now
    });
    const submit = vi.fn().mockResolvedValue({ handled: true });
    const writes: Array<{ status: number; body: unknown }> = [];

    await expect(
      handleWorkspaceRoute(
        { method: "POST" } as never,
        {} as never,
        new URL("http://brain-control.local/v1/workspaces/plugin-command"),
        {
          workspaceResolution: new WorkspaceResolutionService(repository),
          workspaceInvitation: new WorkspaceInvitationService(
            repository,
            new SequentialIdGenerator(),
            { now: () => now }
          ),
          roomPluginCommands: { submit } as never,
          readJson: async () => ({
            roomId: "!plugin:example",
            externalEventId: "$plugin-command",
            traceId: "trace-plugin-command",
            text: "/plugin status calendar-test"
          }),
          writeJson: (_response, status, body) => writes.push({ status, body })
        }
      )
    ).resolves.toBe(true);

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-plugin",
        conversationId: "!plugin:example",
        senderId: "matrix-gateway"
      })
    );
    expect(writes).toEqual([{ status: 200, body: { handled: true } }]);
  });

  it("leaves nested workspace resources for their specific route handlers", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const dependencies = {
      workspaceResolution: new WorkspaceResolutionService(repository),
      workspaceInvitation: new WorkspaceInvitationService(repository, new SequentialIdGenerator(), {
        now: () => new Date()
      }),
      readJson: async () => ({}),
      writeJson: vi.fn()
    };

    await expect(
      handleWorkspaceRoute(
        { method: "GET" } as never,
        {} as never,
        new URL("http://brain-control.local/v1/workspaces/workspace-x/plugins/example-echo"),
        dependencies
      )
    ).resolves.toBe(false);
    expect(dependencies.writeJson).not.toHaveBeenCalled();
  });
});

function workspaceRecord(
  id: string,
  status: "active" | "archived" | "configuring" | "provisioning",
  now: Date
) {
  return {
    id,
    templateId: "second-brain",
    templateVersion: "1.0.0",
    configuration: {},
    status,
    origin: "matrix_invite" as const,
    createdAt: now,
    updatedAt: now
  };
}
