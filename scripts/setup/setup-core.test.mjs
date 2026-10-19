import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertInferenceGatewayConnectivity,
  collectSetupConfig,
  main,
  runSetupArtifactPublication,
  runSetupMigration,
  runSetupStart
} from "./jarvis-setup.mjs";
import { runPreflight } from "./preflight.mjs";
import { writeValidReleaseArtifacts } from "./test-artifact-fixtures.mjs";
import {
  assertPrivateConfigFile,
  clearUnregisteredOwnerId,
  completeSetupStage,
  containerInferenceBaseUrl,
  defaultStateRoot,
  generateInternalSecrets,
  hostInferenceBaseUrl,
  readSetupState,
  redactSetupConfig,
  renderProductionEnvironment,
  summarizeSetupConfig,
  storeMatrixRecoveryKey,
  validateInferenceBaseUrl,
  validateInferenceEndpoint,
  validateSetupConfig,
  writePrivateFileCreateOnly
} from "./setup-core.mjs";

const validConfig = {
  version: 1,
  matrix: {
    serverName: "matrix.example.test",
    ownerId: "@owner:example.test",
    brainUserId: "@jarvis:example.test",
    accessToken: "secret-access",
    recoveryKey: "secret-recovery"
  },
  inference: {
    baseUrl: "http://127.0.0.1:8080/v1",
    providerId: "local",
    modelId: "model",
    credentialFree: true
  },
  deployment: { postgresImage: "postgres@sha256:abc", whisperModelSha256: "abc123" },
  exposure: { privateNetworkConfirmed: true }
};

test("selects platform state roots", () => {
  assert.equal(
    defaultStateRoot({ platform: "linux", home: "/home/me" }),
    "/home/me/.local/state/jarvis"
  );
  assert.equal(
    defaultStateRoot({ platform: "linux", home: "/home/me", xdgStateHome: "/state" }),
    "/state/jarvis"
  );
  assert.equal(
    defaultStateRoot({ platform: "darwin", home: "/Users/me" }),
    "/Users/me/Library/Application Support/Jarvis"
  );
  assert.throws(() => defaultStateRoot({ platform: "win32", home: "C:" }), /Unsupported/);
});

test("requires explicit identity, credential, and exposure decisions", () => {
  assert.equal(validateSetupConfig(validConfig), validConfig);
  assert.throws(() => validateSetupConfig({ ...validConfig, exposure: {} }), /explicitly confirm/);
  assert.throws(
    () =>
      validateSetupConfig({
        ...validConfig,
        matrix: { ...validConfig.matrix, ownerId: "<owner>" }
      }),
    /placeholder/
  );
  assert.throws(
    () =>
      validateSetupConfig({
        ...validConfig,
        inference: { ...validConfig.inference, credentialFree: false }
      }),
    /apiKey/
  );
});

test("example setup config explicitly leaves private network confirmation unapproved", async () => {
  const example = JSON.parse(
    await readFile(
      new URL("../../deploy/compose/setup.config.example.json", import.meta.url),
      "utf8"
    )
  );
  assert.equal(example.exposure.privateNetworkConfirmed, false);
  assert.throws(
    () => validateSetupConfig({ ...validConfig, exposure: example.exposure }),
    /explicitly confirm/
  );
});

test("no-argument setup reports how to continue without a terminal", async () => {
  let output = "";
  const code = await main([], {
    input: { isTTY: false },
    output: { isTTY: false, write: (text) => (output += text) }
  });
  assert.equal(code, 2);
  assert.match(output, /no terminal detected/i);
  assert.match(output, /--config <setup\.json> --yes/u);
});

test("allows setup before Matrix accounts exist and leaves their fields empty", () => {
  const config = {
    ...validConfig,
    matrix: { serverName: validConfig.matrix.serverName }
  };
  assert.equal(validateSetupConfig(config), config);
  const environment = renderProductionEnvironment(config, "/state/jarvis", {
    postgresPassword: "p",
    runtimeProvisionerToken: "r",
    runAuthorizationSecret: "a",
    workerCollaborationToken: "w",
    matrixRegistrationToken: "m",
    pluginAdminToken: "g"
  });
  assert.match(environment, /MATRIX_ACCESS_TOKEN=''\n/u);
  assert.match(environment, /MATRIX_OWNER_ID=''\n/u);
  assert.match(environment, /MATRIX_BRAIN_USER_ID=''\n/u);
  assert.match(environment, /MATRIX_RECOVERY_KEY=''\n/u);
  assert.match(environment, /MATRIX_HOST_PORT='8008'\n/u);
  assert.match(
    environment,
    /INFERENCE_UPSTREAM_BASE_URL='http:\/\/host\.docker\.internal:8080\/v1'\n/u
  );
});

