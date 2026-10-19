import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { confirmRestore, parseArgs, runOperator } from "./jarvis.mjs";
import { writeValidReleaseArtifacts } from "../setup/test-artifact-fixtures.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "jarvis-operator-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "setup-state.json"),
    JSON.stringify({
      version: 1,
      completedStages: ["preflight", "state-directories", "environment"]
    })
  );
  await writeFile(
    join(root, "production.env"),
    [
      "SECRET=not-printed",
      "MATRIX_OWNER_ID='@owner:example.test'",
      "MATRIX_BRAIN_USER_ID='@brain:example.test'",
      "MATRIX_ACCESS_TOKEN='access-token'",
      "MATRIX_RECOVERY_KEY='recovery-key'",
      "CONTINUWUITY_ALLOW_REGISTRATION=false",
      ""
    ].join("\n"),
    { mode: 0o600 }
  );
  for (const name of ["platform-catalog", "runtime-profile"]) await mkdir(join(root, name));
  await writeValidReleaseArtifacts(root);
  return root;
}

test("parses only supported operator options", () => {
  assert.deepEqual(parseArgs(["logs", "--tail", "12", "--follow", "brain-control"]), {
    command: "logs",
    positional: ["brain-control"],
    tail: "12",
    follow: true
  });
  assert.deepEqual(parseArgs(["update", "--", "application"]), {
    command: "update",
    positional: ["application"]
  });
  assert.deepEqual(parseArgs(["update", "--", "runtime", "--confirm-interruption"]), {
    command: "update",
    positional: ["runtime"],
    confirminterruption: true
  });
  assert.throws(() => parseArgs(["logs", "--tail", "many"]), /non-negative integer/);
  assert.throws(() => parseArgs(["update", "application", "--", "runtime"]), /Unknown option/);
  assert.throws(() => parseArgs(["reset"]), /Unknown command/);
});

test("start and stop use the setup-owned environment without removing volumes", async (t) => {
  const stateRoot = await fixture(t);
  const calls = [];
  const run = (program, args) => calls.push([program, args]);
  await runOperator({ command: "start", stateRoot }, { run, output: () => undefined });
  await runOperator({ command: "stop", stateRoot }, { run, output: () => undefined });
  assert.equal(calls[0][0], "docker");
  assert.ok(calls[0][1].includes(join(stateRoot, "production.env")));
  assert.deepEqual(calls[0][1].slice(-3), ["up", "--detach", "--wait"]);
  assert.equal(calls[1][1].at(-1), "stop");
  assert.ok(!calls.flat(2).includes("--volumes"));
});

test("runtime update requires explicit interruption acknowledgement", async (t) => {
  const stateRoot = await fixture(t);
  const calls = [];
  const dependencies = {
    run: (program, args) => calls.push([program, args]),
    output: () => undefined
  };
  await assert.rejects(
    runOperator({ command: "update", positional: ["runtime"], stateRoot }, dependencies),
    /--confirm-interruption/
  );
  await runOperator(
    {
      command: "update",
      positional: ["resources"],
      stateRoot,
      confirminterruption: true
    },
    dependencies
  );
  assert.equal(calls.length, 1);
  assert.ok(calls[0][1].includes("--resources-only"));
});

test("resources update can repair mismatched installed artifact pins", async (t) => {
  const stateRoot = await fixture(t);
  await writeFile(join(stateRoot, "platform-catalog", "platform-catalog.v2.json"), "{}");
  const calls = [];
  await assert.rejects(
    runOperator({ command: "start", stateRoot }, { run: () => assert.fail("must not start") }),
    /platform catalog/u
  );
  await runOperator(
    {
      command: "update",
      positional: ["resources"],
      stateRoot,
      confirminterruption: true
    },
    { run: (program, args) => calls.push([program, args]), output: () => undefined }
  );
  assert.equal(calls.length, 1);
  assert.ok(calls[0][1].includes("--resources-only"));
});

