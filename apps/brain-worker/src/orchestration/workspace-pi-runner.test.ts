import { afterEach, describe, expect, it, vi } from "vitest";

import { examplePiRunRequest } from "@second-brain/contracts";

import { createWorkerPiRunner } from "./workspace-pi-runner.js";

describe("createWorkerPiRunner", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns a clear room-workspace availability result when no reviewed profile has been mounted", async () => {
    await expect(
      createWorkerPiRunner({
        runtimeProvisioner: { baseUrl: "http://runtime-provisioner:3040", token: "secret" }
      }).run({ ...examplePiRunRequest, workspaceId: "workspace-1", agentId: "brain" })
    ).resolves.toMatchObject({ status: "failed", error: { code: "room_workspace_unavailable" } });
  });
});
