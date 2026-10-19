import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { measureBuildKitProgress } from "./measure-buildkit.mjs";

const fixture = await readFile(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/buildkit-progress.rawjson"),
  "utf8"
);

test("merges vertex updates and records execution, cache, targets, and wall time", () => {
  assert.deepEqual(
    measureBuildKitProgress(fixture, {
      scenario: "browser",
      requestedTargets: ["browser", "base"],
      metadata: { run: "fixture", provider: "fake" }
    }),
    {
      scenario: "browser",
      requestedTargets: ["browser", "base"],
      wallTimeMs: 2000,
      vertices: { total: 4, executed: 2, cached: 2 },
      metadata: { run: "fixture", provider: "fake" }
    }
  );
});

test("accepts numeric timestamps and ignores non-vertex auxiliary records", () => {
  const result = measureBuildKitProgress(
    '{"aux":{"ID":"sha256:test"}}\n{"id":"one","started":100,"completed":250}\n{"id":"two","status":"CACHED"}',
    { scenario: "no-op" }
  );
  assert.deepEqual(result.vertices, { total: 2, executed: 1, cached: 1 });
  assert.equal(result.wallTimeMs, 150);
});

test("accepts modern BuildKit vertexes batches and digest identifiers", () => {
  const result = measureBuildKitProgress(
    [
      JSON.stringify({
        vertexes: [
          { digest: "sha256:a", started: "2026-01-01T00:00:00Z" },
          { digest: "sha256:b", cached: true, completed: "2026-01-01T00:00:01Z" }
        ]
      }),
      JSON.stringify({
        vertexes: [
          { digest: "sha256:a", completed: "2026-01-01T00:00:02Z" },
          { digest: "sha256:b", cached: true }
        ]
      })
    ].join("\n"),
    { scenario: "no-op" }
  );
  assert.deepEqual(result.vertices, { total: 2, executed: 1, cached: 1 });
  assert.equal(result.wallTimeMs, 2000);
});

test("rejects malformed input and unknown scenarios", () => {
  assert.throws(() => measureBuildKitProgress("not-json", { scenario: "compose" }), /line 1/);
  assert.throws(
    () => measureBuildKitProgress(fixture, { scenario: "other" }),
    /Unknown measurement scenario/
  );
});
