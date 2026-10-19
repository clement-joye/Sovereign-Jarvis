#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { registerBrain } from "./registration.mjs";

const options = parseOptions(process.argv.slice(2));

if (options.help) {
  printUsage();
  process.exit(0);
}

const homeserverUrl = requiredOption(options, "homeserver");
const username = requiredOption(options, "username");
const envFile = resolve(requiredOption(options, "env-file"));
const parsedHomeserverUrl = new URL(homeserverUrl);
if (parsedHomeserverUrl.protocol !== "https:") {
  throw new Error("The homeserver URL must use HTTPS.");
}

const password = options.register
  ? await promptConfirmedSecret(`New password for ${username}: `)
  : await promptSecret(`Password for ${username}: `);
const credentials = options.register
  ? await registerBrain({
      homeserverUrl: parsedHomeserverUrl,
      serverName: await readServerName(envFile),
      password,
      username,
      envFile
    })
  : await login({ homeserverUrl: parsedHomeserverUrl, password, username });
if (!options.register) {
  await updateEnvironmentFile(envFile, {
    MATRIX_ACCESS_TOKEN: credentials.accessToken,
    MATRIX_BRAIN_USER_ID: credentials.userId
  });
}
console.log(`Saved Matrix brain-account credentials to ${envFile}.`);
console.log(`Authenticated as ${credentials.userId}.`);

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--register") {
      options.register = true;
      continue;
    }
    if (!argument?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}.`);
    }
    options[argument.slice(2)] = value;
    index += 1;
  }
  return options;
}

function requiredOption(options, name) {
  const value = options[name];
  if (!value) {
    throw new Error(`Missing required option --${name}.`);
  }
  return value;
}

async function promptSecret(prompt) {
  if (!process.stdin.isTTY) {
    throw new Error("Password entry requires an interactive terminal.");
  }

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
      if (error) {
        reject(error);
      } else {
        resolveSecret(secret);
      }
    };
    const onData = (character) => {
      if (character === "\u0003") {
        finish(new Error("Password entry cancelled."));
      } else if (character === "\r" || character === "\n") {
        finish();
      } else if (character === "\u007f" || character === "\b") {
        secret = secret.slice(0, -1);
      } else {
        secret += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function promptConfirmedSecret(prompt) {
  const password = await promptSecret(prompt);
  const confirmation = await promptSecret("Confirm password: ");
  if (password !== confirmation) {
    throw new Error("Passwords did not match; no Matrix account was created.");
  }
  return password;
}

async function login({ homeserverUrl, password, username }) {
  const response = await fetch(new URL("/_matrix/client/v3/login", homeserverUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "m.login.password",
      identifier: { type: "m.id.user", user: username },
      password,
      initial_device_display_name: "Jarvis Matrix gateway"
    })
  });
  if (!response.ok) {
    throw new Error(`Matrix login failed: ${response.status} ${await response.text()}`);
  }
  const body = await response.json();
  if (
    !isRecord(body) ||
    typeof body.access_token !== "string" ||
    typeof body.user_id !== "string"
  ) {
    throw new Error("Matrix login response did not contain an access token and user ID.");
  }
  return { accessToken: body.access_token, userId: body.user_id };
}

async function readServerName(path) {
  const source = await readFile(path, "utf8");
  const entries = source.split(/\r?\n/u).filter((line) => line.startsWith("MATRIX_SERVER_NAME="));
  if (entries.length !== 1)
    throw new Error("MATRIX_SERVER_NAME must occur once in production.env.");
  return entries[0].slice("MATRIX_SERVER_NAME=".length).replace(/^['"]|['"]$/gu, "");
}

async function updateEnvironmentFile(path, values) {
  const existing = await readFile(path, "utf8");
  const remaining = existing
    .split(/\r?\n/)
    .filter((line) => !Object.keys(values).some((name) => line.startsWith(`${name}=`)));
  const content = `${remaining.filter(Boolean).join("\n")}\n${Object.entries(values)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n")}\n`;
  const temporaryPath = resolve(dirname(path), `.${randomUUID()}.tmp`);
  await writeFile(temporaryPath, content, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function printUsage() {
  console.log(`Usage:
  node scripts/matrix/matrix-login.mjs --homeserver https://matrix.example.ts.net \\
    --username @brain:matrix.example.ts.net \\
    --env-file <protected-production-env>

  node scripts/matrix/matrix-login.mjs --register \\
    --homeserver https://matrix.example.ts.net \\
    --username brain \\
    --env-file <protected-production-env>

Prompts for the password without echoing it, then writes MATRIX_ACCESS_TOKEN
and MATRIX_BRAIN_USER_ID to the specified protected environment file. The
--register reads the temporary brain registration token from the protected
environment file. A lost registration response requires manual reconciliation.`);
}
