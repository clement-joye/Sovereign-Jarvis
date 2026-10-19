#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { lstat, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertPrivateConfigFile,
  completeSetupStage,
  defaultStateRoot,
  ensureStateDirectories,
  generateInternalSecrets,
  hostInferenceBaseUrl,
  matrixRecoveryKeyPresent,
  readSetupState,
  renderProductionEnvironment,
  resolveStateRoot,
  sealMatrixRegistration,
  storeMatrixRecoveryKey,
  summarizeSetupConfig,
  validateInferenceEndpoint,
  validateSetupConfig,
  writePrivateFileCreateOnly
} from "./setup-core.mjs";
import { assertSupportedNodeVersion, runPreflight } from "./preflight.mjs";
import {
  assertPublishedArtifacts,
  assertSetupEnvironment,
  prepareArtifactPublication
} from "./install-readiness.mjs";
import { runOperator } from "../operator/jarvis.mjs";

export async function main(args = process.argv.slice(2), io = { input: stdin, output: stdout }) {
  validateArguments(args);
  if (!args.includes("--help")) assertSupportedNodeVersion();
  const configArgument = option(args, "--config");
  const interactive =
    args.includes("--interactive") || (!configArgument && io.input.isTTY && io.output.isTTY);
  const confirmed = args.includes("--yes");
  const validateInference = args.includes("--validate-inference");
  const stateRootArgument = option(args, "--state-root");
  const selectedStateRoot = stateRootArgument
    ? resolve(stateRootArgument)
    : defaultStateRoot({
        platform: process.platform,
        home: homedir(),
        xdgStateHome: process.env.XDG_STATE_HOME
      });
  if (args.includes("--status")) {
    await printSetupStatus(selectedStateRoot, io.output);
    return 0;
  }
  if (args.includes("--guide")) {
    return runGuidedSetup(selectedStateRoot, io);
  }
  if (args.includes("--store-matrix-recovery-key")) {
    if (await matrixRecoveryKeyPresent(selectedStateRoot)) {
      io.output.write("A Matrix recovery key is already present; it was left unchanged.\n");
      return 0;
    }
    if (!io.input.isTTY || !io.output.isTTY || typeof io.input.setRawMode !== "function") {
      throw new Error("Recovery key entry requires an interactive terminal with hidden input.");
    }
    const recoveryKey = await readHiddenSecret(io.input, io.output, "Brain Matrix recovery key");
    const confirmation = await readHiddenSecret(
      io.input,
      io.output,
      "Confirm brain Matrix recovery key"
    );
    if (recoveryKey !== confirmation) {
      throw new Error(
        "Recovery key entries did not match; nothing was written. Rerun the command to try again."
      );
    }
    const result = await storeMatrixRecoveryKey(selectedStateRoot, recoveryKey);
    io.output.write(
      result.alreadyPresent
        ? "A Matrix recovery key is already present; it was left unchanged.\n"
        : "Matrix recovery key was written to the protected environment file. This confirms persistence only; it does not verify the key or confirm a separate password-manager backup.\n"
    );
    return 0;
  }
  if (args.includes("--publish-artifacts")) {
    const status = await runSetupArtifactPublication(selectedStateRoot);
    io.output.write(status);
    return 0;
  }
  if (args.includes("--migrate")) {
    const status = await runSetupMigration(selectedStateRoot);
    io.output.write(status);
    return 0;
  }
  if (args.includes("--start")) {
    const status = await runSetupStart(selectedStateRoot, runOperator, {
      output: (text) => io.output.write(text)
    });
    io.output.write(status);
    return 0;
  }
  if (args.includes("--seal-matrix-registration")) {
    await sealMatrixRegistration(selectedStateRoot);
    io.output.write(
      "Temporary Matrix registration was sealed and Matrix bootstrap was recorded.\n"
    );
    return 0;
  }
  const stageToComplete = option(args, "--complete-stage");
  if (stageToComplete) {
    if (stageToComplete !== "matrix-bootstrap" && stageToComplete !== "artifacts") {
      throw new Error(
        "Only matrix-bootstrap and artifacts can be marked by setup after validation."
      );
    }
    if (stageToComplete === "matrix-bootstrap") {
      await sealMatrixRegistration(selectedStateRoot);
      io.output.write("Matrix bootstrap verified, registration sealed, and checkpoint recorded.\n");
      return 0;
    }
    await assertPublishedArtifacts(selectedStateRoot);
    const stageStatePath = join(selectedStateRoot, "setup-state.json");
    const stageState = await readSetupState(stageStatePath);
    await completeSetupStage(stageStatePath, stageState, stageToComplete);
    io.output.write(`Setup stage ${stageToComplete} verified and recorded.\n`);
    return 0;
  }
  if (args.includes("--help")) {
    io.output.write(
      "Usage: pnpm jarvis:setup [--interactive | --config <setup.json>] [--yes] [--validate-inference]\n" +
        "       pnpm jarvis:setup --status [--state-root <path>]\n" +
        "       pnpm jarvis:setup --guide [--state-root <path>]\n" +
        "       pnpm jarvis:setup --publish-artifacts [--state-root <path>]\n" +
        "       pnpm jarvis:setup --complete-stage <matrix-bootstrap|artifacts> [--state-root <path>]\n" +
        "       pnpm jarvis:setup --seal-matrix-registration [--state-root <path>]\n" +
        "       pnpm jarvis:setup --store-matrix-recovery-key [--state-root <path>]\n" +
        "       pnpm jarvis:setup --migrate [--state-root <path>]\n" +
        "       pnpm jarvis:setup --start [--state-root <path>]\n"
    );
    io.output.write(
      "With no arguments, setup is interactive when run in a terminal. Use --config for strict non-interactive setup.\n"
    );
    return 0;
  }
  if (!configArgument && interactive) {
    const prior = await readSetupState(join(selectedStateRoot, "setup-state.json"));
    if (prior.completedStages.includes("environment")) {
      return runGuidedSetup(selectedStateRoot, io);
    }
  }
  if (!configArgument && !interactive) {
    io.output.write(
      "Usage: pnpm jarvis:setup [--interactive | --config <setup.json>] [--yes] [--validate-inference]\n"
    );
    io.output.write(
      "With no arguments, setup is interactive when run in a terminal. Use --config for strict non-interactive setup.\n"
    );
    io.output.write("No terminal detected; provide --config <setup.json> --yes.\n");
    return 2;
  }
  const config = validateSetupConfig(
    interactive ? await collectSetupConfig(io.input, io.output) : await readConfig(configArgument)
  );
  io.output.write(
    `Review this setup configuration:\n${JSON.stringify(summarizeSetupConfig(config), null, 2)}\n`
  );
  if (!(await confirmConfiguration(confirmed, io.input, io.output))) {
    io.output.write("Setup cancelled. No setup files were written.\n");
    return 1;
  }

  const stateRoot = resolveStateRoot(config);
  const statePath = join(stateRoot, "setup-state.json");
  const envPath = join(stateRoot, "production.env");
  let state = await readSetupState(statePath);

  if (!state.completedStages.includes("preflight")) {
    await runPreflight({
      ports: [config.matrix.port ?? 8008],
      stateRoot,
      inferenceBaseUrl: hostInferenceBaseUrl(config.inference.baseUrl)
    });
    state = await completeSetupStage(statePath, state, "preflight");
  }
  if (validateInference) {
    await validateInferenceEndpoint(config);
    state = await completeSetupStage(statePath, state, "inference-validation");
    io.output.write("Inference endpoint validation passed.\n");
  }
  if (!state.completedStages.includes("state-directories")) {
    await ensureStateDirectories(stateRoot);
    state = await completeSetupStage(statePath, state, "state-directories");
  }
  if (!state.completedStages.includes("environment")) {
    await writePrivateFileCreateOnly(
      envPath,
      renderProductionEnvironment(config, stateRoot, generateInternalSecrets())
    );
    await completeSetupStage(statePath, state, "environment");
  }
  io.output.write(`Jarvis setup preparation is complete. State: ${stateRoot}\n`);
  if (interactive) return runGuidedSetup(stateRoot, io);
  io.output.write("Run `pnpm jarvis:setup` in a terminal to continue the guided deployment.\n");
  return 0;
}