test("validates inference URLs and probes configured credentials", async () => {
  assert.equal(
    hostInferenceBaseUrl("http://host.docker.internal:8080/v1"),
    "http://127.0.0.1:8080/v1"
  );
  assert.equal(
    hostInferenceBaseUrl("https://model.private.test:8443/v1"),
    "https://model.private.test:8443/v1"
  );
  assert.equal(
    containerInferenceBaseUrl("http://127.0.0.1:8080/v1"),
    "http://host.docker.internal:8080/v1"
  );
  assert.equal(
    containerInferenceBaseUrl("https://model.private.test:8443/v1"),
    "https://model.private.test:8443/v1"
  );
  assert.equal(validateInferenceBaseUrl("http://127.0.0.1:8080/v1/"), "http://127.0.0.1:8080/v1");
  assert.throws(() => validateInferenceBaseUrl("ftp://model.test/v1"), /HTTP or HTTPS/);
  assert.throws(() => validateInferenceBaseUrl("http://user:pass@model.test/v1"), /credentials/);
  let request;
  await validateInferenceEndpoint(validConfig, async (url, options) => {
    request = { url, options };
    return new Response("{}", { status: 200 });
  });
  assert.equal(request.url, "http://127.0.0.1:8080/v1/chat/completions");
  assert.equal(request.options.headers.authorization, undefined);
  await validateInferenceEndpoint(
    {
      ...validConfig,
      inference: {
        ...validConfig.inference,
        baseUrl: "http://host.docker.internal:8080/v1",
        credentialFree: false,
        apiKey: "top-secret"
      }
    },
    async (url, options) => {
      assert.equal(url, "http://127.0.0.1:8080/v1/chat/completions");
      assert.equal(options.headers.authorization, "Bearer top-secret");
      return new Response("{}", { status: 200 });
    }
  );
  await assert.rejects(
    validateInferenceEndpoint(validConfig, async () => new Response("no", { status: 401 })),
    /HTTP 401/
  );
});

test("review summary keeps every credential redacted", () => {
  const review = summarizeSetupConfig({
    ...validConfig,
    inference: { ...validConfig.inference, apiKey: "private-api-key", credentialFree: false }
  });
  assert.equal(review.inference.hostBaseUrl, "http://127.0.0.1:8080/v1");
  assert.equal(review.inference.containerBaseUrl, "http://host.docker.internal:8080/v1");
  const dockerUrlReview = summarizeSetupConfig({
    ...validConfig,
    inference: { ...validConfig.inference, baseUrl: "http://host.docker.internal:8080/v1" }
  });
  assert.equal(dockerUrlReview.inference.hostBaseUrl, "http://127.0.0.1:8080/v1");
  assert.equal(dockerUrlReview.inference.containerBaseUrl, "http://host.docker.internal:8080/v1");
  const summary = JSON.stringify(review);
  for (const secret of ["secret-access", "secret-recovery", "private-api-key"]) {
    assert.equal(summary.includes(secret), false);
  }
});

test("clears only an unregistered owner ID from protected setup state", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-owner-id-"));
  const path = join(root, "production.env");
  await writeFile(
    path,
    "MATRIX_OWNER_ID='@owner:matrix.example.test'\nMATRIX_BRAIN_USER_ID=''\nMATRIX_ACCESS_TOKEN=''\nMATRIX_RECOVERY_KEY=''\nINFERENCE_SERVER_API_KEY='private-key'\n",
    { mode: 0o600 }
  );
  await clearUnregisteredOwnerId(root, "@owner:matrix.example.test");
  const source = await readFile(path, "utf8");
  assert.match(source, /^MATRIX_OWNER_ID=''$/mu);
  assert.match(source, /^INFERENCE_SERVER_API_KEY='private-key'$/mu);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await assert.rejects(
    clearUnregisteredOwnerId(root, "@owner:matrix.example.test"),
    /Cannot clear the owner ID/u
  );
});

test("interactive setup uses the requested yes/no defaults and asks for the hidden inference key", async () => {
  const input = new EventEmitter();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.resume = () => {};
  input.pause = () => {};
  const prompts = [];
  const answers = ["matrix.example.test", "", "", "", "", "local", "model", ""];
  const output = {
    isTTY: true,
    write(value) {
      if (value.includes("input hidden")) queueMicrotask(() => input.emit("data", "private-key\n"));
      prompts.push(value);
    }
  };
  const config = await collectSetupConfig(input, output, () => ({
    question(prompt) {
      prompts.push(prompt);
      return Promise.resolve(answers.shift());
    },
    close() {}
  }));
  assert.equal(config.inference.credentialFree, false);
  assert.equal(config.exposure.privateNetworkConfirmed, true);
  assert.equal(config.inference.apiKey, "private-key");
  assert.equal(config.matrix.ownerId, "");
  assert.equal(config.matrix.brainUserId, "");
  assert.match(prompts[3], /Confirm private network exposure \(yes\/no\) \[yes\]/u);
  assert.match(prompts.at(-3), /Inference credential-free endpoint/u);
  assert.match(prompts.at(-3), /\[no\]/u);
  assert.match(prompts.at(-2), /INFERENCE_SERVER_API_KEY.*input hidden/u);
  assert.deepEqual(answers, []);
});

test("generates independent secrets and redacts operator credentials", () => {
  let byte = 0;
  const secrets = generateInternalSecrets((length) => Buffer.alloc(length, byte++));
  assert.equal(new Set(Object.values(secrets)).size, 6);
  const redacted = redactSetupConfig({
    ...validConfig,
    inference: { ...validConfig.inference, apiKey: "secret-key", credentialFree: false }
  });
  assert.equal(redacted.matrix.accessToken, "<redacted>");
  assert.equal(redacted.matrix.recoveryKey, "<redacted>");
  assert.equal(redacted.inference.apiKey, "<redacted>");
});

test("private writes are create-only and mode 0600", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-setup-"));
  const path = join(root, "nested", "environment");
  await writePrivateFileCreateOnly(path, "first\n");
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await assert.rejects(writePrivateFileCreateOnly(path, "second\n"), /Refusing to replace/);
  assert.equal(await readFile(path, "utf8"), "first\n");
});

