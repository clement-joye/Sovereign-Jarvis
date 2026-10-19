import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  parseOptions,
  runHostLocalRuntimeProfileUpdate
} from "./update-host-local-runtime-profile.mjs";
import {
  assertReviewedRuntimeSourcesClean,
  preservePublishedBaseImage
} from "./build-host-local-profile-release.mjs";

test("runtime release rejects untracked or modified executable inputs", () => {
  const calls = [];
  assertReviewedRuntimeSourcesClean("/checkout", (command, args) => {
    calls.push([command, args]);
    return "";
  });
  assert.equal(calls[0][0], "git");
  assert.ok(calls[0][1].includes("--untracked-files=all"));
  assert.ok(calls[0][1].includes("deploy/pi-runtime"));
  assert.ok(calls[0][1].includes("plugins/browser/deploy/install-verified-playwright.mjs"));
  assert.ok(calls[0][1].includes("plugins/browser/deploy/playwright-archives.json"));
  assert.throws(
    () =>
      assertReviewedRuntimeSourcesClean("/checkout", () => "?? deploy/pi-runtime/models.json\n"),
    /Commit reviewed runtime sources/u
  );
});

test("runtime rebuild retains the published base image before moving the current tag", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "jarvis-published-image-"));
  try {
    const imageId = `sha256:${"e".repeat(64)}`;
    const manifestPath = join(tempRoot, "current-runtime.json");
    writeFileSync(manifestPath, JSON.stringify({ currentRuntime: { imageId } }));
    const calls = [];
    await preservePublishedBaseImage(manifestPath, (command, args) => {
      calls.push([command, args]);
    });
    assert.deepEqual(calls, [
      ["docker", ["image", "inspect", imageId]],
      ["docker", ["tag", imageId, `jarvis/pi-jarvis:pinned-${"e".repeat(64)}`]]
    ]);
    calls.length = 0;
    await preservePublishedBaseImage(manifestPath, (command, args) => {
      calls.push([command, args]);
      throw new Error("No such image");
    });
    assert.equal(calls.length, 1);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("--publish-only permits resources without allowing live updates", () => {
  assert.deepEqual(parseOptions(["--publish-only", "--resources-only"]), {
    envFile: "deploy/compose/.env.production",
    composeFile: "deploy/compose/compose.production.yml",
    runtimeProfileDir: undefined,
    resourcesOnly: true,
    publishOnly: true,
    replaceRoomRuntimes: true
  });
  assert.throws(
    () => parseOptions(["--publish-only", "--new-rooms-only"]),
    /cannot be combined with --new-rooms-only/u
  );
});

test("publish-only builds and verifies artifacts without migrations or Docker changes", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "jarvis-runtime-publish-only-"));
  try {
    const runtimeProfileDir = join(tempRoot, "runtime-profile");
    const platformCatalogDir = join(tempRoot, "platform-catalog");
    const envFile = join(tempRoot, "production.env");
    writeFileSync(envFile, "");
    const manifestPath = join(runtimeProfileDir, "current-runtime.json");
    const calls = [];
    const options = {
      ...parseOptions([
        "--env-file",
        envFile,
        "--compose-file",
        join(tempRoot, "compose.yml"),
        "--runtime-profile-dir",
        runtimeProfileDir,
        "--platform-catalog-dir",
        platformCatalogDir,
        "--publish-only"
      ]),
      publishOnly: true
    };

    runHostLocalRuntimeProfileUpdate(options, {
      projectRoot: process.cwd(),
      run(command, args) {
        calls.push([command, args]);
        if (args.some((arg) => arg.endsWith("build-host-local-profile-release.mjs"))) {
          const outputPath = args[args.indexOf("--output") + 1];
          mkdirSync(runtimeProfileDir, { recursive: true });
          writeFileSync(
            outputPath,
            JSON.stringify({
              currentRuntime: {
                imageId: "sha256:base-image",
                runtimeImageIds: { browser: "sha256:browser-image" }
              }
            })
          );
        }
      },
      capture() {
        throw new Error("publish-only must not inspect or remove runtime containers");
      },
      write() {}
    });

    const joinedCalls = calls.map(([, args]) => args.join(" ")).join("\n");
    assert.equal(
      calls.some(([command]) => command === "docker"),
      false
    );
    assert.equal(joinedCalls.includes("apply-database-migrations.mjs"), false);
    assert.ok(joinedCalls.includes("build-host-local-profile-release.mjs"));
    assert.ok(joinedCalls.includes("verify-host-local-profile-runtime.mjs"));
    assert.ok(joinedCalls.includes("platform-catalog-release.mjs build"));
    assert.ok(joinedCalls.includes("platform-catalog-release.mjs verify"));
    assert.ok(calls.some(([command, args]) => command === "pnpm" && args.includes("tsc")));
    assert.ok(manifestPath.endsWith("current-runtime.json"));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("resources-only publish updates the catalog without rebuilding images or restarting services", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "jarvis-resource-publish-only-"));
  try {
    const runtimeProfileDir = join(tempRoot, "runtime-profile");
    const platformCatalogDir = join(tempRoot, "platform-catalog");
    const envFile = join(tempRoot, "production.env");
    writeFileSync(envFile, "");
    mkdirSync(runtimeProfileDir, { recursive: true });
    writeFileSync(
      join(runtimeProfileDir, "current-runtime.json"),
      JSON.stringify({
        currentRuntime: {
          imageId: `sha256:${"a".repeat(64)}`,
          runtimeImageIds: { browser: `sha256:${"b".repeat(64)}` }
        }
      })
    );
    const calls = [];
    runHostLocalRuntimeProfileUpdate(
      parseOptions([
        "--env-file",
        envFile,
        "--compose-file",
        join(tempRoot, "compose.yml"),
        "--runtime-profile-dir",
        runtimeProfileDir,
        "--platform-catalog-dir",
        platformCatalogDir,
        "--resources-only",
        "--publish-only"
      ]),
      {
        projectRoot: process.cwd(),
        run(command, args) {
          calls.push([command, args]);
          if (args.some((arg) => arg.endsWith("build-host-local-profile-release.mjs"))) {
            mkdirSync(runtimeProfileDir, { recursive: true });
            writeFileSync(
              join(runtimeProfileDir, "current-runtime.json"),
              JSON.stringify({
                currentRuntime: {
                  imageId: `sha256:${"a".repeat(64)}`,
                  runtimeImageIds: { browser: `sha256:${"b".repeat(64)}` }
                }
              })
            );
          }
        },
        write() {}
      }
    );
    const joinedCalls = calls.map(([, args]) => args.join(" ")).join("\n");
    assert.ok(joinedCalls.includes("--resources-only"));
    assert.ok(joinedCalls.includes("platform-catalog-release.mjs build"));
    assert.ok(joinedCalls.includes("platform-catalog-release.mjs verify"));
    assert.equal(joinedCalls.includes("verify-host-local-profile-runtime.mjs"), false);
    assert.equal(joinedCalls.includes("apply-database-migrations.mjs"), false);
    assert.deepEqual(
      calls.filter(([command]) => command === "docker").map(([, args]) => args),
      [
        ["image", "inspect", "--format", "{{.Id}}", `sha256:${"a".repeat(64)}`],
        ["image", "inspect", "--format", "{{.Id}}", `sha256:${"b".repeat(64)}`]
      ]
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("resources update stops before catalog publication or container removal when an image is missing", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "jarvis-resource-missing-image-"));
  try {
    const runtimeProfileDir = join(tempRoot, "runtime-profile");
    const envFile = join(tempRoot, "production.env");
    const imageId = `sha256:${"c".repeat(64)}`;
    writeFileSync(envFile, "");
    mkdirSync(runtimeProfileDir, { recursive: true });
    writeFileSync(
      join(runtimeProfileDir, "current-runtime.json"),
      JSON.stringify({
        currentRuntime: {
          imageId,
          runtimeImageIds: { browser: `sha256:${"d".repeat(64)}` }
        }
      })
    );
    const calls = [];
    assert.throws(
      () =>
        runHostLocalRuntimeProfileUpdate(
          parseOptions([
            "--env-file",
            envFile,
            "--compose-file",
            join(tempRoot, "compose.yml"),
            "--runtime-profile-dir",
            runtimeProfileDir,
            "--platform-catalog-dir",
            join(tempRoot, "platform-catalog"),
            "--resources-only"
          ]),
          {
            projectRoot: process.cwd(),
            run(command, args) {
              calls.push([command, args]);
              if (command === "docker" && args[0] === "image") {
                throw new Error("No such image");
              }
            },
            write() {}
          }
        ),
      /Reviewed base runtime image is unavailable.*pnpm jarvis:update runtime/u
    );
    assert.equal(
      calls.some(([, args]) => args.some((arg) => arg.endsWith("platform-catalog-release.mjs"))),
      false
    );
    assert.equal(
      calls.some(([, args]) =>
        args.some((arg) => arg.endsWith("build-host-local-profile-release.mjs"))
      ),
      false
    );
    assert.equal(
      calls.some(([, args]) => args.includes("stop") || args.includes("rm")),
      false
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
