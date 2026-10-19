import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = resolve("scripts/service/install-jarvis-boot-service.sh");

async function installFor(t, platform) {
  const root = await mkdtemp(join(tmpdir(), "jarvis-service-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  await mkdir(bin);
  const uname = join(bin, "uname");
  await writeFile(uname, `#!/bin/sh\nprintf '%s\\n' '${platform}'\n`);
  await chmod(uname, 0o755);
  const recorder = join(root, "calls");
  for (const command of ["systemctl", "launchctl"]) {
    const stub = join(bin, command);
    await writeFile(stub, `#!/bin/sh\nprintf '%s %s\\n' '${command}' "$*" >> '${recorder}'\n`);
    await chmod(stub, 0o755);
  }
  const runtimeEnv = join(root, ".env.runtime");
  await writeFile(runtimeEnv, "INFERENCE_SERVER_COMMAND=true\n", { mode: 0o600 });
  const stateRoot = join(root, "jarvis-state");
  await mkdir(stateRoot);
  await writeFile(
    join(stateRoot, "setup-state.json"),
    JSON.stringify({ completedStages: ["environment"] })
  );
  await writeFile(join(stateRoot, "production.env"), "COMPOSE_PROJECT_NAME=jarvis\n", {
    mode: 0o600
  });
  const result = spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: root,
      PATH: `${bin}:${process.env.PATH}`,
      JARVIS_RUNTIME_ENV: runtimeEnv,
      JARVIS_STATE_ROOT: stateRoot
    }
  });
  assert.equal(result.status, 0, result.stderr);
  return { root, recorder, stateRoot };
}

test("installs tested systemd user units using the setup-owned environment on Linux", async (t) => {
  const { root, recorder, stateRoot } = await installFor(t, "Linux");
  const composeUnit = await readFile(
    join(root, ".config/systemd/user/jarvis-compose.service"),
    "utf8"
  );
  const inferenceUnit = await readFile(
    join(root, ".config/systemd/user/jarvis-inference-server.service"),
    "utf8"
  );
  assert.match(composeUnit, /ExecStart=.*jarvis-compose-start\.sh/u);
  assert.ok(composeUnit.includes(`JARVIS_COMPOSE_ENV=${stateRoot}/production.env`));
  assert.match(inferenceUnit, /Restart=always/u);
  assert.match(
    await readFile(recorder, "utf8"),
    /systemctl --user enable --now jarvis-compose\.service jarvis-inference-server\.service/u
  );
});

test("generates launchd agents with setup environment and bootstraps them on macOS", async (t) => {
  const { root, recorder, stateRoot } = await installFor(t, "Darwin");
  const composePath = join(root, "Library/LaunchAgents/com.jarvis.compose.plist");
  const inferencePath = join(root, "Library/LaunchAgents/com.jarvis.inference-server.plist");
  const composePlist = await readFile(composePath, "utf8");
  const inferencePlist = await readFile(inferencePath, "utf8");
  assert.match(composePlist, /com\.jarvis\.compose/u);
  assert.ok(composePlist.includes(`<string>${stateRoot}/production.env</string>`));
  assert.match(inferencePlist, /com\.jarvis\.inference-server/u);
  assert.match(await readFile(recorder, "utf8"), /launchctl bootstrap gui/u);

  const xmllint = spawnSync("xmllint", ["--noout", composePath, inferencePath], {
    encoding: "utf8"
  });
  if (xmllint.error?.code === "ENOENT") {
    t.diagnostic("xmllint is unavailable; launchd plist XML syntax validation was skipped");
  } else {
    assert.equal(xmllint.status, 0, xmllint.stderr);
  }
});

test("refuses boot service installation before setup creates its state", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-service-incomplete-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  await mkdir(bin);
  const uname = join(bin, "uname");
  await writeFile(uname, "#!/bin/sh\nprintf '%s\\n' 'Linux'\n");
  await chmod(uname, 0o755);
  const runtimeEnv = join(root, ".env.runtime");
  await writeFile(runtimeEnv, "INFERENCE_SERVER_COMMAND=true\n");
  const result = spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: root,
      PATH: `${bin}:${process.env.PATH}`,
      JARVIS_RUNTIME_ENV: runtimeEnv,
      JARVIS_STATE_ROOT: join(root, "missing-state")
    }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /setup is incomplete/u);
});
