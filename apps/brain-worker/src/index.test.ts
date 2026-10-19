import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { writeCorePlatformCatalogRelease } from "@second-brain/platform-catalog";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const compiledEntrypoint = new URL("../dist/src/index.js", import.meta.url);

const stubScript = `
  import { createServer } from "node:http";
  const stub = createServer((_request, response) => {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end("[]");
  });
  stub.listen(0, "127.0.0.1", () => {
    const { port } = stub.address();
    process.stdout.write("STUB_PORT=" + port + "\\n");
    process.stdout.write("STUB_READY\\n");
  });
`;

let stubProcess: ChildProcess;
let stubBaseUrl: string;
let catalogDirectory: string;
let catalogPath: string;

beforeAll(async () => {
  catalogDirectory = await mkdtemp(join(tmpdir(), "jarvis-brain-worker-catalog-"));
  catalogPath = join(catalogDirectory, "platform-catalog.v2.json");
  await writeCorePlatformCatalogRelease(catalogPath, {
    repoRoot: repositoryRoot,
    runtimeImages: {
      base: `sha256:${"a".repeat(64)}`,
      isolated: `sha256:${"b".repeat(64)}`,
      browser: `sha256:${"c".repeat(64)}`
    }
  });
  stubProcess = spawn(process.execPath, ["--input-type=module", "-e", stubScript], {
    cwd: repositoryRoot,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    stdio: ["ignore", "pipe", "pipe"]
  });
  stubBaseUrl = await new Promise<string>((resolve, reject) => {
    let buffer = "";
    const timeout = setTimeout(() => reject(new Error("Stub server did not become ready.")), 5_000);
    stubProcess.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (buffer.includes("STUB_READY")) {
        clearTimeout(timeout);
        const match = /STUB_PORT=(\d+)/.exec(buffer);
        if (match) {
          resolve(`http://127.0.0.1:${match[1]}`);
          return;
        }
        reject(new Error("Stub server did not announce its port."));
      }
    });
    stubProcess.on("error", reject);
  });
});

afterAll(async () => {
  stubProcess.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (stubProcess.exitCode !== null) {
      resolve();
      return;
    }
    stubProcess.once("exit", () => resolve());
  });
  await rm(catalogDirectory, { recursive: true, force: true });
});

describe("Brain Worker entrypoint", () => {
  it("starts polling when invoked as the production entrypoint", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      BRAIN_CONTROL_URL: stubBaseUrl,
      PI_RUNNER_URL: stubBaseUrl,
      MEDIA_WORKER_URL: stubBaseUrl,
      BRAIN_WORKER_POLL_INTERVAL_MS: "200",
      BRAIN_WORKER_LEASE_MS: "600000",
      BRAIN_WORKER_CLAIM_LIMIT: "1",
      BRAIN_WORKER_MAX_ATTEMPTS: "3",
      BRAIN_WORKER_RETRY_BASE_DELAY_MS: "1000",
      BRAIN_WORKER_CONTROL_REQUEST_TIMEOUT_MS: "30000",
      BRAIN_WORKER_MEDIA_REQUEST_TIMEOUT_MS: "240000",
      BRAIN_WORKER_PI_TIMEOUT_SECONDS: "600",
      SESSION_IDLE_CONTINUATION_MS: "86400000",
      SESSION_RETENTION_MS: "604800000",
      SCHEDULE_DISPLAY_TIMEZONE: "Europe/Stockholm",
      BRAIN_WORKER_ONCE: "true",
      SECOND_BRAIN_ENVIRONMENT: "test",
      LOG_LEVEL: "info",
      PLATFORM_CATALOG_PATH: catalogPath
    };

    const result = spawnSync(process.execPath, [fileURLToPath(compiledEntrypoint)], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env,
      timeout: 15_000
    });

    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, [result.stdout, result.stderr].filter(Boolean).join("\n")).toBe(0);
    expect(result.stdout).toContain("brain-worker started");
  }, 15_000);
});
