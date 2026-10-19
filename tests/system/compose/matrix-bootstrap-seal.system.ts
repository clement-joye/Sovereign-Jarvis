import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { createRunId, eventually } from "@second-brain/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeValidReleaseArtifacts } from "../../../scripts/setup/test-artifact-fixtures.mjs";

const execFileAsync = promisify(execFile);
const composeFile = "deploy/compose/compose.system-test.yml";
const projectName = createRunId("jarvis-bootstrap-seal");
let temporaryRoot = "";
let platformCatalogDir = "";
let sealedComposeFile = "";
let port = "";
let homeserverUrl = "";
let started = false;

describe("isolated Matrix bootstrap seal and restart boundary", () => {
  beforeAll(async () => {
    await execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"]);
    temporaryRoot = await mkdtemp(join(tmpdir(), "jarvis-bootstrap-seal-"));
    platformCatalogDir = join(temporaryRoot, "catalog");
    await mkdir(platformCatalogDir);
    await chmod(platformCatalogDir, 0o755);
    port = await availablePort();
    homeserverUrl = `http://127.0.0.1:${port}`;
    started = true;
    await compose(["up", "--detach", "matrix-homeserver"]);
    await eventually(
      async () => {
        const response = await fetch(`${homeserverUrl}/_matrix/client/versions`);
        expect(response.ok).toBe(true);
      },
      { description: "isolated bootstrap homeserver readiness", timeoutMs: 60_000 }
    );
    const initialCompose = JSON.parse(await composeOutput(["config", "--format", "json"])) as {
      services: Record<string, { environment?: Record<string, string>; [key: string]: unknown }>;
      networks: Record<string, { name?: string }>;
      volumes: Record<string, { name?: string }>;
    };
    const sealedConfig = createSealedComposeConfig(initialCompose);
    sealedComposeFile = join(temporaryRoot, "sealed.compose.yml");
    await writeFile(sealedComposeFile, JSON.stringify(sealedConfig, null, 2));
  }, 90_000);

  afterAll(async () => {
    if (started) await compose(["down", "--volumes", "--remove-orphans"]).catch(() => undefined);
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  }, 30_000);

  it("seals temporary registration, gates readiness, and restarts with registration closed", async () => {
    const registrationToken = await initialRegistrationToken();
    const account = await registerUser(registrationToken);
    expect(account.userId).toMatch(/^@bootstrap-/u);

    const stateRoot = join(temporaryRoot, "state");
    const envPath = join(stateRoot, "production.env");
    const statePath = join(stateRoot, "setup-state.json");
    await mkdir(stateRoot);
    await writeFile(
      envPath,
      [
        "MATRIX_OWNER_ID='@owner:matrix.test'",
        "MATRIX_BRAIN_USER_ID='@brain:matrix.test'",
        "MATRIX_ACCESS_TOKEN='system-test-access-token'",
        "MATRIX_RECOVERY_KEY='system-test-recovery-key'",
        "MATRIX_E2EE_ENABLED=true",
        "CONTINUWUITY_ALLOW_REGISTRATION=true",
        `CONTINUWUITY_REGISTRATION_TOKEN='${registrationToken}'`,
        ""
      ].join("\n"),
      { mode: 0o600 }
    );
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        completedStages: ["preflight", "state-directories", "environment"]
      })
    );
    await mkdir(join(stateRoot, "runtime-profile"));
    await mkdir(join(stateRoot, "platform-catalog"));
    await writeValidReleaseArtifacts(stateRoot);

    await runNode([
      "scripts/setup/jarvis-setup.mjs",
      "--seal-matrix-registration",
      "--state-root",
      stateRoot
    ]);
    const sealedEnvironment = await readFile(envPath, "utf8");
    expect(sealedEnvironment).toContain("CONTINUWUITY_ALLOW_REGISTRATION='false'");
    expect(sealedEnvironment).not.toContain("CONTINUWUITY_REGISTRATION_TOKEN=");
    await runNode(["scripts/setup/install-readiness.mjs", stateRoot]);

    const renderedCompose = JSON.parse(
      await sealedComposeOutput(["config", "--format", "json"])
    ) as {
      services: Record<string, { environment?: Record<string, string | null> }>;
    };
    const sealedHomeserverEnvironment = renderedCompose.services["matrix-homeserver"]?.environment;
    expect(sealedHomeserverEnvironment?.CONTINUWUITY_ALLOW_REGISTRATION).toBe("false");
    expect(
      Object.hasOwn(sealedHomeserverEnvironment ?? {}, "CONTINUWUITY_REGISTRATION_TOKEN")
    ).toBe(false);

    await sealedCompose(["up", "--detach", "--force-recreate", "matrix-homeserver"]);
    try {
      await eventually(
        async () => {
          const response = await fetch(`${homeserverUrl}/_matrix/client/versions`);
          expect(response.ok).toBe(true);
        },
        { description: "sealed homeserver restart readiness", timeoutMs: 60_000 }
      );
    } catch (error) {
      const diagnostics = await safeHomeserverDiagnostics(registrationToken);
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${diagnostics}`, {
        cause: error
      });
    }

    const response = await fetch(`${homeserverUrl}/_matrix/client/v3/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: `after-seal-${Date.now()}`, password: "system-test" })
    });
    expect([403, 404]).toContain(response.status);
  }, 120_000);
});

