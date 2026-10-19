import { join } from "node:path";

import {
  inspectRecoveryHandoff,
  markIdentityCreationStarted,
  persistRecoveryKey,
  readRecoveryKey
} from "./recovery-handoff.js";

const cryptoStorePath = process.env.MATRIX_CRYPTO_STORE_PATH ?? "/brain/matrix-crypto";
const operation = process.argv[2];
const expectedUserId = process.argv[3];

if (operation === "--status") {
  if (!expectedUserId || process.argv.length !== 4) {
    throw new Error("--status requires the expected brain Matrix user ID.");
  }
  process.stdout.write(`${await inspectRecoveryHandoff(cryptoStorePath, expectedUserId)}\n`);
} else if (operation === "--show-recovery-key") {
  if (!expectedUserId || process.argv.length !== 4) {
    throw new Error("--show-recovery-key requires the expected brain Matrix user ID.");
  }
  process.stdout.write(`${await readRecoveryKey(cryptoStorePath, expectedUserId)}\n`);
} else if (operation === undefined) {
  const homeserverUrl = requiredEnvironment("MATRIX_HOMESERVER_URL");
  const accessToken = requiredEnvironment("MATRIX_ACCESS_TOKEN");
  const configuredUserId = requiredEnvironment("MATRIX_BRAIN_USER_ID");
  const { StoreType } = await import("@matrix-org/matrix-sdk-crypto-nodejs");
  const { MatrixClient, RustSdkCryptoStorageProvider, SimpleFsStorageProvider } = await import(
    "@vector-im/matrix-bot-sdk"
  );

  const handoffStatus = await inspectRecoveryHandoff(cryptoStorePath, configuredUserId);
  if (handoffStatus !== "unstarted") {
    throw new Error(
      "Matrix identity may exist; inspect protected recovery state. Do not retry identity creation."
    );
  }

  const authenticatedUserId = await whoami(homeserverUrl, accessToken);
  if (authenticatedUserId !== configuredUserId) {
    throw new Error(
      "The brain access token belongs to a different Matrix account. Stop and reconcile protected setup state."
    );
  }

  const syncStore = new SimpleFsStorageProvider(join(cryptoStorePath, "sync.json"));
  const cryptoStore = new RustSdkCryptoStorageProvider(
    join(cryptoStorePath, "crypto"),
    StoreType.Sqlite
  );
  const client = new MatrixClient(homeserverUrl, accessToken, syncStore, cryptoStore);

  await client.crypto.prepare();
  if (await client.crypto.isRecoveryAvailable()) {
    throw new Error(
      "Matrix E2EE recovery is already initialized. Identity may exist; inspect protected recovery state."
    );
  }

  await markIdentityCreationStarted(cryptoStorePath, authenticatedUserId);
  let recoveryKey: string;
  try {
    recoveryKey = await client.crypto.createIdentity();
    await persistRecoveryKey(cryptoStorePath, recoveryKey, authenticatedUserId);
  } catch {
    throw new Error(
      "Matrix identity may exist; inspect protected recovery state. Do not retry identity creation."
    );
  }
  process.stdout.write(
    "The brain Matrix recovery key is saved in the protected crypto volume. Save it separately in your password manager:\n"
  );
  process.stdout.write(`${recoveryKey}\n`);
  process.stdout.write("Do not paste it into chat or source control.\n");
} else {
  throw new Error(`Unknown E2EE bootstrap option: ${operation}`);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set.`);
  }
  return value;
}

async function whoami(homeserverUrl: string, accessToken: string): Promise<string> {
  const endpoint = new URL("/_matrix/client/v3/account/whoami", homeserverUrl);
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw new Error(
      "Could not authenticate the brain Matrix access token before identity creation."
    );
  }
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("user_id" in body) ||
    typeof body.user_id !== "string"
  ) {
    throw new Error("Matrix whoami returned no valid user ID. Identity creation was not started.");
  }
  return body.user_id;
}
