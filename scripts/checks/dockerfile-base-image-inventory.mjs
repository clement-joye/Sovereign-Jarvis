import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const dockerfileRoots = ["deploy/images", "plugins"];

export async function discoverDockerfiles(repositoryRoot) {
  const files = [];
  for (const root of dockerfileRoots) {
    await collect(join(repositoryRoot, root));
  }
  return files.sort(compareStrings);

  async function collect(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await collect(path);
      else if (entry.isFile() && /(^Dockerfile(?:\.|$)|\.Dockerfile$)/.test(entry.name)) {
        files.push(path);
      }
    }
  }
}

export async function buildDockerfileBaseInventory(repositoryRoot) {
  const files = await discoverDockerfiles(repositoryRoot);
  const records = [];
  for (const file of files) {
    const contents = await readFile(file, "utf8");
    records.push(...parseDockerfileBaseInputs(contents, relative(repositoryRoot, file)));
  }
  return records;
}

export function parseDockerfileBaseInputs(contents, file) {
  const records = [];
  const globalArgs = new Map();
  const aliases = new Set();
  let beforeFirstFrom = true;
  const logicalLines = joinContinuations(contents);

  for (const { line, text } of logicalLines) {
    const trimmed = text.trim();
    const syntax = /^#\s*syntax\s*=\s*(\S+)\s*$/i.exec(trimmed);
    if (syntax) {
      records.push(
        makeImageRecord(file, line, "dockerfile-frontend", syntax[1], syntax[1], "direct")
      );
      continue;
    }

    const arg = /^ARG\s+([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?\s*$/i.exec(trimmed);
    if (arg && beforeFirstFrom) {
      globalArgs.set(arg[1], arg[2] ?? null);
      continue;
    }

    const from = /^FROM\s+(.+)$/i.exec(trimmed);
    if (!from) continue;
    beforeFirstFrom = false;
    const tokens = from[1].trim().split(/\s+/).filter(Boolean);
    while (tokens[0]?.startsWith("--")) tokens.shift();
    const expression = tokens[0];
    if (!expression) continue;
    const asIndex = tokens.findIndex((token) => token.toUpperCase() === "AS");
    const alias = asIndex >= 0 ? tokens[asIndex + 1]?.toLowerCase() : undefined;

    if (aliases.has(expression.toLowerCase())) {
      records.push({
        file,
        line,
        kind: "build-stage-reference",
        sourceExpression: expression,
        resolvedReference: null,
        resolution: "internal-stage",
        pinStatus: null,
        digest: null
      });
      if (alias) aliases.add(alias);
      continue;
    }

    const variable = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(expression);
    let resolved = expression;
    let resolution = "direct";
    if (variable) {
      const defaultValue = globalArgs.get(variable[1]);
      if (defaultValue === undefined || defaultValue === null || defaultValue === "") {
        resolved = null;
        resolution = "build-arg-value-required";
      } else {
        resolved = defaultValue;
        resolution = "global-arg-default; build-time override may differ";
      }
    }

    records.push(makeImageRecord(file, line, "from-image", expression, resolved, resolution));
    if (alias) aliases.add(alias);
  }
  return records;
}

function makeImageRecord(file, line, kind, sourceExpression, resolvedReference, resolution) {
  const digestMatch = resolvedReference?.match(/@sha256:([a-f0-9]{64})$/);
  return {
    file,
    line,
    kind,
    sourceExpression,
    resolvedReference,
    resolution,
    pinStatus: resolvedReference
      ? digestMatch
        ? "digest-pinned"
        : "mutable-reference"
      : "unresolved",
    digest: digestMatch?.[1] ?? null
  };
}

function joinContinuations(contents) {
  const result = [];
  let text = "";
  let startLine = 1;
  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    if (text.length === 0) startLine = index + 1;
    const continued = /\\\s*$/.test(rawLine);
    text += (text.length === 0 ? "" : " ") + rawLine.replace(/\\\s*$/, "");
    if (!continued) {
      result.push({ line: startLine, text });
      text = "";
    }
  }
  if (text.length > 0) result.push({ line: startLine, text });
  return result;
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
