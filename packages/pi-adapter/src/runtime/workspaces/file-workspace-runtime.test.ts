import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FileWorkspaceRuntime } from "./file-workspace-runtime.js";

describe("FileWorkspaceRuntime", () => {
  it("creates isolated workspace/session roots and removes only the requested runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-runtime-"));
    const runtime = new FileWorkspaceRuntime(root, new Set(["second-brain@1.0.0"]));
    await runtime.provision({
      workspaceId: "one",
      templateId: "second-brain",
      templateVersion: "1.0.0",
      configuration: {}
    });
    await runtime.provision({
      workspaceId: "two",
      templateId: "second-brain",
      templateVersion: "1.0.0",
      configuration: {}
    });
    expect(runtime.paths("one").root).not.toBe(runtime.paths("two").root);
    await expect(stat(runtime.paths("one").sessions)).resolves.toBeDefined();
    await runtime.destroy("one");
    await expect(stat(runtime.paths("one").root)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(runtime.paths("two").workspace)).resolves.toBeDefined();
  });

  it("rejects traversal-shaped workspace identities and unapproved templates", async () => {
    const runtime = new FileWorkspaceRuntime(
      await mkdtemp(join(tmpdir(), "jarvis-runtime-")),
      new Set()
    );
    await expect(
      runtime.provision({
        workspaceId: "../other",
        templateId: "second-brain",
        templateVersion: "1.0.0",
        configuration: {}
      })
    ).rejects.toThrow("Unapproved");
    expect(() => runtime.paths("../other")).toThrow("Invalid workspace runtime id");
  });
});