test("rejects a credential-bearing config with broad permissions", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-config-"));
  const path = join(root, "setup.json");
  await writeFile(path, "{}", { mode: 0o644 });
  await assert.rejects(assertPrivateConfigFile(path), /mode 0600/);
  await chmod(path, 0o600);
  await assert.doesNotReject(assertPrivateConfigFile(path));
});

test("setup stages resume without duplicating completed stages", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-state-"));
  const path = join(root, "setup-state.json");
  let state = await readSetupState(path);
  state = await completeSetupStage(path, state, "preflight");
  const unchanged = await completeSetupStage(path, state, "preflight");
  assert.deepEqual(unchanged.completedStages, ["preflight"]);
  assert.deepEqual((await readSetupState(path)).completedStages, ["preflight"]);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("setup status reports named post-preparation stages without claiming completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-setup-status-"));
  const path = join(root, "setup-state.json");
  let state = await readSetupState(path);
  state = await completeSetupStage(path, state, "environment");
  let output = "";
  assert.equal(
    await main(["--status", "--state-root", root], {
      input: { isTTY: false },
      output: { write: (text) => (output += text) }
    }),
    0
  );
  assert.match(output, /preparation: complete/u);
  assert.match(output, /Matrix account and E2EE bootstrap: pending/u);
  assert.match(output, /database migration: pending/u);
  assert.match(output, /initial Compose startup and configured health checks: pending/u);
  assert.match(output, /Brain recovery key persisted: no/u);
  assert.match(output, /Temporary registration token removed: no/u);
});

test("setup status directs a pending registration to reconciliation", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-setup-pending-owner-"));
  await writeFile(
    join(root, "setup-state.json"),
    JSON.stringify({ version: 1, completedStages: ["environment", "artifacts"] }),
    { mode: 0o600 }
  );
  await writeFile(join(root, "production.env.owner-registration-pending"), "pending\n", {
    mode: 0o600
  });
  let output = "";
  await main(["--status", "--state-root", root], {
    input: { isTTY: false },
    output: { write: (text) => (output += text) }
  });
  assert.match(output, /owner registration needs reconciliation: yes/u);
  assert.match(output, /do not retry automatically/u);
});

test("setup status shows resumable Matrix checkpoints without displaying credential values", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-setup-matrix-progress-"));
  await writeFile(
    join(root, "setup-state.json"),
    `${JSON.stringify({ version: 1, completedStages: ["environment"] })}\n`,
    { mode: 0o600 }
  );
  const secrets = ["access-never-display", "recovery-never-display", "registration-never-display"];
  await writeFile(
    join(root, "production.env"),
    [
      "MATRIX_OWNER_ID='@owner:test'",
      "MATRIX_BRAIN_USER_ID='@brain:test'",
      `MATRIX_ACCESS_TOKEN='${secrets[0]}'`,
      `MATRIX_RECOVERY_KEY='${secrets[1]}'`,
      "MATRIX_E2EE_ENABLED='true'",
      "CONTINUWUITY_ALLOW_REGISTRATION='true'",
      `CONTINUWUITY_REGISTRATION_TOKEN='${secrets[2]}'`
    ].join("\n") + "\n",
    { mode: 0o600 }
  );
  let output = "";
  assert.equal(
    await main(["--status", "--state-root", root], {
      input: { isTTY: false },
      output: { write: (text) => (output += text) }
    }),
    0
  );
  for (const label of [
    "Owner Matrix ID",
    "Brain Matrix ID",
    "Brain access token",
    "Brain recovery key persisted",
    "E2EE enabled"
  ])
    assert.match(output, new RegExp(`${label}: yes`, "u"));
  assert.match(output, /Temporary registration disabled: no/u);
  assert.match(output, /Temporary registration token removed: no/u);
  for (const secret of secrets) assert.equal(output.includes(secret), false);
});

test("stores a Matrix recovery key atomically, privately, and without rotating an existing value", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-recovery-key-"));
  await writeFile(
    join(root, "setup-state.json"),
    JSON.stringify({ version: 1, completedStages: ["environment"] }),
    { mode: 0o600 }
  );
  const envPath = join(root, "production.env");
  await writeFile(
    envPath,
    [
      "MATRIX_OWNER_ID='@owner:test'",
      "MATRIX_BRAIN_USER_ID='@brain:test'",
      "MATRIX_ACCESS_TOKEN='access-token'",
      "MATRIX_E2EE_ENABLED='true'",
      "MATRIX_RECOVERY_KEY=''",
      "OTHER_SETTING='unchanged'"
    ].join("\n") + "\n",
    { mode: 0o600 }
  );

  assert.deepEqual(await storeMatrixRecoveryKey(root, "recovery key 'quoted'"), {
    stored: true,
    alreadyPresent: false
  });
  const persisted = await readFile(envPath, "utf8");
  assert.ok(persisted.includes("MATRIX_RECOVERY_KEY='recovery key '\\''quoted'\\'''\n"));
  assert.match(persisted, /OTHER_SETTING='unchanged'/u);
  assert.equal((await stat(envPath)).mode & 0o777, 0o600);
  assert.deepEqual(await storeMatrixRecoveryKey(root, "replacement-key"), {
    stored: false,
    alreadyPresent: true
  });
  assert.equal(await readFile(envPath, "utf8"), persisted);
});