async function compose(args: string[]): Promise<void> {
  await composeOutput(args);
}

async function composeOutput(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "docker",
    ["compose", "-p", projectName, "-f", composeFile, ...args],
    {
      cwd: new URL("../../..", import.meta.url),
      env: {
        ...process.env,
        PLATFORM_CATALOG_DIR: platformCatalogDir,
        MATRIX_HOMESERVER_HOST_PORT: port
      }
    }
  );
  return stdout;
}

async function sealedCompose(args: string[]): Promise<void> {
  await sealedComposeOutput(args);
}

async function sealedComposeOutput(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "docker",
    ["compose", "-p", projectName, "-f", sealedComposeFile, ...args],
    { cwd: new URL("../../..", import.meta.url) }
  );
  return stdout;
}

async function runNode(args: string[]): Promise<void> {
  await execFileAsync(process.execPath, args, { cwd: new URL("../../..", import.meta.url) });
}

async function initialRegistrationToken(): Promise<string> {
  let token: string | undefined;
  await eventually(
    async () => {
      const { stdout, stderr } = await execFileAsync(
        "docker",
        [
          "compose",
          "-p",
          projectName,
          "-f",
          composeFile,
          "logs",
          "--no-color",
          "matrix-homeserver"
        ],
        {
          cwd: new URL("../../..", import.meta.url),
          env: {
            ...process.env,
            PLATFORM_CATALOG_DIR: platformCatalogDir,
            MATRIX_HOMESERVER_HOST_PORT: port
          }
        }
      );
      const logs = `${stdout}\n${stderr}`.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
      token =
        /using registration token\s+([^\s.]+)/i.exec(logs)?.[1] ??
        /registration token\s*(?:is|:|=)?\s*([^\s.]+)/i.exec(logs)?.[1];
      expect(token).toBeDefined();
    },
    { description: "isolated homeserver bootstrap registration token", timeoutMs: 30_000 }
  );
  if (!token) throw new Error("Homeserver did not emit its initial registration token.");
  return token;
}

async function safeHomeserverDiagnostics(registrationToken: string): Promise<string> {
  try {
    const status = await sealedComposeOutput(["ps", "--all"]);
    const logs = await sealedComposeOutput([
      "logs",
      "--no-color",
      "--tail",
      "40",
      "matrix-homeserver"
    ]);
    const safeLogs = logs
      .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
      .replaceAll(registrationToken, "[REDACTED]")
      .replace(/(registration token\s*(?:is|:|=)?\s*)[^\s.]+/gi, "$1[REDACTED]")
      .split(/\r?\n/u)
      .slice(-20)
      .join("\n");
    return `Homeserver Compose status:\n${status.trim() || "(empty)"}\nHomeserver log tail (registration token values redacted):\n${safeLogs || "(empty)"}`;
  } catch {
    return "Homeserver diagnostics unavailable.";
  }
}

async function registerUser(token: string): Promise<{ userId: string }> {
  const username = `bootstrap-${createRunId("user").replaceAll("-", "")}`;
  const registration = { username, password: "isolated-system-test-password" };
  const challengeResponse = await fetch(`${homeserverUrl}/_matrix/client/v3/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(registration)
  });
  expect(challengeResponse.status).toBe(401);
  const challenge = (await challengeResponse.json()) as { session?: string };
  expect(challenge.session).toBeTruthy();
  const response = await fetch(`${homeserverUrl}/_matrix/client/v3/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...registration,
      auth: { type: "m.login.registration_token", token, session: challenge.session }
    })
  });
  expect(response.ok).toBe(true);
  const result = (await response.json()) as { user_id: string };
  return { userId: result.user_id };
}

function createSealedComposeConfig(config: {
  services: Record<string, { environment?: Record<string, string>; [key: string]: unknown }>;
  networks: Record<string, { name?: string }>;
  volumes: Record<string, { name?: string }>;
}) {
  const service = config.services["matrix-homeserver"];
  const networkName = config.networks.matrix_net?.name;
  const volumeName = config.volumes["matrix-homeserver-data"]?.name;
  if (!service?.environment || !networkName || !volumeName) {
    throw new Error("Compose did not resolve the isolated homeserver, network, and volume.");
  }
  delete service.environment.CONTINUWUITY_REGISTRATION_TOKEN;
  service.environment.CONTINUWUITY_ALLOW_REGISTRATION = "false";
  if (Object.hasOwn(service.environment, "CONTINUWUITY_REGISTRATION_TOKEN")) {
    throw new Error("The sealed homeserver Compose config retained its registration token.");
  }
  return {
    services: { "matrix-homeserver": service },
    networks: { matrix_net: { external: true, name: networkName } },
    volumes: { "matrix-homeserver-data": { external: true, name: volumeName } }
  };
}

async function availablePort(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to allocate test port.");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return String(address.port);
}
