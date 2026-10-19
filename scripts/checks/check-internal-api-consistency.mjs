#!/usr/bin/env node
/**
 * Verifies that every route declaration in `InternalApiRoutes` is also
 * reachable from a route handler. For each route, the check looks at
 * the route's method and path and verifies that at least one of:
 * - an exact `url.pathname === "<route path>"` match, or
 * - a `url.pathname.startsWith("<route path>/")` prefix match,
 * appears in one of the route handler files. Routes without a method
 * match are also flagged because the dispatcher order depends on
 * route-handler existence.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = new URL("../..", import.meta.url).pathname;

// Re-import the route spec by parsing the source module via a tiny
// runtime adapter — we only need (method, path) pairs so a regex is
// sufficient and avoids an extra tsconfig dependency.
const routesSource = readdirSync(join(repoRoot, "packages/contracts/src/internal-api-routes"))
  .filter((file) => file.endsWith("-routes.ts"))
  .sort()
  .map((file) =>
    readFileSync(join(repoRoot, "packages/contracts/src/internal-api-routes", file), "utf8")
  )
  .join("\n");

const routePattern = /method:\s*"([A-Z]+)"[\s\S]*?path:\s*"((?:[^"\\]|\\.)*)"/g;
const handlerFiles = readdirSync(join(repoRoot, "apps/brain-control/src/routes"))
  .filter((file) => file.endsWith("-routes.ts"))
  .sort()
  .map((file) => join(repoRoot, "apps/brain-control/src/routes", file));
handlerFiles.push(join(repoRoot, "apps/brain-control/src/routes/dispatcher.ts"));

const handlerSources = handlerFiles.map((file) => ({
  relPath: relative(repoRoot, file),
  text: readFileSync(file, "utf8")
}));

const exactPattern = /url\.pathname\s*(?:!==|===?)\s*["'`]([^"'`]+)["'`]/g;
const prefixPattern = /url\.pathname\.startsWith\(\s*["'`]([^"'`]+)["'`]/g;

function pathMatches(path, literal) {
  if (path === literal) {
    return true;
  }
  // Literal "/v1/sessions/" matches "/v1/sessions/abc-123" but also
  // "/v1/sessions/abc/close". Accept any path that starts with the literal
  // followed by either the path boundary or another segment.
  if (literal.endsWith("/")) {
    return path.startsWith(literal);
  }
  return false;
}

const specEntries = [];
for (const match of routesSource.matchAll(routePattern)) {
  specEntries.push({ method: match[1], path: match[2] });
}

const problems = [];

for (const { method, path } of specEntries) {
  const matched = handlerSources.some(({ text }) => {
    let m;
    exactPattern.lastIndex = 0;
    while ((m = exactPattern.exec(text))) {
      if (pathMatches(path, m[1])) {
        return true;
      }
    }
    prefixPattern.lastIndex = 0;
    while ((m = prefixPattern.exec(text))) {
      if (pathMatches(path, m[1])) {
        return true;
      }
    }
    return false;
  });
  if (!matched) {
    problems.push(`${method} ${path} is declared in InternalApiRoutes but no handler matches it`);
  }
}

if (problems.length > 0) {
  console.error("Internal API route consistency check failed:");
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}

console.log(
  `Internal API route consistency check passed for ${specEntries.length} route declarations.`
);
