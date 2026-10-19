import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { pluginRuntimeBuildInput } from "../../../../scripts/plugins/build-plugin-runtime-images.mjs";

describe("plugin runtime image build inputs", () => {
  it("changes when owned files or the derived base image changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-plugin-runtime-"));
    const pluginRoot = join(root, "plugins", "example");
    const deployRoot = join(pluginRoot, "deploy");
    const dockerfile = join(deployRoot, "runtime.Dockerfile");
    await mkdir(deployRoot, { recursive: true });
    await writeFile(join(pluginRoot, "runtime.json"), '{"schemaVersion":1,"images":[]}\n');
    await writeFile(join(pluginRoot, "input.txt"), "initial\n");
    await writeFile(dockerfile, "FROM scratch\nCOPY plugins/example/input.txt /input.txt\n");
    const image = { id: "runtime", kind: "helper", tag: "jarvis/runtime:current" };

    const first = pluginRuntimeBuildInput({
      root,
      pluginRoot,
      dockerfile,
      image,
      baseRuntimeImageId: `sha256:${"a".repeat(64)}`
    });
    expect(
      pluginRuntimeBuildInput({
        root,
        pluginRoot,
        dockerfile,
        image,
        baseRuntimeImageId: `sha256:${"a".repeat(64)}`
      })
    ).toBe(first);

    await writeFile(join(pluginRoot, "unrelated.txt"), "changed\n");
    expect(
      pluginRuntimeBuildInput({
        root,
        pluginRoot,
        dockerfile,
        image,
        baseRuntimeImageId: `sha256:${"a".repeat(64)}`
      })
    ).toBe(first);
    await writeFile(join(pluginRoot, "input.txt"), "changed\n");
    expect(
      pluginRuntimeBuildInput({
        root,
        pluginRoot,
        dockerfile,
        image,
        baseRuntimeImageId: `sha256:${"a".repeat(64)}`
      })
    ).not.toBe(first);
    expect(
      pluginRuntimeBuildInput({
        root,
        pluginRoot,
        dockerfile,
        image,
        baseRuntimeImageId: `sha256:${"b".repeat(64)}`
      })
    ).not.toBe(first);
  });
});
