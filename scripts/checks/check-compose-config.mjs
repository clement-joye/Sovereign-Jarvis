import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const tempRoot = await mkdtemp(join(root, ".compose-check-"));
const catalogDir = join(tempRoot, "catalog");
const profileDir = join(tempRoot, "profile");
await mkdir(catalogDir);
await mkdir(profileDir);

const env = [
  "POSTGRES_IMAGE=docker.io/library/postgres:16.15-alpine3.24@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea",
  "POSTGRES_PASSWORD=compose-check-password",
  "RUNTIME_PROVISIONER_TOKEN=compose-check-runtime-token",
  "RUN_AUTHORIZATION_SECRET=compose-check-run-secret",
  "BRAIN_CONTROL_WORKER_COLLABORATION_TOKEN=compose-check-worker-token",
  `PLATFORM_CATALOG_DIR=${catalogDir}`,
  `RUNTIME_PROFILE_DIR=${profileDir}`,
  "PI_MODEL_PROVIDER_ID=compose-check-provider",
  "PI_MODEL_ID=compose-check-model",
  "INFERENCE_SERVER_API_KEY=compose-check-inference-key",
  "MATRIX_SERVER_NAME=matrix.compose-check",
  "CONTINUWUITY_REGISTRATION_TOKEN=compose-check-registration",
  "MATRIX_ACCESS_TOKEN=compose-check-access",
  "MATRIX_OWNER_ID=@owner:compose-check",
  "MATRIX_BRAIN_USER_ID=@brain:compose-check",
  "MATRIX_RECOVERY_KEY=compose-check-recovery",
  "WHISPER_CPP_MODEL_SHA256=compose-check-whisper",
  "PIPER_MODEL_SHA256=compose-check-piper",
  "LOKI_IMAGE=grafana/loki:check",
  "ALLOY_IMAGE=grafana/alloy:check",
  "PROMETHEUS_IMAGE=prom/prometheus:check",
  "GRAFANA_IMAGE=grafana/grafana:check",
  "GRAFANA_ADMIN_USER=admin",
  "GRAFANA_ADMIN_PASSWORD=compose-check-grafana"
].join("\n");
const envPath = join(tempRoot, ".env");
await import("node:fs/promises").then(({ writeFile }) => writeFile(envPath, `${env}\n`));

const stacks = [
  ["deploy/compose/compose.dev.yml"],
  ["deploy/compose/compose.system-test.yml"],
  ["deploy/compose/compose.matrix-bootstrap.yml"],
  ["deploy/compose/compose.production.yml"],
  ["deploy/compose/compose.production.yml", "deploy/compose/compose.observability.yml"]
];

try {
  for (const files of stacks) {
    const args = ["compose", "--project-name", "jarvis-compose-check", "--env-file", envPath];
    for (const file of files) args.push("-f", file);
    args.push("config", "--quiet");
    execFileSync("docker", args, { cwd: root, stdio: "inherit" });
  }
  console.log(`Validated ${stacks.length} Compose configurations.`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