test("recovery-key setup requires recorded environment and complete account/E2EE prerequisites", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-recovery-prereq-"));
  const statePath = join(root, "setup-state.json");
  const envPath = join(root, "production.env");
  await writeFile(statePath, JSON.stringify({ version: 1, completedStages: [] }), { mode: 0o600 });
  await writeFile(envPath, "", { mode: 0o600 });
  await assert.rejects(storeMatrixRecoveryKey(root, "secret"), /Prepare Jarvis setup/);
  await writeFile(statePath, JSON.stringify({ version: 1, completedStages: ["environment"] }), {
    mode: 0o600
  });
  await writeFile(
    envPath,
    "MATRIX_OWNER_ID='@owner:test'\nMATRIX_BRAIN_USER_ID=''\nMATRIX_ACCESS_TOKEN='token'\nMATRIX_E2EE_ENABLED='true'\nMATRIX_RECOVERY_KEY=''\n",
    { mode: 0o600 }
  );
  await assert.rejects(
    storeMatrixRecoveryKey(root, "secret"),
    /MATRIX_BRAIN_USER_ID must be configured/
  );
  await writeFile(
    envPath,
    "MATRIX_OWNER_ID='@owner:test'\nMATRIX_BRAIN_USER_ID='@brain:test'\nMATRIX_ACCESS_TOKEN='token'\nMATRIX_E2EE_ENABLED='false'\nMATRIX_RECOVERY_KEY=''\n",
    { mode: 0o600 }
  );
  await assert.rejects(storeMatrixRecoveryKey(root, "secret"), /MATRIX_E2EE_ENABLED must be true/);
});

test("recovery-key persistence rejects permissive files and symlinked environments", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-recovery-files-"));
  await writeFile(
    join(root, "setup-state.json"),
    JSON.stringify({ version: 1, completedStages: ["environment"] }),
    { mode: 0o600 }
  );
  const envPath = join(root, "production.env");
  const validEnvironment =
    "MATRIX_OWNER_ID='@owner:test'\nMATRIX_BRAIN_USER_ID='@brain:test'\nMATRIX_ACCESS_TOKEN='access'\nMATRIX_E2EE_ENABLED='true'\nMATRIX_RECOVERY_KEY=''\n";
  await writeFile(envPath, validEnvironment, { mode: 0o640 });
  await assert.rejects(storeMatrixRecoveryKey(root, "secret"), /mode-0600 file/);
  await chmod(envPath, 0o600);
  const target = join(root, "real.env");
  await writeFile(target, validEnvironment, { mode: 0o600 });
  const { symlink, unlink } = await import("node:fs/promises");
  await unlink(envPath);
  await symlink(target, envPath);
  await assert.rejects(
    storeMatrixRecoveryKey(root, "secret"),
    /Cannot safely access protected production environment/
  );
});

test("recovery-key persistence requires an owner-only state directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-recovery-dir-"));
  await writeFile(
    join(root, "setup-state.json"),
    JSON.stringify({ version: 1, completedStages: ["environment"] }),
    { mode: 0o600 }
  );
  await writeFile(
    join(root, "production.env"),
    "MATRIX_OWNER_ID='@owner:test'\nMATRIX_BRAIN_USER_ID='@brain:test'\nMATRIX_ACCESS_TOKEN='access'\nMATRIX_E2EE_ENABLED='true'\nMATRIX_RECOVERY_KEY=''\n",
    { mode: 0o600 }
  );
  await chmod(root, 0o755);
  await assert.rejects(storeMatrixRecoveryKey(root, "secret"), /mode-0700 directory/);
});

test("hidden recovery-key command writes without echoing the secret", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-recovery-cli-"));
  await writeFile(
    join(root, "setup-state.json"),
    JSON.stringify({ version: 1, completedStages: ["environment"] }),
    { mode: 0o600 }
  );
  await writeFile(
    join(root, "production.env"),
    "MATRIX_OWNER_ID='@owner:test'\nMATRIX_BRAIN_USER_ID='@brain:test'\nMATRIX_ACCESS_TOKEN='access'\nMATRIX_E2EE_ENABLED='true'\nMATRIX_RECOVERY_KEY=''\n",
    { mode: 0o600 }
  );
  const input = new EventEmitter();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.resume = () => {};
  input.pause = () => {};
  let output = "";
  let hiddenPrompt = 0;
  assert.equal(
    await main(["--store-matrix-recovery-key", "--state-root", root], {
      input,
      output: {
        isTTY: true,
        write: (text) => {
          output += text;
          if (text.includes("input hidden")) {
            const nextValue =
              hiddenPrompt++ === 0 ? "never-print-this-key" : "never-print-this-key";
            setImmediate(() => input.emit("data", `${nextValue}\r`));
          }
        }
      }
    }),
    0
  );
  assert.equal(output.includes("never-print-this-key"), false);
  assert.match(output, /Confirm brain Matrix recovery key/u);
  assert.equal(
    (await readFile(join(root, "production.env"), "utf8")).includes("never-print-this-key"),
    true
  );
});

