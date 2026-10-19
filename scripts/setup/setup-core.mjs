import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const setupStages = [
  "preflight",
  "inference-validation",
  "state-directories",
  "environment",
  "matrix-bootstrap",
  "artifacts",
  "migration",
  "startup-health"
];

const requiredStrings = [
  "matrix.serverName",
  "inference.baseUrl",
  "inference.providerId",
  "inference.modelId",
  "deployment.postgresImage",
  "deployment.whisperModelSha256"
];

export function defaultStateRoot({ platform = process.platform, home, xdgStateHome } = {}) {
  if (!home) throw new Error("A home directory is required to select the Jarvis state root.");
  if (platform === "darwin") return join(home, "Library", "Application Support", "Jarvis");
  if (platform === "linux") return join(xdgStateHome || join(home, ".local", "state"), "jarvis");
  throw new Error(
    `Unsupported setup platform: ${platform}. Jarvis setup supports Linux and macOS.`
  );
}

export function validateSetupConfig(value) {
  if (!isRecord(value) || value.version !== 1) throw new Error("Setup config version must be 1.");
  for (const path of requiredStrings) {
    const found = readPath(value, path);
    if (typeof found !== "string" || found.trim() === "") {
      throw new Error(`Setup config requires a non-empty ${path}.`);
    }
    if (/^<[^>]+>$/.test(found.trim()))
      throw new Error(`Setup config ${path} is still a placeholder.`);
  }
  for (const path of [
    "matrix.ownerId",
    "matrix.brainUserId",
    "matrix.accessToken",
    "matrix.recoveryKey"
  ]) {
    const found = readPath(value, path);
    if (found !== undefined && found !== "" && typeof found !== "string") {
      throw new Error(`Setup config ${path} must be a string when provided.`);
    }
    if (typeof found === "string" && /^<[^>]+>$/.test(found.trim())) {
      throw new Error(`Setup config ${path} is still a placeholder.`);
    }
  }
  if (value.exposure?.privateNetworkConfirmed !== true) {
    throw new Error("Setup config must explicitly confirm exposure.privateNetworkConfirmed=true.");
  }
  const credentialFree = value.inference?.credentialFree;
  const apiKey = value.inference?.apiKey;
  if (credentialFree !== true && (typeof apiKey !== "string" || apiKey.length === 0)) {
    throw new Error("Inference requires apiKey or credentialFree=true.");
  }
  if (credentialFree === true && typeof apiKey === "string" && apiKey.length > 0) {
    throw new Error("Inference apiKey and credentialFree=true are mutually exclusive.");
  }
  validateInferenceBaseUrl(value.inference.baseUrl);
  if (
    value.stateRoot !== undefined &&
    (typeof value.stateRoot !== "string" || !value.stateRoot.startsWith("/"))
  ) {
    throw new Error("stateRoot must be an absolute path when provided.");
  }
  if (
    value.matrix?.port !== undefined &&
    (!Number.isInteger(value.matrix.port) || value.matrix.port < 1 || value.matrix.port > 65535)
  ) {
    throw new Error("matrix.port must be an integer from 1 to 65535 when provided.");
  }
  return value;
}

export function validateInferenceBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Inference baseUrl must be an absolute HTTP or HTTPS URL.");
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error("Inference baseUrl must use HTTP or HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "Inference baseUrl cannot contain credentials, query parameters, or fragments."
    );
  }
  return url.href.replace(/\/$/u, "");
}

export async function validateInferenceEndpoint(config, fetchImplementation = fetch) {
  const baseUrl = hostInferenceBaseUrl(config.inference.baseUrl);
  const headers = { "content-type": "application/json", accept: "application/json" };
  if (!config.inference.credentialFree) {
    headers.authorization = `Bearer ${config.inference.apiKey}`;
  }
  let response;
  try {
    response = await fetchImplementation(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.inference.modelId,
        messages: [{ role: "user", content: "Reply with OK." }],
        max_tokens: 1,
        stream: false
      }),
      signal: AbortSignal.timeout(15_000)
    });
  } catch (error) {
    throw new Error(`Inference endpoint validation failed: ${error.message}`);
  }
  if (!response.ok) {
    throw new Error(`Inference endpoint validation failed with HTTP ${response.status}.`);
  }
  return true;
}