async function readConfig(configArgument) {
  const configPath = resolve(configArgument);
  await assertPrivateConfigFile(configPath);
  return JSON.parse(await readFile(configPath, "utf8"));
}

async function runGuidedSetup(stateRoot, io) {
  const { runGuidedInstall } = await import("./guided-install.mjs");
  return runGuidedInstall(stateRoot, io, {
    publishArtifacts: runSetupArtifactPublication,
    migrate: runSetupMigration,
    start: runSetupStart,
    readHiddenSecret
  });
}

export async function collectSetupConfig(input, output, createReader = createInterface) {
  if (!input.isTTY || !output.isTTY) throw new Error("Interactive setup requires a terminal.");
  const reader = createReader({ input, output });
  let config;
  try {
    const ask = (label, fallback) =>
      reader
        .question(`${label}${fallback ? ` [${fallback}]` : ""}: `)
        .then((value) => value.trim() || fallback);
    config = {
      version: 1,
      matrix: {
        serverName: await ask("Permanent Matrix server name"),
        ownerId: "",
        brainUserId: "",
        accessToken: "",
        recoveryKey: ""
      },
      deployment: {
        postgresImage: await ask(
          "PostgreSQL image digest",
          "docker.io/library/postgres:16.15-alpine3.24@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea"
        ),
        whisperModelSha256: await ask(
          "Whisper model SHA-256",
          "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b"
        )
      },
      exposure: {
        privateNetworkConfirmed:
          (await ask("Confirm private network exposure (yes/no)", "yes")) === "yes"
      },
      inference: {
        baseUrl: await ask("Inference URL reachable from this host", "http://127.0.0.1:8080/v1"),
        providerId: await ask("Reviewed Pi provider ID"),
        modelId: await ask("Model ID"),
        credentialFree: (await ask("Inference credential-free endpoint? (yes/no)", "no")) === "yes"
      }
    };
  } finally {
    reader.close();
  }
  if (!config.inference.credentialFree)
    config.inference.apiKey = await readHiddenSecret(
      input,
      output,
      "Inference API key (INFERENCE_SERVER_API_KEY)"
    );
  return config;
}