test("hidden recovery-key input restores terminal mode and cleans listeners on EOF, close, error, and interrupt", async () => {
  const cases = [
    { event: "end", error: /ended before the line was complete/ },
    { event: "close", error: /closed before the line was complete/ },
    { event: "error", error: /failed before the line was complete/ },
    { event: "data", value: "\u0003", error: /interrupted/ }
  ];
  for (const [index, scenario] of cases.entries()) {
    const root = await mkdtemp(join(tmpdir(), `jarvis-recovery-input-${index}-`));
    await writeFile(
      join(root, "setup-state.json"),
      JSON.stringify({ version: 1, completedStages: ["environment"] }),
      { mode: 0o600 }
    );
    await writeFile(
      join(root, "production.env"),
      "MATRIX_OWNER_ID='@owner:test'\nMATRIX_BRAIN_USER_ID='@brain:test'\nMATRIX_ACCESS_TOKEN='access'\nMATRIX_E2EE_ENABLED='true'\nMATRIX_RECOVERY_KEY=''\n",
      { mode: 0o600 }
    );
    const input = new EventEmitter();
    input.isTTY = true;
    const rawModes = [];
    let pauses = 0;
    input.setRawMode = (enabled) => rawModes.push(enabled);
    input.resume = () => {};
    input.pause = () => {
      pauses += 1;
    };
    await assert.rejects(
      main(["--store-matrix-recovery-key", "--state-root", root], {
        input,
        output: {
          isTTY: true,
          write: (text) => {
            if (text.includes("input hidden")) {
              setImmediate(() =>
                input.emit(
                  scenario.event,
                  ...(scenario.event === "error" ? [new Error("private detail")] : [scenario.value])
                )
              );
            }
          }
        }
      }),
      scenario.error
    );
    assert.deepEqual(rawModes, [true, false]);
    assert.equal(pauses, 1);
    for (const event of ["data", "end", "close", "error"])
      assert.equal(input.listenerCount(event), 0, `${event} listener should be removed`);
    assert.equal(
      (await readFile(join(root, "production.env"), "utf8")).includes("MATRIX_RECOVERY_KEY=''"),
      true
    );
  }
});

test("already-persisted recovery key returns without prompting again", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-recovery-no-prompt-"));
  await writeFile(
    join(root, "setup-state.json"),
    JSON.stringify({ version: 1, completedStages: ["environment"] }),
    { mode: 0o600 }
  );
  const envPath = join(root, "production.env");
  const original =
    "MATRIX_OWNER_ID='@owner:test'\nMATRIX_BRAIN_USER_ID='@brain:test'\nMATRIX_ACCESS_TOKEN='access'\nMATRIX_E2EE_ENABLED='true'\nMATRIX_RECOVERY_KEY='existing-key'\n";
  await writeFile(envPath, original, { mode: 0o600 });
  const input = new EventEmitter();
  input.isTTY = true;
  input.setRawMode = () => {
    throw new Error("must not prompt");
  };
  let output = "";
  assert.equal(
    await main(["--store-matrix-recovery-key", "--state-root", root], {
      input,
      output: { isTTY: true, write: (text) => (output += text) }
    }),
    0
  );
  assert.match(output, /already present/u);
  assert.equal(output.includes("input hidden"), false);
  assert.equal(await readFile(envPath, "utf8"), original);
});

test("recovery-key confirmation mismatch writes nothing and redacts both entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-recovery-mismatch-"));
  await writeFile(
    join(root, "setup-state.json"),
    JSON.stringify({ version: 1, completedStages: ["environment"] }),
    { mode: 0o600 }
  );
  const envPath = join(root, "production.env");
  const original =
    "MATRIX_OWNER_ID='@owner:test'\nMATRIX_BRAIN_USER_ID='@brain:test'\nMATRIX_ACCESS_TOKEN='access'\nMATRIX_E2EE_ENABLED='true'\nMATRIX_RECOVERY_KEY=''\n";
  await writeFile(envPath, original, { mode: 0o600 });
  const input = new EventEmitter();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.resume = () => {};
  input.pause = () => {};
  const values = ["first-secret", "different-secret"];
  let prompts = 0;
  let output = "";
  await assert.rejects(
    main(["--store-matrix-recovery-key", "--state-root", root], {
      input,
      output: {
        isTTY: true,
        write: (text) => {
          output += text;
          if (text.includes("input hidden")) {
            const value = values[prompts++];
            setImmediate(() => input.emit("data", `${value}\r`));
          }
        }
      }
    }),
    /entries did not match/
  );
  assert.equal(prompts, 2);
  assert.equal(output.includes(values[0]), false);
  assert.equal(output.includes(values[1]), false);
  assert.equal(await readFile(envPath, "utf8"), original);
});

