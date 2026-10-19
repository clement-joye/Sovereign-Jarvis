import { spawnSync } from "node:child_process";
import { lstat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

import {
  MatrixRegistrationReconciliationError,
  getLocalUserCount,
  reconcileOwnerRegistration,
  registerBrain,
  registerOwner
} from "../matrix/registration.mjs";
import { readBootstrapRecovery, readBootstrapStatus } from "../matrix/bootstrap-recovery.mjs";
import {
  clearUnregisteredOwnerId,
  readSetupEnvironmentValues,
  readSetupState,
  sealMatrixRegistration,
  storeMatrixRecoveryKey
} from "./setup-core.mjs";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const bootstrapFile = join(projectRoot, "deploy/compose/compose.matrix-bootstrap.yml");
const productionFile = join(projectRoot, "deploy/compose/compose.production.yml");

export async function runGuidedInstall(stateRoot, io, actions, dependencies = {}) {
  const output = io.output;
  const state = await readSetupState(join(stateRoot, "setup-state.json"));
  if (!state.completedStages.includes("environment")) {
    output.write("Prepare setup first with `pnpm jarvis:setup` or a reviewed `--config` file.\n");
    return 2;
  }
  if (!io.input.isTTY || !output.isTTY) {
    output.write(
      "Guided installation requires a terminal. Use `--status` for read-only progress.\n"
    );
    return 2;
  }
  const run = dependencies.run ?? spawnSync;
  const fetchImplementation = dependencies.fetch ?? fetch;
  const envPath = join(stateRoot, "production.env");
  const env = await readSetupEnvironmentValues(stateRoot);
  const serverName = env.get("MATRIX_SERVER_NAME");
  if (!serverName) throw new Error("Protected setup state has no Matrix server name.");
  const homeserverUrl = `https://${serverName}`;

  if (!state.completedStages.includes("artifacts")) {
    output.write("Publishing the reviewed runtime profile and platform catalog.\n");
    output.write(await actions.publishArtifacts(stateRoot));
  }

  if (!state.completedStages.includes("matrix-bootstrap")) {
    if (
      env.get("CONTINUWUITY_ALLOW_REGISTRATION") === "false" &&
      !env.get("CONTINUWUITY_REGISTRATION_TOKEN")
    ) {
      await sealMatrixRegistration(stateRoot);
      output.write("Sealed Matrix registration was verified and its checkpoint restored.\n");
      return runGuidedInstall(stateRoot, io, actions, dependencies);
    }
    runCompose(run, envPath, bootstrapFile, ["up", "--detach"]);
    if (!env.get("MATRIX_OWNER_ID")) {
      if (!(await matrixAvailable(homeserverUrl, fetchImplementation))) {
        output.write(
          `Matrix bootstrap is running. Set up private HTTPS with Tailscale Serve for ${homeserverUrl}, then check its /_matrix/client/versions endpoint.\n` +
            "In another terminal, run:\n" +
            `  tailscale serve --bg --https=443 http://127.0.0.1:${env.get("MATRIX_HOST_PORT") || "8008"}\n` +
            "  tailscale serve status\n" +
            `  curl ${homeserverUrl}/_matrix/client/versions\n` +
            "Keep this setup terminal open; see docs/getting-started/matrix-bootstrap.md if Tailscale needs more configuration.\n"
        );
        while (true) {
          const answer = await ask(io, "Press Enter when HTTPS is ready, or type q to pause setup");
          if (answer.toLowerCase() === "q") {
            output.write("Setup paused. Run `pnpm jarvis:setup` to resume.\n");
            return 0;
          }
          if (await matrixAvailable(homeserverUrl, fetchImplementation)) break;
          output.write(`Still cannot reach ${homeserverUrl}/_matrix/client/versions.\n`);
        }
      }
      if (await hasRegistrationMarker(envPath, "owner")) {
        output.write(
          "An earlier owner registration may have succeeded. Jarvis will verify that account with its username and password, then record its ID. This will not repeat registration.\n"
        );
        const username = await ask(io, "Owner username used in the previous attempt");
        const password = await actions.readHiddenSecret(io.input, output, "Owner Matrix password");
        const result = await reconcileOwnerRegistration({
          homeserverUrl,
          serverName,
          username,
          password,
          envFile: envPath,
          fetchImplementation
        });
        output.write(`Owner account ${result.userId} verified and recorded.\n`);
        return runGuidedInstall(stateRoot, io, actions, dependencies);
      }
      output.write(
        `Jarvis will create the first owner account now. Choose only its username (for example, owner for @owner:${serverName}); do not register separately in a browser.\n` +
          "Next, enter a new owner password twice. Jarvis will read the one-time first-user token from the homeserver logs.\n"
      );
      const username = await ask(io, "Owner username (localpart only)");
      const password = await confirmedSecret(io, actions.readHiddenSecret, "Owner Matrix password");
      let registrationToken = readFirstUserTokenFromLogs(run, envPath, serverName);
      if (registrationToken) {
        output.write(
          `Continuwuity first-user token from homeserver logs: ${registrationToken}\nJarvis will use this token now. Keep it private; it is different from CONTINUWUITY_REGISTRATION_TOKEN.\n`
        );
      } else {
        output.write(
          "The first-user token could not be read unambiguously from the homeserver logs. Find it with this command in another terminal:\n" +
            `  docker compose --project-name jarvis --env-file ${shellQuote(envPath)} -f ${shellQuote(bootstrapFile)} logs matrix-homeserver\n` +
            "Keep the token private. It is different from CONTINUWUITY_REGISTRATION_TOKEN.\n"
        );
        registrationToken = await actions.readHiddenSecret(
          io.input,
          output,
          "Continuwuity one-time first-user token from homeserver logs"
        );
      }
      try {
        await registerOwner({
          homeserverUrl,
          serverName,
          username,
          password,
          registrationToken,
          envFile: envPath,
          fetchImplementation
        });
      } catch (error) {
        if (!(error instanceof MatrixRegistrationReconciliationError)) throw error;
        output.write(
          "Owner registration had an uncertain result. Verifying the account with the password you just entered; registration will not be repeated.\n"
        );
        await reconcileOwnerRegistration({
          homeserverUrl,
          serverName,
          username,
          password,
          envFile: envPath,
          fetchImplementation
        });
      }
      output.write("Owner account registered. Set up its recovery key in Element next.\n");
      return runGuidedInstall(stateRoot, io, actions, dependencies);
    }

    if (!env.get("MATRIX_BRAIN_USER_ID") || !env.get("MATRIX_ACCESS_TOKEN")) {
      await assertNoRegistrationMarker(envPath, "brain");
      if (!(await matrixAvailable(homeserverUrl, fetchImplementation))) {
        output.write(`Restore private HTTPS access to ${homeserverUrl}.\n`);
        while (true) {
          const answer = await ask(io, "Press Enter when HTTPS is ready, or type q to pause setup");
          if (answer.toLowerCase() === "q") {
            output.write("Setup paused. Run `pnpm jarvis:setup` to resume.\n");
            return 0;
          }
          if (await matrixAvailable(homeserverUrl, fetchImplementation)) break;
          output.write(`Still cannot reach ${homeserverUrl}/_matrix/client/versions.\n`);
        }
      }
      if (
        !(await matrixUserExists(homeserverUrl, env.get("MATRIX_OWNER_ID"), fetchImplementation))
      ) {
        let localUserCount;
        try {
          localUserCount = await getLocalUserCount(homeserverUrl, fetchImplementation);
        } catch (error) {
          throw new Error(
            "MATRIX_OWNER_ID is configured, but its account was not found and the homeserver did not allow an empty-server check. Reconcile protected setup state before continuing; the guide will not clear the owner ID without proof that no users exist.",
            { cause: error }
          );
        }
        if (localUserCount === 0) {
          await assertNoRegistrationMarker(envPath, "owner");
          await clearUnregisteredOwnerId(stateRoot, env.get("MATRIX_OWNER_ID"));
          output.write(
            "The configured owner ID had no account on this empty homeserver. Cleared the stale ID; continuing with owner registration.\n"
          );
          return runGuidedInstall(stateRoot, io, actions, dependencies);
        }
        throw new Error(
          "MATRIX_OWNER_ID is configured, but that account was not found on the homeserver and other users exist. Reconcile protected setup state and Matrix data before continuing; do not register brain."
        );
      }
      output.write(
        `Owner account ${env.get("MATRIX_OWNER_ID")} is registered. Open the Element X mobile app or Element Web at https://app.element.io and select ${homeserverUrl} as the custom homeserver. ` +
          "Sign in with the owner password chosen during registration; the registration token is not needed for sign-in. " +
          "The homeserver URL itself is not the Element client. In Element, open your profile avatar > Encryption > Get recovery key, " +
          "or follow its recovery prompt. Save that key in a password manager. It is separate from the brain recovery key that Jarvis will show later.\n"
      );
      if (!(await confirm(io, "Have you saved the owner recovery key from Element?"))) {
        output.write(
          "Finish owner recovery setup in Element, then run `pnpm jarvis:setup` to resume.\n"
        );
        return 0;
      }
      const password = await confirmedSecret(io, actions.readHiddenSecret, "Brain Matrix password");
      await registerBrain({
        homeserverUrl,
        serverName,
        username: "brain",
        password,
        envFile: envPath,
        fetchImplementation
      });
      output.write("Brain account registered. Continuing with E2EE bootstrap.\n");
      return runGuidedInstall(stateRoot, io, actions, dependencies);
    }

    if (!env.get("MATRIX_RECOVERY_KEY")) {
      // The status command runs inside the gateway image, which is absent on
      // a clean installation. Building it does not touch Matrix identity.
      output.write("Building the Matrix gateway for one-time E2EE bootstrap.\n");
      runCompose(run, envPath, productionFile, ["build", "matrix-gateway"]);
      const status = await readBootstrapStatus(stateRoot, { runCommand: run });
      if (status === "ambiguous") {
        throw new Error(
          "Brain E2EE identity may exist, but no recovery key was durably saved. Do not rerun identity creation. Recover from the protected Matrix crypto volume or backup before continuing."
        );
      }
      if (status === "unstarted") {
        // Capture the bootstrap output: it contains the recovery key and must
        // never be streamed into routine operator logs.
        runCompose(
          run,
          envPath,
          productionFile,
          [
            "run",
            "--rm",
            "--no-deps",
            "-T",
            "matrix-gateway",
            "node",
            "apps/matrix-gateway/dist/src/bootstrap/bootstrap-e2ee.js"
          ],
          { capture: true, allowFailure: true }
        );
      }
      const after = await readBootstrapStatus(stateRoot, { runCommand: run });
      if (after !== "key-persisted") {
        throw new Error(
          "Brain E2EE identity creation has an ambiguous outcome. Do not retry. Inspect the protected Matrix crypto volume and recover the key before continuing."
        );
      }
      const recoveryKey = await readBootstrapRecovery(stateRoot, { runCommand: run });
      const stored = await storeMatrixRecoveryKey(stateRoot, recoveryKey);
      if (!stored.stored) {
        throw new Error(
          "A brain recovery key was written concurrently. Reconcile the protected environment with the crypto volume before continuing."
        );
      }
      output.write(
        "Brain recovery key was saved in protected Jarvis state. Save this key separately in your password manager now:\n"
      );
      output.write(`${recoveryKey}\n`);
      return runGuidedInstall(stateRoot, io, actions, dependencies);
    }

    if (!(await confirm(io, "Is the brain recovery key backed up outside Jarvis?"))) {
      output.write(
        "Back up the brain key before continuing. If the initial display was lost, run the protected --show-recovery-key command in the Matrix bootstrap guide on a private terminal, then confirm it matches your saved key. Run `pnpm jarvis:setup` to resume.\n"
      );
      return 0;
    }
    const brainId = env.get("MATRIX_BRAIN_USER_ID");
    const fingerprints = await queryBrainFingerprints(
      homeserverUrl,
      brainId,
      env.get("MATRIX_ACCESS_TOKEN"),
      fetchImplementation
    );
    output.write(`Brain master key: ${fingerprints.master}\n`);
    for (const device of fingerprints.devices) {
      output.write(`Brain device ${device.id}: ${device.key}\n`);
    }
    output.write(
      "Review or save these public keys for comparison in Element later. Jarvis is not running yet. After setup finishes, create a private room, invite the brain account, and verify its device.\n"
    );
    if (
      !(await confirm(io, "Continue with this brain identity and seal temporary registration?"))
    ) {
      output.write(
        "Review the brain identity before sealing registration, then run `pnpm jarvis:setup` to resume.\n"
      );
      return 0;
    }
    runCompose(run, envPath, bootstrapFile, ["down"]);
    await sealMatrixRegistration(stateRoot);
    output.write("Temporary Matrix registration was sealed.\n");
  }

  const updated = await readSetupState(join(stateRoot, "setup-state.json"));
  if (!updated.completedStages.includes("migration")) {
    output.write(await actions.migrate(stateRoot));
  }
  if (!updated.completedStages.includes("startup-health")) {
    output.write(await actions.start(stateRoot));
  }
  output.write(
    "Jarvis is running. In Element X, create a private room as the owner, invite the brain account, verify its device, and send a message. Confirm Jarvis joins and sends its first encrypted reply.\n"
  );
  return 0;
}

async function assertNoRegistrationMarker(envPath, account) {
  if (!(await hasRegistrationMarker(envPath, account))) return;
  throw new Error(
    `${account} registration may have succeeded. Reconcile the homeserver and protected setup state before continuing; do not repeat registration automatically.`
  );
}

async function hasRegistrationMarker(envPath, account) {
  const marker = `${envPath}.${account}-registration-pending`;
  try {
    await lstat(marker);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function runCompose(run, envPath, composeFile, args, options = {}) {
  const result = run(
    "docker",
    ["compose", "--project-name", "jarvis", "--env-file", envPath, "-f", composeFile, ...args],
    {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: options.capture ? 1024 * 1024 : undefined,
      stdio: options.capture ? "pipe" : "inherit"
    }
  );
  if (result.error || (result.status !== 0 && !options.allowFailure)) {
    throw new Error(`Docker Compose ${args[0]} failed. Review Docker status and retry the guide.`);
  }
  return result;
}

function readFirstUserTokenFromLogs(run, envPath, serverName) {
  try {
    const result = runCompose(
      run,
      envPath,
      bootstrapFile,
      ["logs", "--no-color", "--no-log-prefix", "matrix-homeserver"],
      { capture: true, allowFailure: true }
    );
    return result.status === 0
      ? parseFirstUserRegistrationToken(result.stdout, serverName)
      : undefined;
  } catch {
    return undefined;
  }
}

export function parseFirstUserRegistrationToken(logs, serverName) {
  if (typeof logs !== "string" || !serverName) return undefined;
  const plainLogs = stripVTControlCharacters(logs);
  const tokens = [
    ...plainLogs.matchAll(
      /\bfirst user account\b[\s\S]{0,600}?\bon\s+(\S+)\s+using (?:the )?registration token\s+([A-Za-z0-9_-]{8,256})(?=\s|\.)/giu
    )
  ]
    .filter((match) => match[1] === serverName)
    .map((match) => match[2]);
  return new Set(tokens).size === 1 ? tokens[0] : undefined;
}

async function matrixAvailable(homeserverUrl, fetchImplementation) {
  try {
    const response = await fetchImplementation(new URL("/_matrix/client/versions", homeserverUrl), {
      signal: AbortSignal.timeout(5_000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function matrixUserExists(homeserverUrl, userId, fetchImplementation) {
  try {
    const response = await fetchImplementation(
      new URL(`/_matrix/client/v3/profile/${encodeURIComponent(userId)}`, homeserverUrl),
      { signal: AbortSignal.timeout(5_000) }
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function queryBrainFingerprints(
  homeserverUrl,
  userId,
  accessToken,
  fetchImplementation
) {
  let response;
  try {
    response = await fetchImplementation(new URL("/_matrix/client/v3/keys/query", homeserverUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ device_keys: { [userId]: [] } }),
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    throw new Error(
      "Could not retrieve brain identity keys for review. Restore Matrix access and retry."
    );
  }
  if (!response.ok) {
    throw new Error(`Could not retrieve brain identity keys for review (HTTP ${response.status}).`);
  }
  const body = await response.json();
  const masterKeys = body?.master_keys?.[userId]?.keys;
  const master = Object.entries(masterKeys ?? {}).find(
    ([id, value]) => id.startsWith("ed25519:") && typeof value === "string"
  )?.[1];
  const devices = Object.entries(body?.device_keys?.[userId] ?? {}).flatMap(([id, value]) => {
    const key = value?.keys?.[`ed25519:${id}`];
    return typeof key === "string" ? [{ id, key }] : [];
  });
  if (!master || devices.length === 0) {
    throw new Error(
      "Brain identity or device keys are missing. Reconcile E2EE bootstrap before trust."
    );
  }
  return { master, devices };
}

async function ask(io, label) {
  const reader = createInterface({ input: io.input, output: io.output });
  try {
    return (await reader.question(`${label}: `)).trim();
  } finally {
    reader.close();
  }
}

async function confirm(io, question) {
  return (await ask(io, `${question} [y/N]`)).toLowerCase() === "y";
}

async function confirmedSecret(io, readHiddenSecret, label) {
  const value = await readHiddenSecret(io.input, io.output, label);
  const repeated = await readHiddenSecret(io.input, io.output, `Confirm ${label.toLowerCase()}`);
  if (!value || value !== repeated) throw new Error(`${label} entries did not match.`);
  return value;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
