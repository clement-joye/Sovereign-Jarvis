#!/usr/bin/env node

import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { pathToFileURL } from "node:url";

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) return printUsage();
  const homeserver = new URL(requiredOption(options, "homeserver"));
  if (homeserver.protocol !== "https:") throw new Error("The homeserver URL must use HTTPS.");
  const ownerUserId = requiredOption(options, "owner-user");
  const targetUserId = requiredOption(options, "target-user");
  const accessToken = await secretOption(
    options,
    "owner-access-token",
    "Owner Matrix access token: "
  );
  const userSigningSeed = await secretOption(
    options,
    "owner-user-signing-private-key",
    "Owner user-signing private key (base64 32-byte seed): "
  );

  const whoami = await requestJson(
    homeserver,
    accessToken,
    "GET",
    "/_matrix/client/v3/account/whoami"
  );
  if (!isRecord(whoami) || whoami.user_id !== ownerUserId) {
    throw new Error("The access token does not belong to --owner-user.");
  }
  const keys = await requestJson(homeserver, accessToken, "POST", "/_matrix/client/v3/keys/query", {
    device_keys: { [ownerUserId]: [], [targetUserId]: [] }
  });
  const targetMasterKey = requireSingleSigningKey(keys, "master_keys", targetUserId);
  if (options.showTargetMasterKey) {
    console.log(targetMasterKey.value);
    return;
  }
  const ownerSigningKey = requireSingleSigningKey(keys, "user_signing_keys", ownerUserId);
  const expectedMasterKey = requiredOption(options, "target-master-key");
  if (targetMasterKey.value !== expectedMasterKey) {
    throw new Error("The target master key did not match --target-master-key. Nothing was signed.");
  }
  const privateKey = privateKeyFromSeed(userSigningSeed);
  if (publicKeyFromPrivateKey(privateKey) !== ownerSigningKey.value) {
    throw new Error("The private key does not match the owner's published user-signing key.");
  }

  const confirmation = `TRUST ${targetUserId} ${targetMasterKey.value}`;
  if (options.yes !== confirmation) {
    throw new Error(`Refusing to sign without --yes ${JSON.stringify(confirmation)}.`);
  }
  const signature = toUnpaddedBase64(
    sign(null, Buffer.from(canonicalJson(withoutSignatures(targetMasterKey.object))), privateKey)
  );
  const signedTargetMasterKey = withSignature(
    targetMasterKey.object,
    ownerUserId,
    `ed25519:${ownerSigningKey.value}`,
    signature
  );
  const result = await requestJson(
    homeserver,
    accessToken,
    "POST",
    "/_matrix/client/v3/keys/signatures/upload",
    {
      [targetUserId]: {
        [targetMasterKey.value]: signedTargetMasterKey
      }
    }
  );
  if (isRecord(result) && isRecord(result.failures) && Object.keys(result.failures).length > 0) {
    throw new Error(
      `The homeserver rejected the signature upload: ${JSON.stringify(result.failures)}`
    );
  }
  console.log(`Trusted ${targetUserId} master key ${targetMasterKey.value}.`);
  console.log("Wait for Element to sync, then send a new encrypted message.");
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--allow-cli-secrets") {
      options.allowCliSecrets = true;
      continue;
    }
    if (argument === "--show-target-master-key") {
      options.showTargetMasterKey = true;
      continue;
    }
    if (!argument?.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
    options[argument.slice(2)] = value;
    index += 1;
  }
  return options;
}

function requiredOption(options, name) {
  const value = options[name];
  if (!value) throw new Error(`Missing required option --${name}.`);
  return value;
}

async function secretOption(options, name, prompt) {
  const value = options[name];
  if (value) {
    if (!options.allowCliSecrets) {
      throw new Error(
        `--${name} requires --allow-cli-secrets because command-line secrets are exposed.`
      );
    }
    return value;
  }
  return promptSecret(prompt);
}