export function summarizeSetupConfig(config) {
  const redacted = redactSetupConfig(config);
  return {
    matrix: {
      serverName: redacted.matrix.serverName,
      ownerId: config.matrix.ownerId ? "<configured>" : "<pending Matrix bootstrap>",
      brainUserId: config.matrix.brainUserId ? "<configured>" : "<pending Matrix bootstrap>",
      accessToken: config.matrix.accessToken ? "<redacted>" : "<pending Matrix bootstrap>",
      recoveryKey: config.matrix.recoveryKey ? "<redacted>" : "<pending E2EE bootstrap>"
    },
    inference: {
      hostBaseUrl: hostInferenceBaseUrl(redacted.inference.baseUrl),
      containerBaseUrl: containerInferenceBaseUrl(config.inference.baseUrl),
      providerId: redacted.inference.providerId,
      modelId: redacted.inference.modelId,
      authentication: config.inference.credentialFree ? "credential-free" : "API key configured"
    },
    deployment: redacted.deployment,
    exposure: redacted.exposure,
    stateRoot: redacted.stateRoot
  };
}

export function generateInternalSecrets(random = randomBytes) {
  const secret = () => random(32).toString("base64url");
  return {
    postgresPassword: secret(),
    runtimeProvisionerToken: secret(),
    runAuthorizationSecret: secret(),
    workerCollaborationToken: secret(),
    matrixRegistrationToken: secret(),
    pluginAdminToken: secret()
  };
}

export function redactSetupConfig(config) {
  return {
    ...config,
    matrix: { ...config.matrix, accessToken: "<redacted>", recoveryKey: "<redacted>" },
    inference: {
      ...config.inference,
      ...(config.inference.apiKey === undefined ? {} : { apiKey: "<redacted>" })
    }
  };
}

export async function writePrivateFileCreateOnly(path, content) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600
    );
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporary, path).catch((error) => {
      if (error?.code === "EEXIST")
        throw new Error(`Refusing to replace existing setup file: ${path}`);
      throw error;
    });
    await rm(temporary);
    await chmod(path, 0o600);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readSetupState(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.completedStages)) {
      throw new Error("invalid state structure");
    }
    return {
      version: 1,
      completedStages: parsed.completedStages.filter((stage) => setupStages.includes(stage))
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, completedStages: [] };
    throw new Error(`Cannot read setup state at ${path}: ${error.message}`, { cause: error });
  }
}

