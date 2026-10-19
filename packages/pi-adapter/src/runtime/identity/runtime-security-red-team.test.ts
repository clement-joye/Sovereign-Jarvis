import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DockerCliContainerEngine } from "../execution/docker-cli-container-engine.js";
import { createWorkspaceTools } from "../../tools/workspace-tools.js";

type DockerExec = (file: string, args: readonly string[]) => Promise<string | void>;
const browserPolicy = {
  mountPolicy: "none" as const,
  timeoutSeconds: 900,
  memoryMiB: 4096,
  cpuMillicores: 2000,
  pids: 512
};

let temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots = [];
});

describe("runtime security red-team characterization", () => {
  it("does not expose provider or control-plane tokens to Browser runtimes", async () => {
    const exec = vi.fn<DockerExec>().mockResolvedValue(undefined);
    const engine = new DockerCliContainerEngine(exec, {
      INFERENCE_SERVER_API_KEY: "provider-secret",
      BRAIN_CONTROL_PI_SCHEDULE_TOKEN: "schedule-secret",
      BRAIN_CONTROL_PI_GIT_TOKEN: "git-secret",
      RUN_AUTHORIZATION_SECRET: "run-authorization-signing-secret"
    });

    await engine.createContainer({
      name: "jarvis-workspace-one-browser",
      image: `jarvis/browser@sha256:${"a".repeat(64)}`,
      volumeName: "workspace-one",
      sessionVolumeName: "sessions-one-browser",
      networkAlias: "jarvis-runtime-browser-7692c3ad3540bb803c020b3a",
      network: "browser-restricted",
      modelNetwork: "none",
      ...browserPolicy
    });

    const args = exec.mock.calls[0]?.[1] ?? [];
    expect(args.filter((arg) => arg.includes("secret"))).toEqual([]);
  });

  it("does not mount the shared workspace into a Browser runtime", async () => {
    const exec = vi.fn<DockerExec>().mockResolvedValue(undefined);
    const engine = new DockerCliContainerEngine(exec);

    await engine.createContainer({
      name: "jarvis-workspace-one-browser",
      image: `jarvis/browser@sha256:${"a".repeat(64)}`,
      volumeName: "workspace-one",
      sessionVolumeName: "sessions-one-browser",
      networkAlias: "jarvis-runtime-browser-7692c3ad3540bb803c020b3a",
      network: "browser-restricted",
      modelNetwork: "none",
      ...browserPolicy
    });

    const args = exec.mock.calls[0]?.[1] ?? [];
    expect(args).not.toEqual(
      expect.arrayContaining(["--mount", "type=volume,src=workspace-one,dst=/workspace"])
    );
  });

  it("enforces delegated writable paths on workspace tools", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-delegated-scope-"));
    temporaryRoots.push(root);
    const delegatedWritablePaths = ["notes/project"];
    const [writeTool] = createWorkspaceTools(root, {
      readablePaths: delegatedWritablePaths,
      writablePaths: delegatedWritablePaths
    }).filter((tool) => tool.name === "workspace_write");
    if (!writeTool) throw new Error("Expected workspace_write tool.");

    await expect(
      writeTool.execute(
        "call-1",
        { path: "private/secret.txt", content: "must not be writable" },
        new AbortController().signal,
        () => undefined,
        {} as never
      )
    ).rejects.toThrow("outside delegated writable paths");

    await expect(readFile(join(root, "private", "secret.txt"), "utf8")).rejects.toThrow();
  });
});
