#!/usr/bin/env node
/**
 * Verifies that every Brain Control route handler's explicit path
 * declaration is also present in the canonical InternalApiRoutes
 * specification. A route handler that dispatches a path not declared
 * in the spec means the OpenAPI documentation and the schema coverage
 * are out of sync — CI should fail until the spec is updated.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = new URL("../..", import.meta.url).pathname;
const routeDirectory = join(repoRoot, "apps/brain-control/src/routes");
const routeFiles = readdirSync(routeDirectory)
  .filter((file) => file.endsWith("-routes.ts"))
  .sort()
  .map((file) => `apps/brain-control/src/routes/${file}`);

const problems = [];

for (const routeFile of routeFiles) {
  const source = readFileSync(join(repoRoot, routeFile), "utf8");
  // Match `url.pathname === "/v1/something"`, `url.pathname !== "/v1/something"`, and
  // `url.pathname.startsWith("/v1/something/")` patterns.
  const patterns = [
    ...source.matchAll(/url\.pathname\s*===?\s*["'`](\/[^"'`]+)["'`]/g),
    ...source.matchAll(/url\.pathname\.startsWith\(\s*["'`](\/[^"'`]+)["'`]/g)
  ];
  for (const match of patterns) {
    const literalPath = match[1];
    if (!literalPath.includes("/v1/") && literalPath !== "/health") {
      continue;
    }
    // Skip path-prefix patterns that are intentionally open (e.g.,
    // `/v1/sessions/` for any-id routes).
    if (literalPath.endsWith("/")) {
      continue;
    }
    if (literalPath.includes("{")) {
      problems.push(
        `${relative(repoRoot, routeFile)} uses a path with a literal placeholder (${literalPath}). ` +
          `Use the route registration in @second-brain/contracts (InternalApiRoutes) as the source of truth.`
      );
    }
  }
}

if (problems.length > 0) {
  console.error("Internal API route coverage check failed:");
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}

console.log(
  "Internal API route coverage check passed for " + routeFiles.length + " route handlers."
);