export async function completeSetupStage(path, state, stage) {
  if (!setupStages.includes(stage)) throw new Error(`Unknown setup stage: ${stage}`);
  if (state.completedStages.includes(stage)) return state;
  const next = { version: 1, completedStages: [...state.completedStages, stage] };
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writePrivateFileCreateOnly(temporary, `${JSON.stringify(next, null, 2)}\n`);
    await rename(temporary, path);
    await chmod(path, 0o600);
    return next;
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Remove the temporary Matrix registration secret after account/E2EE values are present. */
export async function sealMatrixRegistration(stateRoot) {
  const statePath = join(stateRoot, "setup-state.json");
  const envPath = join(stateRoot, "production.env");
  const state = await readSetupState(statePath);
  if (!state.completedStages.includes("environment")) {
    throw new Error("Prepare Jarvis setup before sealing Matrix registration.");
  }

  const metadata = await lstat(envPath).catch((error) => {
    throw new Error(`Cannot safely access protected production environment: ${error.message}`, {
      cause: error
    });
  });
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

  const source = await readFile(envPath, "utf8");
  const lines = source.split(/(?<=\n)/u);
  const keys = [
    "MATRIX_OWNER_ID",
    "MATRIX_BRAIN_USER_ID",
    "MATRIX_ACCESS_TOKEN",
    "MATRIX_RECOVERY_KEY",
    "MATRIX_E2EE_ENABLED",
    "CONTINUWUITY_ALLOW_REGISTRATION",
    "CONTINUWUITY_REGISTRATION_TOKEN"
  ];
  const entries = new Map(keys.map((key) => [key, []]));
  for (const line of lines) {
    const match =
      /^(MATRIX_OWNER_ID|MATRIX_BRAIN_USER_ID|MATRIX_ACCESS_TOKEN|MATRIX_RECOVERY_KEY|MATRIX_E2EE_ENABLED|CONTINUWUITY_ALLOW_REGISTRATION|CONTINUWUITY_REGISTRATION_TOKEN)=(.*?)(?:\r?\n)?$/u.exec(
        line
      );
    if (match) entries.get(match[1]).push(match[2]);
  }
  for (const key of keys) {
    if (entries.get(key).length > 1) {
      throw new Error(
        `Refusing to seal Matrix registration: ${key} is ambiguous in production.env.`
      );
    }
  }
  for (const key of keys.slice(0, 4)) {
    if (entries.get(key).length !== 1 || decodeEnvValue(entries.get(key)[0]).trim() === "") {
      throw new Error(`Refusing to seal Matrix registration: ${key} must be configured first.`);
    }
  }
  if (
    entries.get("MATRIX_E2EE_ENABLED").length !== 1 ||
    decodeEnvValue(entries.get("MATRIX_E2EE_ENABLED")[0]) !== "true"
  ) {
    throw new Error("Refusing to seal Matrix registration: MATRIX_E2EE_ENABLED must be true.");
  }
  const allowRegistration = entries.get("CONTINUWUITY_ALLOW_REGISTRATION");
  if (allowRegistration.length !== 1) {
    throw new Error(
      "Refusing to seal Matrix registration: CONTINUWUITY_ALLOW_REGISTRATION must appear exactly once."
    );
  }
  const registrationEnabled = decodeEnvValue(allowRegistration[0]);
  if (registrationEnabled !== "true" && registrationEnabled !== "false") {
    throw new Error(
      "Refusing to seal Matrix registration: CONTINUWUITY_ALLOW_REGISTRATION must be true or false."
    );
  }

  const nextSource = lines
    .filter((line) => !line.startsWith("CONTINUWUITY_REGISTRATION_TOKEN="))
    .map((line) => {
      if (registrationEnabled !== "true" || !line.startsWith("CONTINUWUITY_ALLOW_REGISTRATION=")) {
        return line;
      }
      const newline = line.match(/\r?\n$/u)?.[0] ?? "";
      return `CONTINUWUITY_ALLOW_REGISTRATION='false'${newline}`;
    })
    .join("");
  if (nextSource !== source)
    await replacePrivateFileAtomically(envPath, nextSource, metadata.mode & 0o777);

  // Re-run the canonical readiness checks after the atomic write before persisting the checkpoint.
  const { assertSetupEnvironment } = await import("./install-readiness.mjs");
  await assertSetupEnvironment(stateRoot);
  return completeSetupStage(statePath, state, "matrix-bootstrap");
}

/** Persist the one-time brain recovery key without exposing it to argv or output. */
export async function matrixRecoveryKeyPresent(stateRoot) {
  const { recoveryKeyPresent } = await readMatrixRecoveryEnvironment(stateRoot);
  return recoveryKeyPresent;
}

export async function storeMatrixRecoveryKey(stateRoot, recoveryKey) {
  if (typeof recoveryKey !== "string" || recoveryKey.trim() === "") {
    throw new Error("A non-empty Matrix recovery key is required.");
  }
  if (/[\r\n]/u.test(recoveryKey)) throw new Error("Recovery key cannot contain newlines.");

  const { envPath, source, lines, recoveryKeyPresent } =
    await readMatrixRecoveryEnvironment(stateRoot);
  if (recoveryKeyPresent) return { stored: false, alreadyPresent: true };

  const nextSource = lines
    .map((line) => {
      if (!line.startsWith("MATRIX_RECOVERY_KEY=")) return line;
      const newline = line.match(/\r?\n$/u)?.[0] ?? "";
      return `MATRIX_RECOVERY_KEY=${escapeEnv(recoveryKey)}${newline}`;
    })
    .join("");
  // Revalidate the destination immediately before replacement to catch an
  // environment file swapped after the no-follow read above.
  const current = await lstat(envPath);
  if (
    !current.isFile() ||
    current.isSymbolicLink() ||
    (current.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && current.uid !== process.getuid())
  ) {
    throw new Error(
      "The protected production environment must be an owned, regular mode-0600 file."
    );
  }
  await replacePrivateFileAtomically(envPath, nextSource, 0o600);
  // Re-check the path and value after the write; never echo the key.
  const written = await readOwnedPrivateEnvironment(envPath);
  const writtenLines = written
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("MATRIX_RECOVERY_KEY="));
  if (
    writtenLines.length !== 1 ||
    decodeEnvValue(writtenLines[0].slice("MATRIX_RECOVERY_KEY=".length)) !== recoveryKey
  ) {
    throw new Error("Matrix recovery key persistence could not be verified.");
  }
  return { stored: true, alreadyPresent: false };
}

