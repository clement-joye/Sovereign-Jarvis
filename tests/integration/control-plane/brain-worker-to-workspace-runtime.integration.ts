import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { examplePiRunRequest, type PiRunResultV1 } from "@second-brain/contracts";
import { INITIAL_AGENT_CATALOG } from "@second-brain/domain";

import { createRuntimeProvisionerServer } from "../../../apps/runtime-provisioner/src/index.js";
import { createWorkerPiRunner } from "../../../apps/brain-worker/src/orchestration/workspace-pi-runner.js";

describe("brain-worker → workspace runtime integration", () => {
  it("derives the provisioned runtime scope from the worker request", async () => {
    const run = vi.fn().mockResolvedValue(result());
    const provisioner = await startProvisioner({ run });
    const currentRuntimeProfilePath = await writeRuntimeProfile();
    try {
      const runner = createWorkerPiRunner({
        timeoutMs: 1_000,
        runtimeProvisioner: { baseUrl: provisioner.baseUrl, token: "secret" },
        currentRuntimeProfilePath
      });

      await expect(
        runner.run({
          ...examplePiRunRequest,
          catalogDigest: INITIAL_AGENT_CATALOG.digest,
          workspaceId: "workspace-1"
        })
      ).resolves.toEqual(result());

      expect(run).toHaveBeenCalledWith(
        "workspace-1",
        expect.objectContaining({ id: "pi-run-1", traceId: "trace-1" })
      );
      expect(run.mock.calls[0]?.[1]).not.toHaveProperty("workspaceId");
    } finally {
      await provisioner.close();
    }
  });

  it("cancels an active run through the same workspace runtime", async () => {
    let release: (() => void) | undefined;
    const run = vi.fn(
      () =>
        new Promise<PiRunResultV1>((resolve) => {
          release = () => resolve(result());
        })
    );
    const cancel = vi.fn().mockResolvedValue(undefined);
    const provisioner = await startProvisioner({ run, cancel });
    const currentRuntimeProfilePath = await writeRuntimeProfile();
    try {
      const runner = createWorkerPiRunner({
        timeoutMs: 1_000,
        runtimeProvisioner: { baseUrl: provisioner.baseUrl, token: "secret" },
        currentRuntimeProfilePath
      });
      const pending = runner.run({
        ...examplePiRunRequest,
        catalogDigest: INITIAL_AGENT_CATALOG.digest,
        workspaceId: "workspace-1"
      });
      await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());

      await runner.cancel("pi-run-1");

      expect(cancel).toHaveBeenCalledWith("workspace-1", "pi-run-1");
      release?.();
      await pending;
    } finally {
      await provisioner.close();
    }
  });
});

async function startProvisioner(provisioner: {
  run: ReturnType<typeof vi.fn>;
  cancel?: ReturnType<typeof vi.fn>;
}) {
  const provisionReviewed = vi.fn().mockResolvedValue("runtime-workspace-1");
  const server = createRuntimeProvisionerServer({
    provisioner: { ...provisioner, provisionReviewed } as never,
    token: "secret",
    catalogDigest: INITIAL_AGENT_CATALOG.digest
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP runtime provisioner.");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    }
  };
}

async function writeRuntimeProfile(): Promise<string> {
  const path = join(
    await mkdtemp(join(tmpdir(), "jarvis-runtime-profile-")),
    "current-runtime.json"
  );
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      profileArtifact: {
        schemaVersion: 1,
        id: "pi-jarvis",
        version: "1.0.0",
        source: {
          repository: "https://example.test/pi-jarvis",
          revision: "a".repeat(40),
          digest: `sha256:${"b".repeat(64)}`
        },
        runtimeImage: `sha256:${"c".repeat(64)}`,
        modelsPath: "models.json",
        resources: [
          {
            path: "skills",
            kind: "skill",
            compatibility: "sdk-compatible",
            rationale: "Integration fixture."
          }
        ]
      },
      currentRuntime: {
        templateId: "code-project",
        templateVersion: "1.0.0",
        imageId: `sha256:${"c".repeat(64)}`,
        network: "restricted"
      }
    })
  );
  return path;
}

function result(): PiRunResultV1 {
  return {
    schemaVersion: 1,
    id: "pi-run-1",
    traceId: "trace-1",
    sessionId: "session-1",
    status: "completed",
    generatedFiles: [],
    startedAt: "2026-08-04T12:00:00.000Z",
    finishedAt: "2026-08-04T12:00:01.000Z"
  };
}