async function readHiddenSecret(input, output, label) {
  output.write(`${label} (input hidden): `);
  let value = "";
  let rawModeEnabled = false;
  try {
    input.setRawMode(true);
    rawModeEnabled = true;
    const read = new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        input.off("data", onData);
        input.off("end", onEnd);
        input.off("close", onClose);
        input.off("error", onError);
      };
      const finish = (callback, result) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback(result);
      };
      const onData = (chunk) => {
        for (const character of String(chunk)) {
          if (character === "\u0003") {
            finish(reject, new Error("Interactive setup interrupted."));
            return;
          }
          if (character === "\r" || character === "\n") {
            finish(resolve, value);
            return;
          }
          if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
          else value += character;
        }
      };
      const onEnd = () =>
        finish(reject, new Error("Secret input ended before the line was complete."));
      const onClose = () =>
        finish(reject, new Error("Secret input closed before the line was complete."));
      const onError = () =>
        finish(reject, new Error("Secret input failed before the line was complete."));
      input.on("data", onData);
      input.on("end", onEnd);
      input.on("close", onClose);
      input.on("error", onError);
    });
    input.resume();
    return await read;
  } finally {
    if (rawModeEnabled) input.setRawMode(false);
    input.pause();
    output.write("\n");
  }
}

async function confirmConfiguration(confirmed, input, output) {
  if (confirmed) return true;
  if (!input.isTTY || !output.isTTY)
    throw new Error("Pass --yes to confirm setup in a non-interactive terminal.");
  const reader = createInterface({ input, output });
  try {
    return (
      (await reader.question("Continue with this configuration? [y/N] ")).trim().toLowerCase() ===
      "y"
    );
  } finally {
    reader.close();
  }
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

async function printSetupStatus(stateRoot, output) {
  const state = await readSetupState(join(stateRoot, "setup-state.json"));
  const matrixProgress = await readMatrixProgress(stateRoot, state);
  const registrationPending = await readRegistrationPending(stateRoot);
  const statuses = [
    ["preparation", state.completedStages.includes("environment")],
    ["Matrix account and E2EE bootstrap", state.completedStages.includes("matrix-bootstrap")],
    ["runtime profile and platform catalog", state.completedStages.includes("artifacts")],
    ["database migration", state.completedStages.includes("migration")],
    [
      "initial Compose startup and configured health checks",
      state.completedStages.includes("startup-health")
    ]
  ];
  output.write(`Jarvis setup status (${stateRoot}):\n`);
  for (const [label, complete] of statuses) {
    output.write(`  ${label}: ${complete ? "complete" : "pending"}\n`);
  }
  output.write("Matrix bootstrap checkpoints (values are never displayed):\n");
  for (const [label, configured] of matrixProgress) {
    output.write(`  ${label}: ${configured ? "yes" : "no"}\n`);
  }
  for (const [account, pending] of registrationPending) {
    if (pending) output.write(`  ${account} registration needs reconciliation: yes\n`);
  }
  output.write(`Next action: ${nextSetupAction(state, matrixProgress, registrationPending)}\n`);
  output.write(
    "The startup marker records the initial Compose `up --wait` result; use `pnpm jarvis:status` for current service state.\n"
  );
}

function nextSetupAction(state, progress, registrationPending) {
  const present = new Map(progress);
  const pending = new Map(registrationPending);
  if (pending.get("brain")) {
    return "reconcile the pending Matrix registration with homeserver and protected setup state; do not retry automatically.";
  }
  if (pending.get("owner")) {
    return "run `pnpm jarvis:setup` to verify the existing owner account with its password; do not retry automatically or register it again.";
  }
  if (!state.completedStages.includes("environment")) {
    return "run `pnpm jarvis:setup` to prepare protected state.";
  }
  if (!state.completedStages.includes("artifacts")) {
    return "run `pnpm jarvis:setup` to publish release artifacts.";
  }
  if (!present.get("Owner Matrix ID")) {
    return "run `pnpm jarvis:setup` to start Matrix and register the owner.";
  }
  if (!present.get("Brain Matrix ID") || !present.get("Brain access token")) {
    return "complete Element recovery, then run `pnpm jarvis:setup` to register brain.";
  }
  if (!present.get("Brain recovery key persisted")) {
    return "run `pnpm jarvis:setup` for one-time brain E2EE recovery setup.";
  }
  if (!state.completedStages.includes("matrix-bootstrap")) {
    return "back up the brain key, review Matrix trust, then run `pnpm jarvis:setup` to seal registration.";
  }
  if (!state.completedStages.includes("migration")) {
    return "run `pnpm jarvis:setup` to migrate the database.";
  }
  if (!state.completedStages.includes("startup-health")) {
    return "run `pnpm jarvis:setup` to start the production stack.";
  }
  return "create a private owner room, invite brain, verify its device, and confirm a first encrypted reply.";
}

async function readRegistrationPending(stateRoot) {
  return Promise.all(
    ["owner", "brain"].map(async (account) => {
      const path = join(stateRoot, `production.env.${account}-registration-pending`);
      try {
        await lstat(path);
        return [account, true];
      } catch (error) {
        if (error?.code === "ENOENT") return [account, false];
        throw error;
      }
    })
  );
}

async function readMatrixProgress(stateRoot, state) {
  const names = [
    ["Owner Matrix ID", "MATRIX_OWNER_ID"],
    ["Brain Matrix ID", "MATRIX_BRAIN_USER_ID"],
    ["Brain access token", "MATRIX_ACCESS_TOKEN"],
    ["Brain recovery key persisted", "MATRIX_RECOVERY_KEY"],
    ["E2EE enabled", "MATRIX_E2EE_ENABLED"]
  ];
  const envPath = join(stateRoot, "production.env");
  let source;
  try {
    const metadata = await lstat(envPath);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && metadata.uid !== process.getuid())
    ) {
      throw new Error(
        "The protected production environment must be an owned, regular mode-0600 file."
      );
    }
    source = await readFile(envPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const envPresent = source !== undefined;
  source ??= "";
  const values = new Map();
  for (const [label, key] of names) {
    const matches = source.split(/\r?\n/u).filter((line) => line.startsWith(`${key}=`));
    let configured = matches.length === 1 && hasEnvironmentValue(matches[0].slice(key.length + 1));
    if (key === "MATRIX_E2EE_ENABLED") {
      configured =
        matches.length === 1 &&
        unquote(matches[0].slice(key.length + 1))
          .trim()
          .toLowerCase() === "true";
    }
    values.set(label, configured);
  }
  const allowRegistration = source
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("CONTINUWUITY_ALLOW_REGISTRATION="));
  const registrationToken = source
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("CONTINUWUITY_REGISTRATION_TOKEN="));
  return [
    ...values,
    [
      "Temporary registration disabled",
      allowRegistration.length === 1 &&
        unquote(allowRegistration[0].slice("CONTINUWUITY_ALLOW_REGISTRATION=".length)) === "false"
    ],
    [
      "Temporary registration token removed",
      envPresent &&
        (registrationToken.length === 0 ||
          (registrationToken.length === 1 &&
            !hasEnvironmentValue(
              registrationToken[0].slice("CONTINUWUITY_REGISTRATION_TOKEN=".length)
            )))
    ],
    ["Matrix bootstrap checkpoint", state.completedStages.includes("matrix-bootstrap")]
  ];
}

