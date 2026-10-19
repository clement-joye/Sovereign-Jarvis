import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertPathInScope,
  assertWorkspacePathWritable,
  createWorkspaceTools,
  grepWorkspace,
  resolveWorkspacePath
} from "./workspace-tools.js";

let root: string | undefined;

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = undefined;
  }
});

describe("resolveWorkspacePath", () => {
  it("allows a relative path within the workspace", async () => {
    root = await mkdtemp(join(tmpdir(), "jarvis-workspace-"));
    await mkdir(join(root, "notes"));
    await writeFile(join(root, "notes", "todo.txt"), "test");

    await expect(resolveWorkspacePath(root, "notes/todo.txt")).resolves.toBe(
      join(root, "notes", "todo.txt")
    );
  });

  it("rejects absolute and traversing paths", async () => {
    root = await mkdtemp(join(tmpdir(), "jarvis-workspace-"));

    await expect(resolveWorkspacePath(root, "/etc/passwd")).rejects.toThrow("Absolute paths");
    await expect(resolveWorkspacePath(root, "../outside.txt")).rejects.toThrow("escapes");
  });

  it("rejects a symlink that resolves outside the workspace", async () => {
    root = await mkdtemp(join(tmpdir(), "jarvis-workspace-"));
    const outside = await mkdtemp(join(tmpdir(), "jarvis-outside-"));
    await writeFile(join(outside, "secret.txt"), "secret");
    await symlink(outside, join(root, "outside"));

    await expect(resolveWorkspacePath(root, "outside/secret.txt")).rejects.toThrow("outside");
    await rm(outside, { recursive: true, force: true });
  });

  // Reproduces the macOS scenario where `tmpdir()` resolves through a
  // `/var` → `/private/var` symlink. The returned path must stay under the
  // caller-provided lexical workspace root, not under the symlink-resolved
  // canonical root, so downstream file reads stay platform-native.
  it("returns a path under the lexical workspace root when realpath diverges", async () => {
    root = await mkdtemp(join(tmpdir(), "jarvis-workspace-"));
    const realRoot = await realpath(root);
    await mkdir(join(root, "notes"));
    await writeFile(join(root, "notes", "todo.txt"), "test");
    if (realRoot !== root) {
      // Simulate the macOS divergence: pretend `root` is the symlink and
      // `realRoot` is the canonical target.
      const simulated = await resolveWorkspacePath(root, "notes/todo.txt");
      expect(simulated.startsWith(root + "/")).toBe(true);
      expect(simulated.startsWith(realRoot + "/")).toBe(false);
      expect(simulated).toBe(join(root, "notes", "todo.txt"));
    } else {
      // No symlink divergence on this platform; the function should
      // still return the lexical path and accept the call.
      const simulated = await resolveWorkspacePath(root, "notes/todo.txt");
      expect(simulated).toBe(join(root, "notes", "todo.txt"));
    }
  });

  it("emits a bounded event when delegated path scope denies access", async () => {
    root = await mkdtemp(join(tmpdir(), "jarvis-workspace-"));
    await writeFile(join(root, "safe.txt"), "safe");
    const events: Array<{ type: string; reason: string; workspaceId?: string }> = [];
    const tools = createWorkspaceTools(
      root,
      { readablePaths: [] },
      { securityEvents: { emit: (event) => events.push(event) }, workspaceId: "workspace-1" }
    );
    const readTool = tools.find((tool) => tool.name === "workspace_read");
    await expect(
      readTool?.execute("call", { path: "safe.txt" }, undefined, undefined, {} as never)
    ).rejects.toThrow("outside delegated");
    expect(events).toEqual([
      expect.objectContaining({
        type: "workspace_path.denied",
        reason: "delegated_scope",
        workspaceId: "workspace-1"
      })
    ]);
  });
});

describe("assertWorkspacePathWritable", () => {
  it("rejects AGENTS.md and skill files", () => {
    const root = "/workspace";

    expect(() => assertWorkspacePathWritable(root, "/workspace/AGENTS.md")).toThrow("read-only");
    expect(() => assertWorkspacePathWritable(root, "/workspace/nested/AGENTS.md")).toThrow(
      "read-only"
    );
    expect(() =>
      assertWorkspacePathWritable(root, "/workspace/.agents/skills/scheduling/SKILL.md")
    ).toThrow("read-only");
  });

  it("allows ordinary workspace files", () => {
    expect(() =>
      assertWorkspacePathWritable("/workspace", "/workspace/notes/todo.md")
    ).not.toThrow();
  });
});

describe("delegated path scopes", () => {
  it("allows only targets at or below an explicit grant", () => {
    expect(() =>
      assertPathInScope(
        "/workspace",
        "/workspace/notes/project/todo.md",
        ["notes/project"],
        "writable"
      )
    ).not.toThrow();
    expect(() =>
      assertPathInScope(
        "/workspace",
        "/workspace/private/secret.txt",
        ["notes/project"],
        "writable"
      )
    ).toThrow("outside delegated writable paths");
    expect(() =>
      assertPathInScope("/workspace", "/workspace", ["notes/project"], "readable")
    ).toThrow("outside delegated readable paths");
  });

  it("fails closed for an empty scope on actual workspace tools", async () => {
    root = await mkdtemp(join(tmpdir(), "jarvis-workspace-"));
    await writeFile(join(root, "secret.txt"), "secret");
    const readTool = createWorkspaceTools(root, { readablePaths: [] }).find(
      ({ name }) => name === "workspace_read"
    );
    if (!readTool) throw new Error("Expected workspace_read tool.");
    await expect(
      readTool.execute(
        "call-1",
        { path: "secret.txt" },
        new AbortController().signal,
        () => undefined,
        {} as never
      )
    ).rejects.toThrow("outside delegated readable paths");
  });
});

describe("grepWorkspace", () => {
  it("returns relative matches and skips dependency and Git directories", async () => {
    root = await mkdtemp(join(tmpdir(), "jarvis-workspace-"));
    await mkdir(join(root, "notes"));
    await mkdir(join(root, "node_modules", "dependency"), { recursive: true });
    await mkdir(join(root, ".git"));
    await writeFile(join(root, "notes", "todo.txt"), "keep this match\n");
    await writeFile(join(root, "node_modules", "dependency", "index.js"), "match\n");
    await writeFile(join(root, ".git", "config"), "match\n");

    await expect(grepWorkspace(root, "match")).resolves.toEqual([
      "notes/todo.txt:1:keep this match"
    ]);
  });
});
