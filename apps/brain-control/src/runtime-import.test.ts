import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const sourceEntrypoint = new URL("./index.ts", import.meta.url).href;

describe("Brain Control runtime imports", () => {
  it("loads the production module graph in plain Node without Vitest state", () => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.DATABASE_URL;
    Object.assign(env, {
      NODE_ENV: "production",
      SECOND_BRAIN_ENVIRONMENT: "production",
      BRAIN_DATABASE_HOST: "127.0.0.1",
      BRAIN_DATABASE_PORT: "5432",
      BRAIN_DATABASE_NAME: "brain",
      BRAIN_DATABASE_USER: "brain",
      BRAIN_DATABASE_PASSWORD: "runtime-import-regression"
    });

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        `await import(${JSON.stringify(sourceEntrypoint)});`
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env,
        // Concurrent test workers can make the cold production import slow.
        timeout: 30_000
      }
    );

    expect(result.error).toBeUndefined();
    expect(result.status, [result.stdout, result.stderr].filter(Boolean).join("\n")).toBe(0);
  }, 35_000);
});
