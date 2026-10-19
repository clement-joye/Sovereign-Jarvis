import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

export interface EventuallyOptions {
  readonly description: string;
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}

export interface TestRunContext {
  readonly runId: string;
  readonly tempDir: string;
  readonly diagnostics: DiagnosticCollector;
  makePath(...segments: string[]): string;
  cleanup(): Promise<void>;
}

export class DiagnosticCollector {
  private readonly entries: Array<{ name: string; value: unknown }> = [];

  add(name: string, value: unknown): void {
    this.entries.push({ name, value });
  }

  snapshot(): ReadonlyArray<{ name: string; value: unknown }> {
    return [...this.entries];
  }

  format(): string {
    if (this.entries.length === 0) {
      return "No diagnostics recorded.";
    }

    return this.entries
      .map(({ name, value }) => `${name}: ${formatDiagnosticValue(value)}`)
      .join("\n");
  }
}

export function createRunId(prefix = "jarvis-test"): string {
  const safePrefix = prefix
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const timestamp = Date.now().toString(36);
  return `${safePrefix || "jarvis-test"}-${timestamp}-${randomUUID()}`;
}

export async function createTestRunContext(options?: {
  readonly prefix?: string;
  readonly rootDir?: string;
}): Promise<TestRunContext> {
  const runId = createRunId(options?.prefix);
  const rootDir = resolve(options?.rootDir ?? join(tmpdir(), "jarvis-tests"));
  await mkdir(rootDir, { recursive: true });
  const tempDir = await mkdtemp(join(rootDir, `${runId}-`));
  const diagnostics = new DiagnosticCollector();
  diagnostics.add("runId", runId);
  diagnostics.add("tempDir", tempDir);

  return {
    runId,
    tempDir,
    diagnostics,
    makePath: (...segments: string[]) => safeJoin(tempDir, segments),
    cleanup: async () => {
      await rm(tempDir, { force: true, recursive: true });
    }
  };
}

export async function eventually<T>(
  operation: () => T | Promise<T>,
  options: EventuallyOptions
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const intervalMs = options.intervalMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() <= deadline) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await sleep(intervalMs);
    }
  }

  throw new Error(
    `Timed out waiting for ${options.description} after ${timeoutMs}ms.\nLast error: ${formatDiagnosticValue(lastError)}`
  );
}

function safeJoin(root: string, segments: string[]): string {
  const joined = resolve(root, ...segments);
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;

  if (joined !== root && !joined.startsWith(normalizedRoot)) {
    throw new Error(`Path escapes test temp directory: ${joined}`);
  }

  return joined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function formatDiagnosticValue(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}