function hasEnvironmentValue(value) {
  return unquote(value).trim() !== "";
}

function unquote(value = "") {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export async function runSetupMigration(stateRoot, run = spawnSync) {
  const statePath = join(stateRoot, "setup-state.json");
  const state = await readSetupState(statePath);
  if (state.completedStages.includes("migration")) {
    return "Database migration was already completed by setup.\n";
  }
  if (!state.completedStages.includes("matrix-bootstrap")) {
    throw new Error("Complete and verify Matrix bootstrap before running database migration.");
  }
  if (!state.completedStages.includes("artifacts")) {
    throw new Error(
      "Publish and verify the runtime profile and platform catalog before migration."
    );
  }
  await assertSetupEnvironment(stateRoot);
  await assertPublishedArtifacts(stateRoot);
  const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const migrationScript = resolve(projectRoot, "scripts/migrations/apply-database-migrations.mjs");
  const result = run(
    process.execPath,
    [
      migrationScript,
      "--project-name",
      "jarvis",
      "--env-file",
      join(stateRoot, "production.env"),
      "--compose-file",
      resolve(projectRoot, "deploy/compose/compose.production.yml")
    ],
    { stdio: "inherit" }
  );
  if (result.status !== 0) {
    throw new Error(
      "Database migration did not complete. Review the migration output and rerun `pnpm jarvis:setup --migrate` after resolving the issue."
    );
  }
  await completeSetupStage(statePath, state, "migration");
  return "Database migration completed and setup state was recorded.\n";
}

export async function runSetupArtifactPublication(stateRoot, run = spawnSync) {
  const statePath = join(stateRoot, "setup-state.json");
  const state = await readSetupState(statePath);
  if (state.completedStages.includes("artifacts")) {
    await assertPublishedArtifacts(stateRoot);
    return "Runtime profile and platform catalog were already published and verified.\n";
  }
  const paths = await prepareArtifactPublication(stateRoot);
  const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const updater = resolve(projectRoot, "scripts/runtime/update-host-local-runtime-profile.mjs");
  const result = run(
    process.execPath,
    [
      updater,
      "--env-file",
      paths.envPath,
      "--runtime-profile-dir",
      paths.runtimeProfileDir,
      "--platform-catalog-dir",
      paths.platformCatalogDir,
      "--publish-only"
    ],
    { stdio: "inherit" }
  );
  if (result.status !== 0) {
    throw new Error(
      "Initial artifact publication did not complete. No setup checkpoint was recorded; rerun `pnpm jarvis:setup --publish-artifacts` after resolving the issue."
    );
  }
  await assertPublishedArtifacts(stateRoot);
  await completeSetupStage(statePath, state, "artifacts");
  return "Runtime profile and platform catalog were published, verified, and recorded.\n";
}

export async function runSetupStart(stateRoot, operator = runOperator, dependencies = {}) {
  const statePath = join(stateRoot, "setup-state.json");
  const state = await readSetupState(statePath);
  if (!state.completedStages.includes("migration")) {
    throw new Error("Complete database migration before starting Jarvis from setup.");
  }
  await assertSetupEnvironment(stateRoot);
  await assertPublishedArtifacts(stateRoot);
  const result = await operator({ command: "start", stateRoot }, dependencies);
  if (result !== 0) {
    throw new Error(
      "Jarvis operator startup did not report success; setup stage was not recorded."
    );
  }
  await (dependencies.checkInference ?? assertInferenceGatewayConnectivity)(stateRoot);
  await completeSetupStage(statePath, state, "startup-health");
  return "Initial Compose startup and container inference connectivity checks passed. Use `pnpm jarvis:status` to check current service state.\n";
}

export function assertInferenceGatewayConnectivity(stateRoot, run = spawnSync) {
  const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const probe =
    "fetch(process.env.INFERENCE_UPSTREAM_BASE_URL, { signal: AbortSignal.timeout(10000) }).then(() => process.exit(0)).catch(() => process.exit(1))";
  const result = run(
    "docker",
    [
      "compose",
      "--project-name",
      "jarvis",
      "--env-file",
      join(stateRoot, "production.env"),
      "-f",
      resolve(projectRoot, "deploy/compose/compose.production.yml"),
      "exec",
      "-T",
      "inference-gateway",
      "node",
      "-e",
      probe
    ],
    { cwd: projectRoot, encoding: "utf8", stdio: "pipe" }
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      "Production services started, but inference-gateway cannot reach its configured upstream from the container. Check INFERENCE_UPSTREAM_BASE_URL and Docker host networking, then rerun `pnpm jarvis:setup --start`."
    );
  }
}

