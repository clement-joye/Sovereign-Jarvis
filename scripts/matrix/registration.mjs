import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

export class MatrixRegistrationReconciliationError extends Error {
  constructor(account) {
    super(
      `${account} registration may have succeeded, but its result was not safely recorded. Inspect the homeserver and protected production.env before continuing; do not repeat registration automatically.`
    );
    this.name = "MatrixRegistrationReconciliationError";
    this.account = account;
  }
}

/** Register the first local user with the one-time token shown in Continuwuity logs. */
export async function registerOwner({
  homeserverUrl,
  serverName,
  username,
  password,
  registrationToken,
  envFile,
  fetchImplementation = fetch
}) {
  const base = validateHomeserverUrl(homeserverUrl);
  validateLocalpart(username);
  validateCredential(password, "Owner password");
  validateCredential(registrationToken, "First-user registration token");
  const expectedId = expectedUserId(username, serverName);
  const { source } = await readProtectedEnvironment(envFile);
  assertEmptyEnvironmentValue(source, "MATRIX_OWNER_ID");
  // The unauthenticated local-user-count endpoint can return 403 during bootstrap.
  // The one-time first-user token and registration challenge authorize this operation.
  const credentials = await registerWithToken({
    base,
    username,
    password,
    registrationToken,
    fetchImplementation,
    account: "Owner",
    inhibitLogin: true,
    envFile
  });
  if (credentials.userId !== expectedId) throw new MatrixRegistrationReconciliationError("Owner");
  try {
    await storeEnvironmentValues(envFile, { MATRIX_OWNER_ID: credentials.userId });
  } catch {
    throw new MatrixRegistrationReconciliationError("Owner");
  }
  await clearPendingMarker(envFile, "Owner");
  return { userId: credentials.userId };
}

/** Recover a completed owner registration by proving control of its password. */
export async function reconcileOwnerRegistration({
  homeserverUrl,
  serverName,
  username,
  password,
  envFile,
  fetchImplementation = fetch
}) {
  const base = validateHomeserverUrl(homeserverUrl);
  validateLocalpart(username);
  validateCredential(password, "Owner password");
  const expectedId = expectedUserId(username, serverName);
  const { source } = await readProtectedEnvironment(envFile);
  assertEmptyEnvironmentValue(source, "MATRIX_OWNER_ID");
  await assertPendingMarker(envFile, "Owner");

  let response;
  try {
    response = await fetchImplementation(new URL("/_matrix/client/v3/login", base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "m.login.password",
        identifier: { type: "m.id.user", user: username },
        password,
        initial_device_display_name: "Jarvis setup reconciliation"
      })
    });
  } catch {
    throw new Error(
      "Cannot reach Matrix to verify the owner account. The pending marker was kept."
    );
  }
  if (!response.ok) {
    throw new Error(
      `Matrix owner sign-in failed (HTTP ${response.status}). Check the username and password; the pending marker was kept.`
    );
  }
  let credentials;
  try {
    credentials = await response.json();
  } catch {
    throw new MatrixRegistrationReconciliationError("Owner");
  }
  if (typeof credentials?.access_token !== "string" || !credentials.access_token) {
    throw new MatrixRegistrationReconciliationError("Owner");
  }
  await logoutUnexpectedRegistrationSession(base, credentials.access_token, fetchImplementation);
  if (credentials.user_id !== expectedId) {
    throw new Error(
      "The signed-in Matrix ID did not match the chosen owner username. The pending marker was kept."
    );
  }
  try {
    await storeEnvironmentValues(envFile, { MATRIX_OWNER_ID: credentials.user_id });
    await clearPendingMarker(envFile, "Owner");
  } catch {
    throw new MatrixRegistrationReconciliationError("Owner");
  }
  return { userId: credentials.user_id };
}

