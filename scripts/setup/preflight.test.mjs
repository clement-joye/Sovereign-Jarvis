import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { access, chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertEndpointReachable,
  assertSupportedNodeVersion,
  runPreflight,
  validateProductionCompose
} from "./preflight.mjs";

test("preflight requires a usable parent for the setup state root", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-setup-state-preflight-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateRoot = join(root, "not-created", "state");
  const preflight = (path) =>
    runPreflight({
      nodeMajor: 24,
      stateRoot: path,
      run: () => ({ status: 0 }),
      checkPort: async () => {}
    });

  await preflight(stateRoot);

  const filePath = join(root, "file");
  await writeFile(filePath, "");
  await assert.rejects(preflight(filePath), /Setup state path is not a directory/u);

  await chmod(root, 0o755);
  await assert.rejects(preflight(root), /owned by the current user and private/u);
  await chmod(root, 0o700);
  const linkPath = join(root, "link");
  await symlink(root, linkPath);
  await assert.rejects(preflight(linkPath), /contains a symlink/u);
});

test("preflight stops on an unavailable Docker daemon with a repair action", async () => {
  const calls = [];
  await assert.rejects(
    runPreflight({
      nodeMajor: 24,
      run: (command, args) => {
        calls.push([command, ...args]);
        return { status: args[0] === "info" ? 1 : 0 };
      },
      checkPort: async () => {}
    }),
    /Start Docker and confirm the current user can access its daemon/u
  );
  assert.deepEqual(calls.at(-1).slice(0, 2), ["docker", "info"]);
});

test("preflight rejects a stopped Buildx builder", async () => {
  await assert.rejects(
    runPreflight({
      nodeMajor: 24,
      run: (_command, args) => ({
        status: 0,
        stdout: args[0] === "buildx" && args[1] === "inspect" ? "Status: stopped\n" : ""
      }),
      checkPort: async () => {}
    }),
    /selected Buildx builder is not running/u
  );
});

test("preflight checks inference host reachability without sending credentials or model requests", async () => {
  const endpoints = [];
  await runPreflight({
    nodeMajor: 24,
    inferenceBaseUrl: "https://private.example.invalid:8443/v1",
    run: () => ({ status: 0 }),
    checkPort: async () => {},
    checkEndpoint: async (...args) => endpoints.push(args)
  });
  assert.deepEqual(endpoints, [["https://private.example.invalid:8443/v1", "inference endpoint"]]);
  assertSupportedNodeVersion(24);
  assert.throws(() => assertSupportedNodeVersion(22), /Select Node 24/u);
  assert.throws(
    () => assertEndpointReachable("ftp://example.invalid", "inference endpoint"),
    /must use HTTP or HTTPS/u
  );
});

test("preflight validates production Compose with synthetic values", async () => {
  let invocation;
  let envContents;
  await validateProductionCompose({
    root: "/jarvis-checkout",
    run: (command, args, options) => {
      invocation = { command, args, options };
      const envIndex = args.indexOf("--env-file");
      envContents = readFileSync(args[envIndex + 1], "utf8");
      return { status: 0 };
    }
  });

  assert.equal(invocation.command, "docker");
  assert.deepEqual(invocation.args.slice(-2), ["config", "--quiet"]);
  assert.equal(invocation.options.cwd, "/jarvis-checkout");
  assert.deepEqual(Object.keys(invocation.options.env).sort(), ["DOCKER_CONFIG", "PATH"]);
  assert.equal(
    invocation.options.env.DOCKER_CONFIG,
    process.env.DOCKER_CONFIG ?? join(homedir(), ".docker")
  );
  assert.match(envContents, /MATRIX_OWNER_ID=@owner:compose-validation\.invalid/u);
  assert.match(envContents, /MATRIX_ACCESS_TOKEN=compose-validation-only-access-token/u);
  assert.doesNotMatch(envContents, /production\.env|<[^>]+>/u);
  await assert.rejects(access(invocation.args[invocation.args.indexOf("--env-file") + 1]), {
    code: "ENOENT"
  });
});

test("preflight fails setup when production Compose configuration is invalid", async () => {
  await assert.rejects(
    runPreflight({
      nodeMajor: 24,
      run: () => ({ status: 0 }),
      validateCompose: async () => {
        throw new Error("Preflight failed: production Docker Compose configuration is invalid.");
      },
      checkPort: async () => {}
    }),
    /production Docker Compose configuration is invalid/u
  );
});