function validateArguments(args) {
  const flags = new Set([
    "--interactive",
    "--yes",
    "--validate-inference",
    "--help",
    "--status",
    "--guide",
    "--publish-artifacts",
    "--migrate",
    "--start",
    "--seal-matrix-registration",
    "--store-matrix-recovery-key"
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (["--config", "--state-root", "--complete-stage"].includes(argument)) {
      if (!args[index + 1] || args[index + 1].startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      index += 1;
    } else if (!flags.has(argument)) {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (args.includes("--interactive") && args.includes("--config")) {
    throw new Error("Choose either --interactive or --config.");
  }
  const operationCount = [
    "--status",
    "--guide",
    "--publish-artifacts",
    "--migrate",
    "--start",
    "--complete-stage",
    "--seal-matrix-registration",
    "--store-matrix-recovery-key"
  ].filter((arg) => args.includes(arg)).length;
  if (operationCount > 1) {
    throw new Error(
      "Choose only one setup operation: --status, --guide, --publish-artifacts, --migrate, --start, --complete-stage, --seal-matrix-registration, or --store-matrix-recovery-key."
    );
  }
  if (
    operationCount > 0 &&
    (args.includes("--help") ||
      args.includes("--config") ||
      args.includes("--interactive") ||
      args.includes("--validate-inference"))
  ) {
    throw new Error(
      "Setup operations cannot be combined with help, configuration, or preparation flags."
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      const recovery =
        error?.name === "MatrixRegistrationReconciliationError" && error.account === "Owner"
          ? "Rerun pnpm jarvis:setup to verify the existing owner account with its password. Do not register it again."
          : "Rerun pnpm jarvis:setup with the same reviewed configuration.";
      process.stderr.write(`Jarvis setup failed: ${error.message}\nRecovery: ${recovery}\n`);
      process.exitCode = 1;
    });
}