/** Register the service account using the token already held in protected setup state. */
export async function registerBrain({
  homeserverUrl,
  serverName,
  username,
  password,
  envFile,
  fetchImplementation = fetch
}) {
  const base = validateHomeserverUrl(homeserverUrl);
  validateLocalpart(username);
  validateCredential(password, "Brain password");
  const expectedId = expectedUserId(username, serverName);
  const { source } = await readProtectedEnvironment(envFile);
  assertEmptyEnvironmentValue(source, "MATRIX_BRAIN_USER_ID");
  assertEmptyEnvironmentValue(source, "MATRIX_ACCESS_TOKEN");
  const registrationToken = readEnvironmentValue(source, "CONTINUWUITY_REGISTRATION_TOKEN");
  validateCredential(registrationToken, "Temporary brain registration token");

  const credentials = await registerWithToken({
    base,
    username,
    password,
    registrationToken,
    fetchImplementation,
    account: "Brain",
    inhibitLogin: false,
    envFile
  });
  if (credentials.userId !== expectedId) throw new MatrixRegistrationReconciliationError("Brain");
  try {
    await storeEnvironmentValues(envFile, {
      MATRIX_BRAIN_USER_ID: credentials.userId,
      MATRIX_ACCESS_TOKEN: credentials.accessToken
    });
  } catch {
    throw new MatrixRegistrationReconciliationError("Brain");
  }
  await clearPendingMarker(envFile, "Brain");
  return { userId: credentials.userId };
}

export async function getLocalUserCount(homeserverUrl, fetchImplementation = fetch) {
  const base = validateHomeserverUrl(homeserverUrl);
  let response;
  try {
    response = await fetchImplementation(new URL("/_continuwuity/local_user_count", base));
  } catch {
    throw new Error(
      "Cannot check Continuwuity's local user count. Check private HTTPS reachability."
    );
  }
  if (!response.ok) {
    throw new Error(`Cannot check Continuwuity's local user count (HTTP ${response.status}).`);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("Continuwuity returned an invalid local user count.");
  }
  const count = typeof body === "number" ? body : (body?.count ?? body?.local_user_count);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Continuwuity returned an invalid local user count.");
  }
  return count;
}

async function registerWithToken({
  base,
  username,
  password,
  registrationToken,
  fetchImplementation,
  account,
  inhibitLogin,
  envFile
}) {
  const endpoint = new URL("/_matrix/client/v3/register", base);
  const registration = { username, password, inhibit_login: inhibitLogin };
  let initial;
  try {
    initial = await fetchImplementation(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(registration)
    });
  } catch {
    throw new Error("Matrix registration challenge could not be reached.");
  }
  if (initial.status !== 401) {
    if (initial.ok) {
      await createPendingMarker(envFile, account);
      throw new MatrixRegistrationReconciliationError(account);
    }
    throw new Error(
      `Matrix registration challenge returned HTTP ${initial.status}; check account state.`
    );
  }
  let challenge;
  try {
    challenge = await initial.json();
  } catch {
    throw new Error("Matrix registration challenge was malformed.");
  }
  if (
    !challenge ||
    typeof challenge.session !== "string" ||
    !Array.isArray(challenge.flows) ||
    !challenge.flows.some(
      (flow) => Array.isArray(flow?.stages) && flow.stages.includes("m.login.registration_token")
    )
  ) {
    throw new Error("Matrix registration did not offer the expected registration-token stage.");
  }

  await createPendingMarker(envFile, account);
  let response;
  try {
    response = await fetchImplementation(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...registration,
        auth: {
          type: "m.login.registration_token",
          token: registrationToken,
          session: challenge.session
        }
      })
    });
  } catch {
    throw new MatrixRegistrationReconciliationError(account);
  }
  if (!response.ok) {
    let rejection;
    try {
      rejection = await response.json();
    } catch {
      throw new MatrixRegistrationReconciliationError(account);
    }
    if (isDefiniteRegistrationRejection(response.status, rejection, challenge.session)) {
      try {
        await clearPendingMarker(envFile, account);
      } catch {
        throw new MatrixRegistrationReconciliationError(account);
      }
      throw new Error(
        `Matrix ${account.toLowerCase()} registration was rejected (${rejection.errcode}). Check the token, localpart, and registration settings, then retry.`
      );
    }
    throw new MatrixRegistrationReconciliationError(account);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new MatrixRegistrationReconciliationError(account);
  }
  if (typeof body?.user_id !== "string" || body.user_id === "") {
    throw new MatrixRegistrationReconciliationError(account);
  }
  if (inhibitLogin) {
    if (body.access_token !== undefined) {
      if (typeof body.access_token !== "string" || body.access_token === "") {
        throw new MatrixRegistrationReconciliationError(account);
      }
      await logoutUnexpectedRegistrationSession(base, body.access_token, fetchImplementation);
    } else if (body.device_id !== undefined) {
      throw new MatrixRegistrationReconciliationError(account);
    }
    return { userId: body.user_id };
  }
  if (typeof body.access_token !== "string" || body.access_token === "") {
    throw new MatrixRegistrationReconciliationError(account);
  }
  return { userId: body.user_id, accessToken: body.access_token };
}

