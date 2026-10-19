import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { assertInstallReady } from "./install-readiness.mjs";
import { writeValidReleaseArtifacts } from "./test-artifact-fixtures.mjs";

async function setupRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "jarvis-ready-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "setup-state.json"),
    JSON.stringify({ version: 1, completedStages: ["environment"] })
  );
  await writeFile(
    join(root, "production.env"),
    [
      "SECRET=value",
      "MATRIX_OWNER_ID='@owner:example.test'",
      "MATRIX_BRAIN_USER_ID='@brain:example.test'",
      "MATRIX_ACCESS_TOKEN='access-token'",
      "MATRIX_RECOVERY_KEY='recovery-key'",
      "CONTINUWUITY_ALLOW_REGISTRATION='false'",
      ""
    ].join("\n"),
    { mode: 0o600 }
  );
  await mkdir(join(root, "runtime-profile"));
  await mkdir(join(root, "platform-catalog"));
  await writeValidReleaseArtifacts(root);
  return root;
}

test("accepts environment setup with readable release artifacts", async (t) => {
  await assertInstallReady(await setupRoot(t));
});

test("blocks startup until Matrix account and recovery credentials are present", async (t) => {
  const root = await setupRoot(t);
  await writeFile(join(root, "production.env"), "MATRIX_ACCESS_TOKEN=''\n", { mode: 0o600 });
  await assert.rejects(assertInstallReady(root), /Matrix bootstrap is incomplete/u);
});

test("blocks startup while the temporary Matrix registration token remains configured", async (t) => {
  const root = await setupRoot(t);
  await writeFile(
    join(root, "production.env"),
    [
      "MATRIX_OWNER_ID='@owner:example.test'",
      "MATRIX_BRAIN_USER_ID='@brain:example.test'",
      "MATRIX_ACCESS_TOKEN='access-token'",
      "MATRIX_RECOVERY_KEY='recovery-key'",
      "CONTINUWUITY_ALLOW_REGISTRATION='false'",
      "CONTINUWUITY_REGISTRATION_TOKEN='never-print-this-token'",
      ""
    ].join("\n"),
    { mode: 0o600 }
  );
  await assert.rejects(assertInstallReady(root), (error) => {
    assert.match(error.message, /temporary registration token is still configured/u);
    assert.equal(error.message.includes("never-print-this-token"), false);
    return true;
  });
});

test("blocks startup if temporary Matrix registration is enabled or ambiguous", async (t) => {
  const root = await setupRoot(t);
  const envPath = join(root, "production.env");
  const valid = [
    "MATRIX_OWNER_ID='@owner:example.test'",
    "MATRIX_BRAIN_USER_ID='@brain:example.test'",
    "MATRIX_ACCESS_TOKEN='access-token'",
    "MATRIX_RECOVERY_KEY='recovery-key'",
    "CONTINUWUITY_ALLOW_REGISTRATION='false'",
    ""
  ].join("\n");
  await writeFile(
    envPath,
    valid.replace(
      "CONTINUWUITY_ALLOW_REGISTRATION='false'",
      "CONTINUWUITY_ALLOW_REGISTRATION='true'"
    ),
    { mode: 0o600 }
  );
  await assert.rejects(assertInstallReady(root), /temporary registration must be disabled/u);
  await writeFile(
    envPath,
    valid.replace(
      "CONTINUWUITY_ALLOW_REGISTRATION='false'\n",
      "CONTINUWUITY_ALLOW_REGISTRATION='false'\nCONTINUWUITY_ALLOW_REGISTRATION='false'\n"
    ),
    { mode: 0o600 }
  );
  await assert.rejects(assertInstallReady(root), /temporary registration must be disabled/u);
});

test("reports the missing catalog before Compose startup", async (t) => {
  const root = await setupRoot(t);
  await rm(join(root, "platform-catalog", "platform-catalog.v2.json"));
  await assert.rejects(assertInstallReady(root), /platform catalog is missing/u);
});

test("rejects empty, malformed, tampered, or mismatched release artifacts", async (t) => {
  const root = await setupRoot(t);
  const runtimePath = join(root, "runtime-profile", "current-runtime.json");
  const catalogPath = join(root, "platform-catalog", "platform-catalog.v2.json");

  await writeFile(runtimePath, "{}\n");
  await assert.rejects(assertInstallReady(root), /runtime profile.*invalid or inconsistent/u);
  await writeValidReleaseArtifacts(root);

  const runtimeWithBadBundle = JSON.parse(await readFile(runtimePath, "utf8"));
  runtimeWithBadBundle.currentRuntime.resourceBundle = {
    digest: "sha256:bad",
    artifactName: "../outside"
  };
  await writeFile(runtimePath, `${JSON.stringify(runtimeWithBadBundle)}\n`);
  await assert.rejects(assertInstallReady(root), /invalid resource bundle metadata/u);
  await writeValidReleaseArtifacts(root);

  await writeFile(catalogPath, "{}\n");
  await assert.rejects(assertInstallReady(root), /platform catalog.*invalid structure/u);
  await writeValidReleaseArtifacts(root);

  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  catalog.runtimeClasses[0].image = `sha256:${"c".repeat(64)}`;
  await writeFile(catalogPath, `${JSON.stringify(catalog)}\n`);
  await assert.rejects(assertInstallReady(root), /catalog digest mismatch/u);
  await writeValidReleaseArtifacts(root);

  const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
  runtime.currentRuntime.imageId = `sha256:${"c".repeat(64)}`;
  runtime.profileArtifact.runtimeImage = runtime.currentRuntime.imageId;
  await writeFile(runtimePath, `${JSON.stringify(runtime)}\n`);
  await assert.rejects(assertInstallReady(root), /profile image pins do not match/u);
});

test("rejects malformed setup state", async (t) => {
  const root = await setupRoot(t);
  await writeFile(join(root, "setup-state.json"), "{}");
  await assert.rejects(assertInstallReady(root), /setup is incomplete/u);
});