test("application update applies migrations with the setup-owned environment", async (t) => {
  const stateRoot = await fixture(t);
  const calls = [];
  await runOperator(
    { command: "update", positional: ["application"], stateRoot },
    { run: (program, args) => calls.push({ program, args }), output: () => undefined }
  );
  assert.deepEqual(calls[0], { program: "pnpm", args: ["install", "--frozen-lockfile"] });
  assert.equal(calls[1].program, process.execPath);
  assert.ok(calls[1].args[0].endsWith("scripts/migrations/apply-database-migrations.mjs"));
  assert.ok(calls[1].args.includes(join(stateRoot, "production.env")));
  assert.ok(calls[2].args[0].endsWith("scripts/runtime/update-host-local-runtime-profile.mjs"));
  assert.ok(calls[2].args.includes("--resources-only"));
  assert.ok(calls[2].args.includes("--publish-only"));
  assert.equal(calls[3].program, "docker");
  assert.deepEqual(calls[3].args.slice(-4), ["up", "--build", "--detach", "--wait"]);
});

test("application update can target an isolated Compose project for rehearsal", async (t) => {
  const stateRoot = await fixture(t);
  const calls = [];
  const composeFile = "deploy/compose/compose.system-test.yml";
  await runOperator(
    { command: "update", positional: ["application"], stateRoot },
    {
      projectName: "jarvis-update-rehearsal-test",
      composeFile,
      run: (program, args) => calls.push({ program, args }),
      output: () => undefined
    }
  );
  const migrationCall = calls[1];
  assert.ok(migrationCall.args.includes("--project-name"));
  assert.ok(migrationCall.args.includes("jarvis-update-rehearsal-test"));
  assert.ok(migrationCall.args.includes("--compose-file"));
  assert.ok(migrationCall.args.at(-1).endsWith(composeFile));
  assert.ok(calls[2].args.includes(join(stateRoot, "platform-catalog")));
  assert.ok(calls[2].args.includes(join(stateRoot, "runtime-profile")));
  assert.ok(calls[3].args.includes("jarvis-update-rehearsal-test"));
  assert.ok(calls[3].args[calls[3].args.indexOf("-f") + 1].endsWith(composeFile));
});

test("application update does not restart services when catalog publication fails", async (t) => {
  const stateRoot = await fixture(t);
  const calls = [];
  await assert.rejects(
    runOperator(
      { command: "update", positional: ["application"], stateRoot },
      {
        output: () => undefined,
        run: (program, args) => {
          calls.push({ program, args });
          if (args[0]?.endsWith("update-host-local-runtime-profile.mjs")) {
            throw new Error("catalog publication failed");
          }
        }
      }
    ),
    /catalog publication failed/u
  );
  assert.deepEqual(
    calls.map(({ program }) => program),
    ["pnpm", process.execPath, process.execPath]
  );
});

test("application update does not restart services when migrations fail", async (t) => {
  const stateRoot = await fixture(t);
  const calls = [];
  await assert.rejects(
    runOperator(
      { command: "update", positional: ["application"], stateRoot },
      {
        output: () => undefined,
        run: (program, args) => {
          calls.push({ program, args });
          if (program === process.execPath) throw new Error("migration failed");
        }
      }
    ),
    /migration failed/u
  );
  assert.deepEqual(
    calls.map(({ program }) => program),
    ["pnpm", process.execPath]
  );
});

test("backup streams a large database archive to a private file and hashes it", async (t) => {
  const stateRoot = await fixture(t);
  await writeValidReleaseArtifacts(stateRoot);
  const dump = Buffer.alloc(3 * 1024 * 1024, 0x5a);
  let streamedPath;
  let destination;
  await runOperator(
    { command: "backup", stateRoot },
    {
      run: async (_program, args, options) => {
        if (options?.outputFile) {
          streamedPath = options.outputFile;
          await writeFile(options.outputFile, dump, { mode: 0o600, flag: "wx" });
        }
        return Buffer.alloc(0);
      },
      output: (text) => {
        destination = text.match(/at (.+)\n/u)?.[1];
      }
    }
  );
  assert.ok(destination);
  assert.equal(streamedPath, join(destination, "database.dump"));
  assert.deepEqual(await readFile(join(destination, "database.dump")), dump);
  assert.equal((await stat(join(destination, "database.dump"))).mode & 0o777, 0o600);
  const manifest = JSON.parse(await readFile(join(destination, "manifest.json"), "utf8"));
  assert.equal(manifest.databaseSha256, createHash("sha256").update(dump).digest("hex"));
  assert.deepEqual(
    await readFile(join(destination, "runtime-profile", "current-runtime.json"), "utf8"),
    await readFile(join(stateRoot, "runtime-profile", "current-runtime.json"), "utf8")
  );
});

