import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const updateScript = readFileSync(
  new URL("../../../../scripts/runtime/update-host-local-runtime-profile.mjs", import.meta.url),
  "utf8"
);

import {
  incrementalTypecheckArgs,
  hostLocalProfileReleaseBuildArgs,
  parseOptions,
  pluginIntegrityPreflightArgs,
  runtimeImageVerificationArgs,
  runtimeProfileServiceNames,
  runtimeProfileWorkerServiceNames
} from "../../../../scripts/runtime/update-host-local-runtime-profile.mjs";

describe("host-local runtime profile update command", () => {
  it("uses the production Compose defaults and replaces existing room runtimes", () => {
    expect(parseOptions([])).toEqual({
      envFile: "deploy/compose/.env.production",
      composeFile: "deploy/compose/compose.production.yml",
      runtimeProfileDir: undefined,
      resourcesOnly: false,
      publishOnly: false,
      replaceRoomRuntimes: true
    });
  });

  it("supports a resource-only publication without selecting an image build", () => {
    expect(parseOptions(["--resources-only"])).toMatchObject({
      resourcesOnly: true,
      replaceRoomRuntimes: true
    });
    expect(
      hostLocalProfileReleaseBuildArgs("/srv/jarvis", "/srv/jarvis/runtime/current.json", true)
    ).toContain("--resources-only");
  });

  it("can leave existing room runtimes unchanged explicitly", () => {
    expect(
      parseOptions(["--runtime-profile-dir", "/srv/jarvis/runtime-profile", "--new-rooms-only"])
    ).toMatchObject({
      runtimeProfileDir: "/srv/jarvis/runtime-profile",
      replaceRoomRuntimes: false
    });
  });

  it("rejects unknown and incomplete options", () => {
    expect(() => parseOptions(["--unknown"])).toThrow("Unknown option");
    expect(() => parseOptions(["--env-file"])).toThrow("requires a value");
  });

  it("refreshes routing and both inbound workers with the runtime", () => {
    expect(runtimeProfileServiceNames).toEqual([
      "brain-control",
      "matrix-gateway",
      "runtime-provisioner",
      "brain-worker",
      "brain-delegation-worker"
    ]);
    expect(runtimeProfileWorkerServiceNames).toEqual(["brain-worker", "brain-delegation-worker"]);
  });

  it("validates reviewed plugin integrity before release work", () => {
    expect(pluginIntegrityPreflightArgs("/srv/jarvis")).toEqual([
      "--import",
      "tsx",
      "/srv/jarvis/scripts/plugins/plugin-workflow.mjs",
      "validate"
    ]);
  });

  it("uses the incremental TypeScript project build for routine updates", () => {
    expect(incrementalTypecheckArgs("/srv/jarvis")).toEqual([
      "--dir",
      "/srv/jarvis",
      "exec",
      "tsc",
      "-b"
    ]);
  });

  it("passes each immutable image's runtime class to the verifier", () => {
    expect(runtimeImageVerificationArgs("/srv/jarvis", "browser", "sha256:image")).toEqual([
      "/srv/jarvis/scripts/runtime/verify-host-local-profile-runtime.mjs",
      "--image",
      "sha256:image",
      "--runtime-class",
      "browser"
    ]);
  });

  it("loads the installed-plugin source catalog when building the profile release", () => {
    expect(
      hostLocalProfileReleaseBuildArgs("/srv/jarvis", "/srv/jarvis/runtime/current.json", false)
    ).toEqual([
      "--import",
      "tsx",
      "/srv/jarvis/scripts/runtime/build-host-local-profile-release.mjs",
      "--output",
      "/srv/jarvis/runtime/current.json"
    ]);
  });

  it("reconciles profile consumers without a Compose rebuild", () => {
    expect(updateScript).toContain('"--no-build"');
    expect(updateScript).toContain('"--force-recreate"');
    expect(updateScript).not.toMatch(/"up",\s*"--detach",\s*"--build"/u);
  });
});
