#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const scenarios = new Set(["no-op", "prompt", "provider", "browser", "compose"]);

/**
 * Parse BuildKit's one-JSON-object-per-line progress format into a stable
 * measurement record. BuildKit emits multiple updates for a vertex, so the
 * vertices are merged by id before counts are calculated.
 *
 * @param {string} rawJson
 * @param {{scenario: string, requestedTargets?: string[], metadata?: Record<string, unknown>}} options
 */
export function measureBuildKitProgress(rawJson, options) {
  if (!scenarios.has(options.scenario)) {
    throw new Error(`Unknown measurement scenario: ${options.scenario}`);
  }

  /** @type {Map<string, {cached: boolean, started?: number, completed?: number}>} */
  const vertices = new Map();
  const lines = rawJson.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `Invalid BuildKit JSON on line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (!event || typeof event !== "object" || Array.isArray(event)) continue;

    // Modern BuildKit raw-JSON groups updates under a `vertexes` array; older
    // emitters use one top-level vertex/id object. Normalize both shapes.
    const updates = Array.isArray(event.vertexes) ? event.vertexes : [event];
    for (const update of updates) {
      if (!update || typeof update !== "object" || Array.isArray(update)) continue;
      const id =
        typeof update.vertex === "string"
          ? update.vertex
          : typeof update.digest === "string"
            ? update.digest
            : typeof update.id === "string"
              ? update.id
              : undefined;
      if (id === undefined) continue;
      const vertex = vertices.get(id) ?? { cached: false };
      if (
        update.cached === true ||
        (typeof update.status === "string" && update.status.toLowerCase() === "cached")
      ) {
        vertex.cached = true;
      }
      const started = parseTimestamp(update.started);
      const completed = parseTimestamp(update.completed);
      if (started !== undefined)
        vertex.started = vertex.started === undefined ? started : Math.min(vertex.started, started);
      if (completed !== undefined) {
        vertex.completed =
          vertex.completed === undefined ? completed : Math.max(vertex.completed, completed);
      }
      vertices.set(id, vertex);
    }
  }

  const allTimestamps = [...vertices.values()].flatMap((vertex) =>
    [vertex.started, vertex.completed].filter((timestamp) => timestamp !== undefined)
  );
  const wallTimeMs =
    allTimestamps.length > 1 ? Math.max(...allTimestamps) - Math.min(...allTimestamps) : null;
  let cachedVertices = 0;
  for (const vertex of vertices.values()) {
    if (vertex.cached) cachedVertices += 1;
  }

  return {
    scenario: options.scenario,
    requestedTargets: [...(options.requestedTargets ?? [])],
    wallTimeMs,
    vertices: {
      total: vertices.size,
      executed: vertices.size - cachedVertices,
      cached: cachedVertices
    },
    metadata: { ...(options.metadata ?? {}) }
  };
}

function parseTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const rawJson = args.input === "-" ? await readStdin() : await readFile(args.input, "utf8");
  const measurement = measureBuildKitProgress(rawJson, {
    scenario: args.scenario,
    requestedTargets: args.targets,
    metadata: args.metadata
  });
  const output = `${JSON.stringify(measurement)}\n`;
  if (args.output === "-") process.stdout.write(output);
  else await writeFile(args.output, output, "utf8");
}

function parseArguments(argv) {
  /** @type {{input: string, output: string, scenario: string, targets: string[], metadata: Record<string, unknown>}} */
  const result = { input: "-", output: "-", scenario: "", targets: [], metadata: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--input" && value !== undefined) {
      result.input = value;
      index += 1;
    } else if (argument === "--output" && value !== undefined) {
      result.output = value;
      index += 1;
    } else if (argument === "--scenario" && value !== undefined) {
      result.scenario = value;
      index += 1;
    } else if (argument === "--target" && value !== undefined) {
      result.targets.push(
        ...value
          .split(",")
          .map((target) => target.trim())
          .filter(Boolean)
      );
      index += 1;
    } else if (argument === "--metadata" && value !== undefined) {
      const metadata = JSON.parse(value);
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        throw new Error("--metadata must be a JSON object");
      }
      result.metadata = metadata;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  if (!scenarios.has(result.scenario)) {
    throw new Error("--scenario must be one of: no-op, prompt, provider, browser, compose");
  }
  return result;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
