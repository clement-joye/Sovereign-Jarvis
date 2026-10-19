import { describe, expect, it } from "vitest";

import { postgresConnectionConfig } from "./postgres-config.js";

describe("postgresConnectionConfig", () => {
  it("uses explicit connection fields so a password does not need URL encoding", () => {
    expect(
      postgresConnectionConfig({
        BRAIN_DATABASE_HOST: "brain-db",
        BRAIN_DATABASE_PASSWORD: "contains@:/#characters"
      })
    ).toEqual({
      host: "brain-db",
      port: 5432,
      database: "brain",
      user: "brain",
      password: "contains@:/#characters"
    });
  });

  it("preserves DATABASE_URL support for development and system-test stacks", () => {
    expect(
      postgresConnectionConfig({ DATABASE_URL: "postgres://brain:password@brain-db/brain" })
    ).toBe("postgres://brain:password@brain-db/brain");
  });

  it("requires a password when explicit production database settings are used", () => {
    expect(() => postgresConnectionConfig({ BRAIN_DATABASE_HOST: "brain-db" })).toThrow(
      "BRAIN_DATABASE_PASSWORD"
    );
  });
});