async function readMatrixRecoveryEnvironment(stateRoot) {
  const statePath = join(stateRoot, "setup-state.json");
  const envPath = join(stateRoot, "production.env");
  const state = await readSetupState(statePath);
  if (!state.completedStages.includes("environment")) {
    throw new Error("Prepare Jarvis setup before storing the Matrix recovery key.");
  }

  const source = await readOwnedPrivateEnvironment(envPath);
  const lines = source.split(/(?<=\n)/u);
  const required = ["MATRIX_OWNER_ID", "MATRIX_BRAIN_USER_ID", "MATRIX_ACCESS_TOKEN"];
  const entries = new Map(
    [...required, "MATRIX_E2EE_ENABLED", "MATRIX_RECOVERY_KEY"].map((key) => [key, []])
  );
  for (const line of lines) {
    const match =
      /^(MATRIX_OWNER_ID|MATRIX_BRAIN_USER_ID|MATRIX_ACCESS_TOKEN|MATRIX_E2EE_ENABLED|MATRIX_RECOVERY_KEY)=(.*?)(?:\r?\n)?$/u.exec(
        line
      );
    if (match) entries.get(match[1]).push(match[2]);
  }
  for (const key of [...required, "MATRIX_E2EE_ENABLED", "MATRIX_RECOVERY_KEY"]) {
    if (entries.get(key).length !== 1) {
      throw new Error(
        `Cannot store Matrix recovery key: ${key} must appear exactly once in production.env.`
      );
    }
  }
  for (const key of required) {
    if (decodeEnvValue(entries.get(key)[0]).trim() === "") {
      throw new Error(`Cannot store Matrix recovery key: ${key} must be configured first.`);
    }
  }
  if (decodeEnvValue(entries.get("MATRIX_E2EE_ENABLED")[0]) !== "true") {
    throw new Error("Cannot store Matrix recovery key: MATRIX_E2EE_ENABLED must be true.");
  }
  return {
    envPath,
    source,
    lines,
    entries,
    recoveryKeyPresent: decodeEnvValue(entries.get("MATRIX_RECOVERY_KEY")[0]).trim() !== ""
  };
}

async function readOwnedPrivateEnvironment(path) {
  const directory = await lstat(dirname(path)).catch((error) => {
    throw new Error(`Cannot safely access protected setup directory: ${error.message}`, {
      cause: error
    });
  });
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    (directory.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && directory.uid !== process.getuid())
  ) {
    throw new Error("The protected setup directory must be an owned, regular mode-0700 directory.");
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(
    (error) => {
      throw new Error(`Cannot safely access protected production environment: ${error.message}`, {
        cause: error
      });
    }
  );
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      (metadata.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && metadata.uid !== process.getuid())
    ) {
      throw new Error(
        "The protected production environment must be an owned, regular mode-0600 file."
      );
    }
    return await handle.readFile({ encoding: "utf8" });
  } finally {
    await handle.close();
  }
}

