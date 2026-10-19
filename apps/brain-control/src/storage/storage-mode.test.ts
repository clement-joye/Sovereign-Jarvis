import { describe, expect, it } from "vitest";

import { resolveBrainControlStorageMode } from "./storage-mode.js";

describe("resolveBrainControlStorageMode", () => {
  it("uses durable storage whenever a database connection is configured", () => {
    expect(
      resolveBrainControlStorageMode({
        environment: "dev",
        postgresConnection: "postgres://brain:password@brain-db/brain"
      })
    ).toBe("postgres");
  });

  it("permits ephemeral storage only outside production", () => {
    expect(
      resolveBrainControlStorageMode({ environment: "dev", postgresConnection: undefined })
    ).toBe("ephemeral");
    expect(() =>
      resolveBrainControlStorageMode({ environment: "production", postgresConnection: undefined })
    ).toThrow("ephemeral storage is not permitted");
  });
});