async function promptSecret(prompt) {
  if (!process.stdin.isTTY) throw new Error("Secret entry requires an interactive terminal.");
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolveSecret, reject) => {
    let secret = "";
    const finish = (error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolveSecret(secret);
    };
    const onData = (character) => {
      if (character === "\u0003") finish(new Error("Secret entry cancelled."));
      else if (character === "\r" || character === "\n") finish();
      else if (character === "\u007f" || character === "\b") secret = secret.slice(0, -1);
      else secret += character;
    };
    process.stdin.on("data", onData);
  });
}

async function requestJson(homeserver, accessToken, method, path, body) {
  const response = await fetch(new URL(path, homeserver), {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} failed: ${response.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

function requireSingleSigningKey(keysResponse, collection, userId) {
  const keyObject =
    isRecord(keysResponse) && isRecord(keysResponse[collection])
      ? keysResponse[collection][userId]
      : undefined;
  if (!isRecord(keyObject) || !isRecord(keyObject.keys)) {
    throw new Error(`No ${collection} entry was published for ${userId}.`);
  }
  const entries = Object.entries(keyObject.keys).filter(
    ([keyId, value]) => keyId.startsWith("ed25519:") && typeof value === "string"
  );
  if (entries.length !== 1)
    throw new Error(`Expected exactly one Ed25519 ${collection} key for ${userId}.`);
  const [keyId, value] = entries[0];
  if (!keyId || !value) throw new Error(`Invalid ${collection} key for ${userId}.`);
  return { keyId, value, object: keyObject };
}

function privateKeyFromSeed(value) {
  const seed = fromUnpaddedBase64(value);
  if (seed.byteLength !== 32)
    throw new Error("The user-signing private key must decode to exactly 32 bytes.");
  return createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: "der",
    type: "pkcs8"
  });
}

function publicKeyFromPrivateKey(privateKey) {
  const der = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  if (!der.subarray(0, SPKI_ED25519_PREFIX.byteLength).equals(SPKI_ED25519_PREFIX)) {
    throw new Error("The supplied key is not an Ed25519 key.");
  }
  return toUnpaddedBase64(der.subarray(SPKI_ED25519_PREFIX.byteLength));
}

function fromUnpaddedBase64(value) {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) throw new Error("Expected a base64-encoded key.");
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function toUnpaddedBase64(value) {
  return value.toString("base64").replace(/=+$/, "");
}

function withoutSignatures(value) {
  if (!isRecord(value)) throw new Error("Expected a Matrix signing object.");
  const { signatures: _signatures, unsigned: _unsigned, ...unsignedValue } = value;
  return unsignedValue;
}

function withSignature(value, signerUserId, signingKeyId, signature) {
  if (!isRecord(value)) throw new Error("Expected a Matrix signing object.");
  const signatures = isRecord(value.signatures) ? value.signatures : {};
  const signerSignatures = isRecord(signatures[signerUserId]) ? signatures[signerUserId] : {};
  return {
    ...value,
    signatures: {
      ...signatures,
      [signerUserId]: { ...signerSignatures, [signingKeyId]: signature }
    }
  };
}

function canonicalJson(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isRecord(value)) throw new Error("Cannot canonicalize a non-JSON value.");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function printUsage() {
  console.log(`Usage:
  node scripts/matrix/matrix-trust-user.mjs \\
    --homeserver https://matrix.example \\
    --owner-user @owner:example \\
    --target-user @brain:example \\
    --target-master-key <fingerprint> \\
    --yes 'TRUST @brain:example <fingerprint>'

The script prompts without echoing for the owner access token and owner
user-signing private key. Passing either secret directly requires the explicit
--allow-cli-secrets acknowledgement.

To print only a target user's current master-key fingerprint, omit the signing
options and use --show-target-master-key.`);
}

export {
  canonicalJson,
  privateKeyFromSeed,
  publicKeyFromPrivateKey,
  toUnpaddedBase64,
  withSignature,
  withoutSignatures
};