test("restore validates the dump and requires affirmative confirmation", async (t) => {
  const stateRoot = await fixture(t);
  const backup = join(stateRoot, "test-backup");
  await mkdir(backup);
  const dump = Buffer.from("valid archive");
  await writeFile(join(backup, "database.dump"), dump);
  await writeFile(
    join(backup, "manifest.json"),
    JSON.stringify({ version: 1, databaseSha256: createHash("sha256").update(dump).digest("hex") })
  );
  for (const name of ["platform-catalog", "runtime-profile"]) await mkdir(join(backup, name));
  const calls = [];
  const dependencies = {
    run: async (program, args, options) => {
      calls.push({ program, args, options });
      if (options?.inputFile) assert.deepEqual(await readFile(options.inputFile), dump);
    },
    output: () => undefined
  };
  await assert.rejects(
    runOperator(
      { command: "restore", positional: [backup], stateRoot },
      { ...dependencies, confirm: async () => false }
    ),
    /cancelled/
  );
  assert.equal(calls.length, 0);
  await runOperator(
    { command: "restore", positional: [backup], stateRoot, yes: true },
    dependencies
  );
  assert.equal(calls.filter((call) => call.args.at(-1) === "stop").length, 1);
  assert.equal(
    calls.some((call) => call.args.includes("--clean")),
    true
  );
  assert.equal(calls.find((call) => call.options?.inputFile)?.options.input, undefined);
  assert.equal(
    (await stat(join(stateRoot, "platform-catalog.pre-restore-" + process.pid))).isDirectory(),
    true
  );
});

test("restore confirmation releases input after an answer or EOF", async () => {
  const output = { write: () => undefined };
  const acceptedInput = new PassThrough();
  const accepted = confirmRestore("Type RESTORE: ", { input: acceptedInput, output });
  acceptedInput.write("RESTORE\n");
  assert.equal(await accepted, true);
  assert.equal(acceptedInput.isPaused(), true);
  acceptedInput.destroy();

  const emptyInput = new PassThrough();
  const rejected = confirmRestore("Type RESTORE: ", { input: emptyInput, output });
  emptyInput.end();
  assert.equal(await rejected, false);
  assert.equal(emptyInput.isPaused(), true);
});

test("operator commands reject incomplete setup and do not print environment contents", async (t) => {
  const stateRoot = await fixture(t);
  await writeFile(
    join(stateRoot, "setup-state.json"),
    JSON.stringify({ version: 1, completedStages: [] })
  );
  await assert.rejects(
    runOperator({ command: "status", stateRoot }, { run: () => Buffer.alloc(0) }),
    /setup is incomplete/
  );
});

test("start and update explain missing profile/catalog release artifacts", async (t) => {
  const stateRoot = await fixture(t);
  await rm(join(stateRoot, "platform-catalog", "platform-catalog.v2.json"));
  await assert.rejects(
    runOperator({ command: "start", stateRoot }, { run: () => assert.fail("must not start") }),
    /platform catalog is missing.*Publish the reviewed runtime profile and platform catalog/u
  );
});

test("runtime update can rebuild missing profile/catalog artifacts after interruption acknowledgement", async (t) => {
  const stateRoot = await fixture(t);
  await rm(join(stateRoot, "platform-catalog", "platform-catalog.v2.json"));
  await rm(join(stateRoot, "runtime-profile", "current-runtime.json"));
  const calls = [];
  await runOperator(
    {
      command: "update",
      positional: ["runtime"],
      stateRoot,
      confirminterruption: true
    },
    {
      run: (program, args) => calls.push({ program, args }),
      output: () => undefined
    }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].program, process.execPath);
  assert.ok(calls[0].args[0].endsWith("scripts/runtime/update-host-local-runtime-profile.mjs"));
});

