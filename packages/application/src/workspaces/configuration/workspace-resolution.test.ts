import { describe, expect, it } from "vitest";

import type { WorkspaceRecord } from "@second-brain/domain";

import type { WorkspaceRepositoryPort } from "../../ports.js";
import {
  UnknownWorkspaceError,
  UnknownWorkspaceRoomError,
  WorkspaceResolutionService
} from "./workspace-resolution.js";

describe("WorkspaceResolutionService", () => {
  it("resolves a bound workspace before activation so the gateway can enforce its lifecycle", async () => {
    const service = new WorkspaceResolutionService(
      stubRepository({
        async getByRoomId(roomId) {
          return roomId === "!room-b:example"
            ? {
                id: "workspace-b",
                templateId: "second-brain",
                templateVersion: "1.0.0",
                configuration: {},
                status: "configuring",
                origin: "matrix_invite",
                createdAt: new Date("2026-08-03T10:00:00.000Z"),
                updatedAt: new Date("2026-08-03T10:00:00.000Z")
              }
            : undefined;
        }
      })
    );

    await expect(service.resolveMatrixRoom("!room-b:example")).resolves.toMatchObject({
      id: "workspace-b",
      status: "configuring"
    });
    await expect(service.resolveMatrixRoom("!unknown:example")).rejects.toBeInstanceOf(
      UnknownWorkspaceRoomError
    );
  });

  it("returns every workspace when no filter is supplied", async () => {
    const records = [
      workspaceFixture("workspace-a", "active"),
      workspaceFixture("workspace-b", "archived"),
      workspaceFixture("workspace-c", "configuring")
    ];
    const service = new WorkspaceResolutionService(stubRepository({ list: async () => records }));

    await expect(service.list()).resolves.toEqual(records);
  });

  it("filters the workspace list by lifecycle status", async () => {
    const records = [
      workspaceFixture("workspace-a", "active"),
      workspaceFixture("workspace-b", "archived"),
      workspaceFixture("workspace-c", "configuring")
    ];
    const service = new WorkspaceResolutionService(stubRepository({ list: async () => records }));

    await expect(service.list({ status: "active" })).resolves.toEqual([
      workspaceFixture("workspace-a", "active")
    ]);
  });

  it("retrieves a workspace by its identifier", async () => {
    const target = workspaceFixture("workspace-x", "provisioning");
    const service = new WorkspaceResolutionService(
      stubRepository({
        get: async (id) => (id === target.id ? target : undefined)
      })
    );

    await expect(service.get("workspace-x")).resolves.toEqual(target);
    await expect(service.get("workspace-missing")).rejects.toBeInstanceOf(UnknownWorkspaceError);
  });
});

function stubRepository(overrides: Partial<WorkspaceRepositoryPort>): WorkspaceRepositoryPort {
  const noop = async (): Promise<never> => {
    throw new Error("unexpected workspace repository call");
  };
  return {
    create: noop,
    update: noop,
    get: async () => undefined,
    list: async () => [],
    getByRoomId: async () => undefined,
    getActiveByRoomId: async () => undefined,
    bindRoom: noop,
    ...overrides
  } as WorkspaceRepositoryPort;
}

function workspaceFixture(
  id: string,
  status: "active" | "archived" | "configuring" | "provisioning"
): WorkspaceRecord {
  return {
    id,
    templateId: "second-brain",
    templateVersion: "1.0.0",
    configuration: {},
    status,
    origin: "matrix_invite",
    createdAt: new Date("2026-08-03T10:00:00.000Z"),
    updatedAt: new Date("2026-08-03T10:00:00.000Z")
  };
}
