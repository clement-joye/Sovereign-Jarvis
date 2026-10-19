import { mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { emitSecurityEvent, type SecurityEventEmitter } from "@second-brain/observability";

import { grepWorkspace } from "../workspaces/workspace-search.js";

export { grepWorkspace } from "../workspaces/workspace-search.js";

const MAX_LIST_ENTRIES = 200;

export interface WorkspacePathScope {
  /** Undefined preserves the role's full catalog-authorized read access. */
  readablePaths?: readonly string[] | undefined;
  /** Undefined preserves the role's full catalog-authorized write access. */
  writablePaths?: readonly string[] | undefined;
}

export interface WorkspaceToolSecurityContext {
  securityEvents?: SecurityEventEmitter;
  workspaceId?: string;
  runId?: string;
  agentId?: string;
}

interface WorkspaceToolContext {
  workspaceRoot: string;
  scope: WorkspacePathScope;
  security: WorkspaceToolSecurityContext;
}

/** Built-in Pi file tools accept absolute paths. These only operate below workspaceRoot. */
export function createWorkspaceTools(
  workspaceRoot: string,
  scope: WorkspacePathScope = {},
  security: WorkspaceToolSecurityContext = {}
): ToolDefinition[] {
  const context = { workspaceRoot, scope, security };
  return [
    createWorkspaceListTool(context),
    createWorkspaceReadTool(context),
    createWorkspaceWriteTool(context),
    createWorkspaceEditTool(context),
    createWorkspaceGrepTool(context)
  ];
}

function createWorkspaceListTool(context: WorkspaceToolContext): ToolDefinition {
  return defineTool({
    name: "workspace_list",
    label: "workspace_list",
    description: "List files and directories inside the Jarvis workspace.",
    promptSnippet: "List files in the Jarvis workspace",
    parameters: Type.Object({ path: Type.Optional(Type.String()) }),
    async execute(...[, { path }]) {
      const target = await authorizedWorkspacePath(context, path ?? ".", "readable");
      const entries = await readdir(target, { withFileTypes: true });
      return textResult(
        entries
          .slice(0, MAX_LIST_ENTRIES)
          .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
          .join("\n") || "(empty directory)"
      );
    }
  });
}

function createWorkspaceReadTool(context: WorkspaceToolContext): ToolDefinition {
  return defineTool({
    name: "workspace_read",
    label: "workspace_read",
    description: "Read a UTF-8 text file inside the Jarvis workspace.",
    promptSnippet: "Read files in the Jarvis workspace",
    parameters: Type.Object({ path: Type.String() }),
    async execute(...[, { path }]) {
      const target = await authorizedWorkspacePath(context, path, "readable");
      return textResult(await readFile(target, "utf8"));
    }
  });
}

function createWorkspaceWriteTool(context: WorkspaceToolContext): ToolDefinition {
  return defineTool({
    name: "workspace_write",
    label: "workspace_write",
    description: "Create or overwrite a UTF-8 text file inside the Jarvis workspace.",
    promptSnippet: "Write files only in the Jarvis workspace",
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    async execute(...[, { path, content }]) {
      const target = await authorizedWorkspacePath(context, path, "writable");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
      return textResult(`Wrote ${content.length} bytes to ${path}.`);
    }
  });
}

function createWorkspaceEditTool(context: WorkspaceToolContext): ToolDefinition {
  return defineTool({
    name: "workspace_edit",
    label: "workspace_edit",
    description:
      "Replace one exact text fragment in a UTF-8 file inside the Jarvis workspace. Fails unless it occurs exactly once.",
    promptSnippet: "Make precise edits only in the Jarvis workspace",
    parameters: Type.Object({
      path: Type.String(),
      oldText: Type.String(),
      newText: Type.String()
    }),
    async execute(...[, { path, oldText, newText }]) {
      const target = await authorizedWorkspacePath(context, path, "writable");
      const source = await readFile(target, "utf8");
      const occurrences = source.split(oldText).length - 1;
      if (occurrences !== 1) {
        throw new Error(`Expected one occurrence of oldText in ${path}, found ${occurrences}.`);
      }
      await writeFile(target, source.replace(oldText, newText), "utf8");
      return textResult(`Edited ${path}.`);
    }
  });
}

function createWorkspaceGrepTool(context: WorkspaceToolContext): ToolDefinition {
  return defineTool({
    name: "workspace_grep",
    label: "workspace_grep",
    description: "Search UTF-8 text files below a Jarvis workspace directory.",
    promptSnippet: "Search text only in the Jarvis workspace",
    parameters: Type.Object({ query: Type.String(), path: Type.Optional(Type.String()) }),
    async execute(...[, { query, path }]) {
      const target = await authorizedWorkspacePath(context, path ?? ".", "readable");
      const matches = await grepWorkspace(target, query);
      return textResult(matches.join("\n") || "No matches.");
    }
  });
}

async function authorizedWorkspacePath(
  context: WorkspaceToolContext,
  requestedPath: string,
  access: "readable" | "writable"
): Promise<string> {
  try {
    const target = await resolveWorkspacePath(context.workspaceRoot, requestedPath);
    const allowedPaths =
      access === "readable" ? context.scope.readablePaths : context.scope.writablePaths;
    assertPathInScope(context.workspaceRoot, target, allowedPaths, access);
    if (access === "writable") assertWorkspacePathWritable(context.workspaceRoot, target);
    return target;
  } catch (error) {
    const reason = pathDenialReason(error);
    if (reason) {
      emitSecurityEvent(context.security.securityEvents, {
        type: "workspace_path.denied",
        reason,
        ...(context.security.workspaceId ? { workspaceId: context.security.workspaceId } : {}),
        ...(context.security.runId ? { runId: context.security.runId } : {}),
        ...(context.security.agentId ? { agentId: context.security.agentId } : {}),
        operationId: `workspace_${access === "readable" ? "read" : "write"}`
      });
    }
    throw error;
  }
}

function pathDenialReason(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  if (error.message.startsWith("Workspace path is outside delegated")) return "delegated_scope";
  if (error.message === "Absolute paths are not allowed outside the Jarvis workspace.") {
    return "absolute_path";
  }
  if (error.message.includes("escapes the Jarvis workspace")) return "lexical_escape";
  if (error.message.includes("resolves outside the Jarvis workspace")) return "symlink_escape";
  if (error.message.includes("read-only instruction files")) return "instruction_path_read_only";
  return undefined;
}

export function assertPathInScope(
  workspaceRoot: string,
  target: string,
  allowedPaths: readonly string[] | undefined,
  access: "readable" | "writable"
): void {
  if (allowedPaths === undefined) return;
  const root = resolve(workspaceRoot);
  const granted = allowedPaths.some((allowedPath) => {
    if (isAbsolute(allowedPath)) return false;
    const allowedTarget = resolve(root, allowedPath);
    return isWithin(root, allowedTarget) && isWithin(allowedTarget, target);
  });
  if (!granted) throw new Error(`Workspace path is outside delegated ${access} paths.`);
}

export function assertWorkspacePathWritable(workspaceRoot: string, target: string): void {
  const relativeTarget = relative(resolve(workspaceRoot), target);
  if (
    basename(relativeTarget) === "AGENTS.md" ||
    relativeTarget === ".agents/skills" ||
    relativeTarget.startsWith(`.agents/skills${sep}`)
  ) {
    throw new Error("AGENTS.md and .agents/skills are read-only instruction files.");
  }
}

export async function resolveWorkspacePath(
  workspaceRoot: string,
  requestedPath: string
): Promise<string> {
  if (isAbsolute(requestedPath)) {
    throw new Error("Absolute paths are not allowed outside the Jarvis workspace.");
  }
  // Resolve symlinks once for security checks (escape via `..` or symlink).
  // We deliberately keep the canonical root internal: the lexical path built
  // off the caller-supplied `workspaceRoot` is what we return, so callers see
  // platform-native prefixes (e.g. macOS `/var/folders/...` rather than the
  // symlink-resolved `/private/var/folders/...`).
  const canonicalRoot = await realpath(workspaceRoot);
  const lexicalTarget = resolve(workspaceRoot, requestedPath);
  const canonicalCandidate = resolve(canonicalRoot, requestedPath);
  if (!isWithin(canonicalRoot, canonicalCandidate)) {
    throw new Error("Workspace path escapes the Jarvis workspace.");
  }
  await assertResolvedPathWithinRoot(canonicalRoot, resolve(workspaceRoot), lexicalTarget);
  return lexicalTarget;
}

async function assertResolvedPathWithinRoot(
  canonicalRoot: string,
  lexicalRoot: string,
  lexicalTarget: string
): Promise<void> {
  let cursor = lexicalTarget;
  while (true) {
    try {
      const realExisting = await realpath(cursor);
      if (!isWithin(canonicalRoot, realExisting)) {
        throw new Error("Workspace path resolves outside the Jarvis workspace.");
      }
      return;
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
      const parent = dirname(cursor);
      if (parent === cursor || !isWithin(lexicalRoot, parent)) {
        throw new Error("Workspace path does not have an accessible ancestor.");
      }
      cursor = parent;
    }
  }
}

function isWithin(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}