test("confirmed hidden recovery entry exits the child process without Ctrl+C", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-recovery-exit-"));
  await writeFile(
    join(root, "setup-state.json"),
    JSON.stringify({ version: 1, completedStages: ["environment"] }),
    { mode: 0o600 }
  );
  await writeFile(
    join(root, "production.env"),
    "MATRIX_OWNER_ID='@owner:test'\nMATRIX_BRAIN_USER_ID='@brain:test'\nMATRIX_ACCESS_TOKEN='access'\nMATRIX_E2EE_ENABLED='true'\nMATRIX_RECOVERY_KEY=''\n",
    { mode: 0o600 }
  );
  const child = `
    import { EventEmitter } from 'node:events';
    import { main } from './scripts/setup/jarvis-setup.mjs';
    const input = new EventEmitter();
    input.isTTY = true;
    input.setRawMode = () => {};
    input.resume = () => {};
    input.pause = () => {};
    const output = { isTTY: true, write(value) {
      if (value.includes('input hidden')) setImmediate(() => input.emit('data', 'recovery-secret\\r'));
    }};
    process.exitCode = await main(['--store-matrix-recovery-key', '--state-root', process.env.JARVIS_TEST_STATE], { input, output });
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    env: { ...process.env, JARVIS_TEST_STATE: root },
    encoding: "utf8",
    timeout: 3_000
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(
    await readFile(join(root, "production.env"), "utf8"),
    /MATRIX_RECOVERY_KEY='recovery-secret'/u
  );
});

test("setup records Matrix and artifact stages only after readiness checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-setup-stage-"));
  await writeFile(
    join(root, "setup-state.json"),
    `${JSON.stringify({ version: 1, completedStages: ["environment"] })}\n`,
    { mode: 0o600 }
  );
  const env = [
    "MATRIX_OWNER_ID='@owner:test'",
    "MATRIX_BRAIN_USER_ID='@jarvis:test'",
    "MATRIX_ACCESS_TOKEN='secret'",
    "MATRIX_RECOVERY_KEY='recovery'",
    "MATRIX_E2EE_ENABLED='true'",
    "CONTINUWUITY_ALLOW_REGISTRATION='false'"
  ].join("\n");
  await writeFile(join(root, "production.env"), "MATRIX_ACCESS_TOKEN=''\n", { mode: 0o600 });
  let output = "";
  const io = { input: { isTTY: false }, output: { write: (text) => (output += text) } };
  await assert.rejects(
    main(["--complete-stage", "artifacts", "--state-root", root], io),
    /missing/u
  );
  for (const directory of ["runtime-profile", "platform-catalog"])
    await mkdir(join(root, directory), { recursive: true });
  await writeFile(join(root, "runtime-profile", "current-runtime.json"), "{}\n");
  await writeFile(join(root, "platform-catalog", "platform-catalog.v2.json"), "{}\n");
  await assert.rejects(
    main(["--complete-stage", "artifacts", "--state-root", root], io),
    /runtime profile.*invalid or inconsistent/u
  );
  assert.deepEqual((await readSetupState(join(root, "setup-state.json"))).completedStages, [
    "environment"
  ]);
  await writeValidReleaseArtifacts(root);
  await main(["--complete-stage", "artifacts", "--state-root", root], io);
  assert.deepEqual((await readSetupState(join(root, "setup-state.json"))).completedStages, [
    "environment",
    "artifacts"
  ]);
  await writeFile(
    join(root, "production.env"),
    `${env}\nCONTINUWUITY_REGISTRATION_TOKEN='temporary-token'\n`,
    { mode: 0o600 }
  );
  await main(["--complete-stage", "matrix-bootstrap", "--state-root", root], io);
  assert.doesNotMatch(await readFile(join(root, "production.env"), "utf8"), /temporary-token/u);
  assert.deepEqual((await readSetupState(join(root, "setup-state.json"))).completedStages, [
    "environment",
    "artifacts",
    "matrix-bootstrap"
  ]);
  assert.match(output, /verified and recorded/u);
});

test("seals the temporary Matrix registration token atomically after validating Matrix and E2EE", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-seal-registration-"));
  const statePath = join(root, "setup-state.json");
  await writeFile(
    statePath,
    `${JSON.stringify({ version: 1, completedStages: ["environment"] })}\n`,
    {
      mode: 0o600
    }
  );
  const envPath = join(root, "production.env");
  const token = "temporary-never-print-this";
  const original =
    [
      "POSTGRES_PASSWORD='preserve-me'",
      "MATRIX_OWNER_ID='@owner:example.test'",
      "MATRIX_BRAIN_USER_ID='@jarvis:example.test'",
      "MATRIX_ACCESS_TOKEN='access-secret'",
      "MATRIX_RECOVERY_KEY='recovery-secret'",
      "MATRIX_E2EE_ENABLED='true'",
      "CONTINUWUITY_ALLOW_REGISTRATION='true'",
      `CONTINUWUITY_REGISTRATION_TOKEN='${token}'`
    ].join("\n") + "\n";
  await writeFile(envPath, original, { mode: 0o600 });
  let output = "";
  await main(["--seal-matrix-registration", "--state-root", root], {
    input: { isTTY: false },
    output: { write: (text) => (output += text) }
  });
  const sealed = await readFile(envPath, "utf8");
  assert.equal(sealed.includes(token), false);
  assert.match(sealed, /POSTGRES_PASSWORD='preserve-me'/u);
  assert.match(sealed, /MATRIX_RECOVERY_KEY='recovery-secret'/u);
  assert.match(sealed, /CONTINUWUITY_ALLOW_REGISTRATION='false'/u);
  assert.doesNotMatch(sealed, /CONTINUWUITY_ALLOW_REGISTRATION='true'/u);
  assert.equal((await stat(envPath)).mode & 0o777, 0o600);
  assert.deepEqual((await readSetupState(statePath)).completedStages, [
    "environment",
    "matrix-bootstrap"
  ]);
  assert.equal(output.includes(token), false);
  assert.match(output, /was sealed and Matrix bootstrap was recorded/u);
});

test("Matrix registration sealing refuses duplicate registration-enable settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-seal-registration-ambiguous-"));
  const statePath = join(root, "setup-state.json");
  await writeFile(
    statePath,
    `${JSON.stringify({ version: 1, completedStages: ["environment"] })}\n`,
    {
      mode: 0o600
    }
  );
  const envPath = join(root, "production.env");
  const original =
    [
      "MATRIX_OWNER_ID='@owner:example.test'",
      "MATRIX_BRAIN_USER_ID='@jarvis:example.test'",
      "MATRIX_ACCESS_TOKEN='access-secret'",
      "MATRIX_RECOVERY_KEY='recovery-secret'",
      "MATRIX_E2EE_ENABLED='true'",
      "CONTINUWUITY_ALLOW_REGISTRATION='true'",
      "CONTINUWUITY_ALLOW_REGISTRATION='false'",
      "CONTINUWUITY_REGISTRATION_TOKEN='temporary-secret'"
    ].join("\n") + "\n";
  await writeFile(envPath, original, { mode: 0o600 });
  await assert.rejects(
    main(["--complete-stage", "matrix-bootstrap", "--state-root", root], {
      input: { isTTY: false },
      output: { write: () => undefined }
    }),
    /CONTINUWUITY_ALLOW_REGISTRATION is ambiguous/u
  );
  assert.equal(await readFile(envPath, "utf8"), original);
  assert.deepEqual((await readSetupState(statePath)).completedStages, ["environment"]);
});

test("Matrix registration sealing refuses invalid or ambiguous environment without changing it", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-seal-invalid-"));
  const statePath = join(root, "setup-state.json");
  await writeFile(
    statePath,
    `${JSON.stringify({ version: 1, completedStages: ["environment"] })}\n`,
    {
      mode: 0o600
    }
  );
  const envPath = join(root, "production.env");
  const original =
    [
      "MATRIX_OWNER_ID='@owner:example.test'",
      "MATRIX_BRAIN_USER_ID='@jarvis:example.test'",
      "MATRIX_ACCESS_TOKEN=''",
      "MATRIX_RECOVERY_KEY='recovery-secret'",
      "MATRIX_E2EE_ENABLED='true'",
      "CONTINUWUITY_REGISTRATION_TOKEN='temporary-secret'"
    ].join("\n") + "\n";
  await writeFile(envPath, original, { mode: 0o600 });
  await assert.rejects(
    main(["--seal-matrix-registration", "--state-root", root], {
      input: { isTTY: false },
      output: { write: () => undefined }
    }),
    /MATRIX_ACCESS_TOKEN must be configured/u
  );
  assert.equal(await readFile(envPath, "utf8"), original);
  assert.deepEqual((await readSetupState(statePath)).completedStages, ["environment"]);
  await writeFile(
    envPath,
    original.replace("MATRIX_OWNER_ID=", "MATRIX_OWNER_ID='@duplicate:test'\nMATRIX_OWNER_ID="),
    {
      mode: 0o600
    }
  );
  await assert.rejects(
    main(["--seal-matrix-registration", "--state-root", root], {
      input: { isTTY: false },
      output: { write: () => undefined }
    }),
    /MATRIX_OWNER_ID is ambiguous/u
  );
});

test("migration requires verified Matrix and artifact stages, then records only success", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-setup-migration-"));
  const statePath = join(root, "setup-state.json");
  await writeFile(
    statePath,
    `${JSON.stringify({
      version: 1,
      completedStages: ["environment", "matrix-bootstrap", "artifacts"]
    })}\n`,
    { mode: 0o600 }
  );
  const env = [
    "MATRIX_OWNER_ID='@owner:test'",
    "MATRIX_BRAIN_USER_ID='@jarvis:test'",
    "MATRIX_ACCESS_TOKEN='secret-access'",
    "MATRIX_RECOVERY_KEY='secret-recovery'",
    "CONTINUWUITY_ALLOW_REGISTRATION='false'"
  ].join("\n");
  await writeFile(join(root, "production.env"), `${env}\n`, { mode: 0o600 });
  for (const directory of ["runtime-profile", "platform-catalog"])
    await mkdir(join(root, directory), { recursive: true });
  await writeValidReleaseArtifacts(root);
  let invocation;
  await assert.rejects(
    runSetupMigration(root, (command, args, options) => {
      invocation = { command, args, options };
      return { status: 1 };
    }),
    /did not complete/u
  );
  assert.deepEqual((await readSetupState(statePath)).completedStages, [
    "environment",
    "matrix-bootstrap",
    "artifacts"
  ]);
  assert.equal(invocation.command, process.execPath);
  assert.ok(invocation.args.includes(join(root, "production.env")));
  assert.match(invocation.args.at(-1), /deploy\/compose\/compose\.production\.yml$/u);
  assert.equal(invocation.options.stdio, "inherit");
  await runSetupMigration(root, () => ({ status: 0 }));
  assert.deepEqual((await readSetupState(statePath)).completedStages, [
    "environment",
    "matrix-bootstrap",
    "artifacts",
    "migration"
  ]);
});

test("migration cannot run until Matrix and artifact stages are marked", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-setup-migration-gate-"));
  const path = join(root, "setup-state.json");
  await writeFile(path, `${JSON.stringify({ version: 1, completedStages: ["environment"] })}\n`, {
    mode: 0o600
  });
  await assert.rejects(
    runSetupMigration(root, () => assert.fail("must not run")),
    /Matrix bootstrap/u
  );
});

test("initial artifact publication is resumable and checkpoints only verified success", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-setup-publish-"));
  const statePath = join(root, "setup-state.json");
  await writeFile(
    statePath,
    `${JSON.stringify({ version: 1, completedStages: ["environment"] })}\n`,
    {
      mode: 0o600
    }
  );
  await writeFile(join(root, "production.env"), "MATRIX_ACCESS_TOKEN=''\n", { mode: 0o600 });

  let invocation;
  await assert.rejects(
    runSetupArtifactPublication(root, (command, args, options) => {
      invocation = { command, args, options };
      return { status: 1 };
    }),
    /No setup checkpoint was recorded/u
  );
  assert.deepEqual((await readSetupState(statePath)).completedStages, ["environment"]);
  assert.equal(invocation.command, process.execPath);
  assert.equal(invocation.args.at(-1), "--publish-only");
  assert.ok(invocation.args.includes(join(root, "production.env")));
  assert.ok(invocation.args.includes(join(root, "runtime-profile")));
  assert.ok(invocation.args.includes(join(root, "platform-catalog")));
  assert.equal(invocation.options.stdio, "inherit");

  await writeValidReleaseArtifacts(root);
  const success = await runSetupArtifactPublication(root, () => ({ status: 0 }));
  assert.match(success, /published, verified, and recorded/u);
  assert.deepEqual((await readSetupState(statePath)).completedStages, ["environment", "artifacts"]);
  assert.match(
    await runSetupArtifactPublication(root, () => assert.fail("already complete")),
    /already published/u
  );
});

test("artifact publication requires protected preparation but not Matrix bootstrap", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-setup-publish-gate-"));
  const statePath = join(root, "setup-state.json");
  await writeFile(
    statePath,
    `${JSON.stringify({ version: 1, completedStages: ["environment"] })}\n`,
    {
      mode: 0o600
    }
  );
  await writeFile(join(root, "production.env"), "MATRIX_ACCESS_TOKEN=''\n", { mode: 0o644 });
  await assert.rejects(
    runSetupArtifactPublication(root, () => assert.fail("must not run")),
    /mode-0600/u
  );
  assert.deepEqual((await readSetupState(statePath)).completedStages, ["environment"]);
});

test("startup requires migration and records health readiness only after operator success", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-setup-start-"));
  const statePath = join(root, "setup-state.json");
  await writeFile(
    statePath,
    `${JSON.stringify({
      version: 1,
      completedStages: ["environment", "matrix-bootstrap", "artifacts", "migration"]
    })}\n`,
    { mode: 0o600 }
  );
  const env = [
    "MATRIX_OWNER_ID='@owner:test'",
    "MATRIX_BRAIN_USER_ID='@jarvis:test'",
    "MATRIX_ACCESS_TOKEN='secret-access'",
    "MATRIX_RECOVERY_KEY='secret-recovery'",
    "CONTINUWUITY_ALLOW_REGISTRATION='false'"
  ].join("\n");
  await writeFile(join(root, "production.env"), `${env}\n`, { mode: 0o600 });
  for (const directory of ["runtime-profile", "platform-catalog"])
    await mkdir(join(root, directory), { recursive: true });
  await writeValidReleaseArtifacts(root);
  let output = "";
  await assert.rejects(
    runSetupStart(
      root,
      async (options) => {
        assert.deepEqual(options, { command: "start", stateRoot: root });
        throw new Error("Compose wait failed");
      },
      { output: (text) => (output += text) }
    ),
    /Compose wait failed/u
  );
  assert.equal((await readSetupState(statePath)).completedStages.includes("startup-health"), false);
  const message = await runSetupStart(root, async () => 0, {
    output: (text) => (output += text),
    checkInference: async () => {}
  });
  assert.equal((await readSetupState(statePath)).completedStages.includes("startup-health"), true);
  assert.match(message, /container inference connectivity checks passed/u);
  assert.equal(output.includes("secret-access"), false);
});

test("startup cannot run before migration", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-setup-start-gate-"));
  await writeFile(
    join(root, "setup-state.json"),
    `${JSON.stringify({ version: 1, completedStages: ["environment"] })}\n`,
    { mode: 0o600 }
  );
  await assert.rejects(
    runSetupStart(root, () => assert.fail("operator must not run")),
    /Complete database migration/u
  );
});

test("startup inference probe runs inside the gateway container and reports network failure", () => {
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 1 };
  };
  assert.throws(
    () => assertInferenceGatewayConnectivity("/private/jarvis-state", run),
    /cannot reach its configured upstream/u
  );
  assert.equal(calls[0].command, "docker");
  assert.ok(calls[0].args.includes("inference-gateway"));
  assert.ok(calls[0].args.includes("-T"));
  assert.ok(calls[0].args.includes("/private/jarvis-state/production.env"));
});

test("setup help cannot accidentally execute a stage operation", async () => {
  await assert.rejects(
    main(["--start", "--help"], {
      input: { isTTY: false },
      output: { write: () => assert.fail("help combination must be rejected first") }
    }),
    /cannot be combined with help/u
  );
});

test("preflight verifies tools, architecture, node, and ports", async () => {
  const calls = [];
  await runPreflight({
    architecture: "arm64",
    nodeMajor: 24,
    run: (command, args) => {
      calls.push([command, ...args]);
      return { status: 0 };
    },
    checkPort: async (port) => assert.equal(port, 8008)
  });
  assert.equal(calls.length, 8);
  assert.equal(calls.at(-1)[0], "docker");
  assert.deepEqual(calls.at(-1).slice(-2), ["config", "--quiet"]);
  assert.ok(calls.at(-1).includes("--env-file"));
  await assert.rejects(runPreflight({ nodeMajor: 23 }), /Node.js 24/);
});