test("status reports health and release identity without environment values", async (t) => {
  const stateRoot = await fixture(t);
  const catalog = JSON.parse(
    await readFile(join(stateRoot, "platform-catalog", "platform-catalog.v2.json"), "utf8")
  );
  const runtimePath = join(stateRoot, "runtime-profile", "current-runtime.json");
  const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
  runtime.currentRuntime.resourceBundle = {
    digest: `sha256:${"d".repeat(64)}`,
    artifactName: "profile-resources.tar"
  };
  await writeFile(runtimePath, `${JSON.stringify(runtime)}\n`);
  const lines = [];
  await runOperator(
    { command: "status", stateRoot },
    {
      run: (_program, args) => {
        if (args.includes("ps")) {
          return Buffer.from(
            `${JSON.stringify({ Service: "brain-control", State: "running", Health: "healthy" })}\n`
          );
        }
        return Buffer.from("2\n");
      },
      output: (line) => lines.push(line)
    }
  );
  const report = lines.join("");
  assert.match(report, /brain-control: running \(healthy\)/u);
  assert.match(report, new RegExp(catalog.digest, "u"));
  assert.match(report, /imageId=sha256:a{64}/u);
  assert.match(report, /sourceDigest=sha256:c{64}/u);
  assert.match(report, /resourceBundleDigest=sha256:d{64}/u);
  assert.match(report, /Database migration: 2/u);
  assert.doesNotMatch(report, /not-printed|SECRET/u);
});

test("status does not mark running services without health checks as degraded", async (t) => {
  const stateRoot = await fixture(t);
  const lines = [];
  await runOperator(
    { command: "status", stateRoot },
    {
      run: (_program, args) => {
        if (args.includes("ps")) {
          return Buffer.from(
            [
              { Service: "matrix-gateway", State: "running", Health: "" },
              { Service: "brain-worker", State: "running" },
              { Service: "matrix-homeserver", State: "running", Health: null }
            ]
              .map((service) => JSON.stringify(service))
              .join("\n") + "\n"
          );
        }
        return Buffer.from("4\n");
      },
      output: (line) => lines.push(line)
    }
  );
  const report = lines.join("");
  assert.match(report, /matrix-gateway: running\n/u);
  assert.match(report, /brain-worker: running\n/u);
  assert.match(report, /matrix-homeserver: running\n/u);
  assert.doesNotMatch(report, /degraded/u);
});

test("status gives recovery steps for degraded services, missing artifacts, and unavailable migrations", async (t) => {
  const stateRoot = await fixture(t);
  await rm(join(stateRoot, "platform-catalog", "platform-catalog.v2.json"));
  await rm(join(stateRoot, "runtime-profile", "current-runtime.json"));
  const lines = [];
  await runOperator(
    { command: "status", stateRoot },
    {
      run: (_program, args) => {
        if (args.includes("ps")) {
          return Buffer.from(
            [
              { Service: "brain-control", State: "running", Health: "unhealthy" },
              { Service: "brain-worker", State: "exited" }
            ]
              .map((service) => JSON.stringify(service))
              .join("\n") + "\n"
          );
        }
        throw new Error("database unavailable");
      },
      output: (line) => lines.push(line)
    }
  );
  const report = lines.join("");
  assert.match(
    report,
    /brain-control: running \(unhealthy\).*degraded.*pnpm jarvis:logs brain-control/u
  );
  assert.match(report, /brain-worker: exited.*degraded.*pnpm jarvis:logs brain-worker/u);
  assert.match(
    report,
    /Platform catalog: missing.*pnpm jarvis:update runtime --confirm-interruption/u
  );
  assert.match(
    report,
    /Runtime profile: missing.*pnpm jarvis:update runtime --confirm-interruption/u
  );
  assert.match(
    report,
    /During initial setup, use `pnpm jarvis:setup --publish-artifacts` instead/u
  );
  assert.match(report, /Database migration: unavailable.*pnpm jarvis:setup --migrate/u);
  assert.doesNotMatch(report, /database unavailable/u);
});