async function logoutUnexpectedRegistrationSession(base, accessToken, fetchImplementation) {
  let response;
  try {
    response = await fetchImplementation(new URL("/_matrix/client/v3/logout", base), {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` }
    });
  } catch {
    throw new MatrixRegistrationReconciliationError("Owner");
  }
  if (!response.ok) throw new MatrixRegistrationReconciliationError("Owner");
}

function isDefiniteRegistrationRejection(status, body, session) {
  if (!body || typeof body.errcode !== "string") return false;
  if (
    status === 400 &&
    new Set(["M_INVALID_USERNAME", "M_INVALID_PARAM", "M_MISSING_PARAM"]).has(body.errcode)
  ) {
    return true;
  }
  if (body.errcode !== "M_FORBIDDEN") return false;
  if (status === 403) return true;
  return (
    status === 401 &&
    body.session === session &&
    Array.isArray(body.flows) &&
    (body.completed === undefined ||
      (Array.isArray(body.completed) && !body.completed.includes("m.login.registration_token")))
  );
}

function pendingMarkerPath(envFile, account) {
  return `${envFile}.${account.toLowerCase()}-registration-pending`;
}

async function assertPendingMarker(envFile, account) {
  let metadata;
  try {
    metadata = await lstat(pendingMarkerPath(envFile, account));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${account} registration has no pending marker to reconcile.`);
    }
    throw error;
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error(`${account} registration marker must be an owned, regular mode-0600 file.`);
  }
}

async function createPendingMarker(envFile, account) {
  const path = pendingMarkerPath(envFile, account);
  let handle;
  try {
    handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    await handle.writeFile("Registration request prepared. Reconcile before retrying.\n");
    await handle.sync();
  } catch (error) {
    if (error?.code === "EEXIST") throw new MatrixRegistrationReconciliationError(account);
    throw error;
  } finally {
    await handle?.close();
  }
}

async function clearPendingMarker(envFile, account) {
  await rm(pendingMarkerPath(envFile, account));
}

function validateHomeserverUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(
      "The homeserver URL must be an HTTPS URL without credentials or query parameters."
    );
  }
  return url;
}

function validateLocalpart(value) {
  if (typeof value !== "string" || !/^[a-z0-9._=\-/]+$/u.test(value)) {
    throw new Error("Use a Matrix localpart such as owner or brain.");
  }
}

function expectedUserId(username, serverName) {
  if (typeof serverName !== "string" || !serverName || /[\s/@]/u.test(serverName)) {
    throw new Error("A valid Matrix server name is required to verify registration.");
  }
  return `@${username}:${serverName}`;
}

function validateCredential(value, label) {
  if (typeof value !== "string" || !value || /[\r\n]/u.test(value)) {
    throw new Error(`${label} must be provided securely.`);
  }
}

async function readProtectedEnvironment(path) {
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error("production.env must be an owned, regular mode-0600 file.");
  }
  return { source: await readFile(path, "utf8"), metadata };
}

function readEnvironmentValue(source, key) {
  const entries = source.split(/\r?\n/u).filter((line) => line.startsWith(`${key}=`));
  if (entries.length !== 1) throw new Error(`${key} must occur exactly once in production.env.`);
  const raw = entries[0].slice(key.length + 1);
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replaceAll("'\\''", "'");
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  return raw;
}

function assertEmptyEnvironmentValue(source, key) {
  if (readEnvironmentValue(source, key).trim()) {
    throw new Error(`${key} is already configured; reconcile this account before registration.`);
  }
}

async function storeEnvironmentValues(path, values) {
  const { source } = await readProtectedEnvironment(path);
  for (const key of Object.keys(values)) assertEmptyEnvironmentValue(source, key);
  const lines = source.split(/\r?\n/u);
  const updated = lines.map((line) => {
    const key = Object.keys(values).find((entry) => line.startsWith(`${entry}=`));
    return key ? `${key}='${values[key].replaceAll("'", "'\\''")}'` : line;
  });
  const temporary = join(
    dirname(path),
    `.matrix-registration-${randomBytes(8).toString("hex")}.tmp`
  );
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600
    );
    await handle.writeFile(updated.join("\n"), "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}