/** Read setup values only after checking the protected directory and file. */
export async function readSetupEnvironmentValues(stateRoot) {
  const source = await readOwnedPrivateEnvironment(join(stateRoot, "production.env"));
  const values = new Map();
  for (const line of source.split(/\r?\n/u)) {
    if (line === "" || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (!match) throw new Error("Protected production environment contains an invalid line.");
    if (values.has(match[1])) {
      throw new Error(`Protected production environment has duplicate ${match[1]}.`);
    }
    values.set(match[1], decodeEnvValue(match[2]));
  }
  return values;
}

/** Remove a configured owner ID only after the caller proves the homeserver has no users. */
export async function clearUnregisteredOwnerId(stateRoot, expectedOwnerId) {
  const values = await readSetupEnvironmentValues(stateRoot);
  if (
    !expectedOwnerId ||
    values.get("MATRIX_OWNER_ID") !== expectedOwnerId ||
    values.get("MATRIX_BRAIN_USER_ID") ||
    values.get("MATRIX_ACCESS_TOKEN") ||
    values.get("MATRIX_RECOVERY_KEY")
  ) {
    throw new Error("Cannot clear the owner ID after Matrix account bootstrap has progressed.");
  }
  const path = join(stateRoot, "production.env");
  const source = await readOwnedPrivateEnvironment(path);
  const nextSource = source.replace(/^MATRIX_OWNER_ID=[^\r\n]*/mu, "MATRIX_OWNER_ID=''");
  if (nextSource === source) throw new Error("Protected setup state has no owner ID to clear.");
  await replacePrivateFileAtomically(path, nextSource, 0o600);
}

function decodeEnvValue(value) {
  const trimmed = value.trim();
  if (trimmed === "''" || trimmed === '""') return "";
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("'\\''", "'");
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
  if (/\s/u.test(trimmed) || trimmed.includes("#")) {
    throw new Error(
      "Refusing to seal Matrix registration: a required environment value is ambiguous."
    );
  }
  return trimmed;
}

async function replacePrivateFileAtomically(path, content, mode) {
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600
    );
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporary, mode);
    await rename(temporary, path);
    const directory = await open(dirname(path), constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function renderProductionEnvironment(config, stateRoot, secrets) {
  const values = {
    POSTGRES_IMAGE: config.deployment.postgresImage,
    WHISPER_CPP_MODEL_SHA256: config.deployment.whisperModelSha256,
    POSTGRES_PASSWORD: secrets.postgresPassword,
    RUNTIME_PROVISIONER_TOKEN: secrets.runtimeProvisionerToken,
    RUN_AUTHORIZATION_SECRET: secrets.runAuthorizationSecret,
    BRAIN_CONTROL_WORKER_COLLABORATION_TOKEN: secrets.workerCollaborationToken,
    RUNTIME_PROFILE_DIR: join(stateRoot, "runtime-profile"),
    PLATFORM_CATALOG_DIR: join(stateRoot, "platform-catalog"),
    PI_MODEL_PROVIDER_ID: config.inference.providerId,
    PI_MODEL_ID: config.inference.modelId,
    INFERENCE_UPSTREAM_BASE_URL: containerInferenceBaseUrl(config.inference.baseUrl),
    INFERENCE_SERVER_API_KEY: config.inference.credentialFree ? "" : config.inference.apiKey,
    MATRIX_SERVER_NAME: config.matrix.serverName,
    MATRIX_HOST_PORT: config.matrix.port ?? 8008,
    CONTINUWUITY_ALLOW_REGISTRATION: "false",
    CONTINUWUITY_REGISTRATION_TOKEN: secrets.matrixRegistrationToken,
    MATRIX_ACCESS_TOKEN: config.matrix.accessToken ?? "",
    MATRIX_OWNER_ID: config.matrix.ownerId ?? "",
    MATRIX_BRAIN_USER_ID: config.matrix.brainUserId ?? "",
    MATRIX_E2EE_ENABLED: "true",
    MATRIX_RECOVERY_KEY: config.matrix.recoveryKey ?? "",
    BRAIN_CONTROL_PLUGIN_ADMIN_TOKEN: secrets.pluginAdminToken
  };
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${escapeEnv(value)}`)
    .join("\n")}\n`;
}

export function containerInferenceBaseUrl(value) {
  const url = new URL(validateInferenceBaseUrl(value));
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    url.hostname = "host.docker.internal";
  }
  return url.href.replace(/\/$/u, "");
}

export function hostInferenceBaseUrl(value) {
  const url = new URL(validateInferenceBaseUrl(value));
  if (url.hostname === "host.docker.internal") url.hostname = "127.0.0.1";
  return url.href.replace(/\/$/u, "");
}

export async function ensureStateDirectories(stateRoot) {
  for (const name of ["runtime-profile", "platform-catalog"]) {
    await mkdir(join(stateRoot, name), { recursive: true, mode: 0o700 });
  }
}

export function resolveStateRoot(config, environment = process.env, platform = process.platform) {
  return resolve(
    config.stateRoot ??
      defaultStateRoot({
        platform,
        home: environment.HOME,
        xdgStateHome: environment.XDG_STATE_HOME
      })
  );
}

export async function assertPrivateConfigFile(path) {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`Setup config is not a regular file: ${path}`);
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error(`Setup config contains credentials and must have mode 0600: ${path}`);
  }
}

function escapeEnv(value) {
  const text = String(value ?? "");
  if (text.includes("\n") || text.includes("\r"))
    throw new Error("Environment values cannot contain newlines.");
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPath(value, path) {
  return path
    .split(".")
    .reduce((current, part) => (isRecord(current) ? current[part] : undefined), value);
}
