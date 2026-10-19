import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { readBootstrapRecovery, readBootstrapStatus } from "./bootstrap-recovery.mjs";

async function privateState() {
  const root = await mkdtemp(join(tmpdir(), "jarvis-bootstrap-import-"));
  await writeFile(
    join(root, "production.env"),
    "MATRIX_ACCESS_TOKEN='private'\nMATRIX_BRAIN_USER_ID='@brain:example.test'\n",
    { mode: 0o600 }
  );
  return root;
}

test("reads a redacted status and imports a saved key without printing it", async () => {
  const root = await privateState();
  const calls = [];
  const runCommand = (_command, args, options) => {
    calls.push({ args, options });
    return {
      status: 0,
      stdout: args.at(-2) === "--status" ? "key-persisted\n" : "secret key\n"
    };
  };
  assert.equal(await readBootstrapStatus(root, { runCommand }), "key-persisted");
  assert.equal(await readBootstrapRecovery(root, { runCommand }), "secret key");
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ args }) => args.includes("-T") && args.includes("--no-deps")));
  assert.ok(calls.every(({ args }) => args.at(-1) === "@brain:example.test"));
  assert.ok(calls.every(({ options }) => options.stdio[1] === "pipe"));
});

test("rejects ambiguous or malformed handoff output without returning a key", async () => {
  const root = await privateState();
  await assert.rejects(
    readBootstrapStatus(root, { runCommand: () => ({ status: 0, stdout: "secret key\n" }) }),
    /invalid status/u
  );
  await assert.rejects(
    readBootstrapRecovery(root, { runCommand: () => ({ status: 0, stdout: "key\nextra\n" }) }),
    /invalid key/u
  );
  await assert.rejects(
    readBootstrapRecovery(root, { runCommand: () => ({ status: 1, stdout: "secret key\n" }) }),
    /Could not inspect/u
  );
});
