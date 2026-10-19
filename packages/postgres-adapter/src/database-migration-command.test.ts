import { describe, expect, it } from "vitest";

import {
  orderedMigrationFiles,
  parseOptions,
  pendingMigrationFiles,
  resolveCurrentMigration
} from "../../../scripts/migrations/apply-database-migrations.mjs";

describe("database migration command", () => {
  it("uses the stable production Compose deployment by default", () => {
    expect(parseOptions([])).toEqual({
      envFile: "deploy/compose/.env.production",
      composeFile: "deploy/compose/compose.production.yml",
      projectName: "jarvis"
    });
  });

  it("orders only reviewed migration filenames", () => {
    expect(
      orderedMigrationFiles([
        "README.md",
        "0002_additive.sql",
        "0001_public_baseline.sql",
        "23_invalid.sql"
      ])
    ).toEqual(["0001_public_baseline.sql", "0002_additive.sql"]);
  });

  it("selects only public migrations newer than the recorded ledger", () => {
    expect(
      pendingMigrationFiles(["0001_public_baseline.sql", "0002_additive.sql", "0003_more.sql"], 1)
    ).toEqual(["0002_additive.sql", "0003_more.sql"]);
  });

  it("rejects unknown and incomplete options", () => {
    expect(() => parseOptions(["--unknown"])).toThrow("Unknown option");
    expect(() => parseOptions(["--project-name"])).toThrow("requires a value");
  });

  it("installs an empty database and accepts an exact public ledger", () => {
    expect(
      resolveCurrentMigration({
        hasApplicationSchema: false,
        hasMigrationLedger: false,
        migrationNumber: "",
        latestMigration: 1
      })
    ).toBe(0);
    expect(
      resolveCurrentMigration({
        hasApplicationSchema: true,
        hasMigrationLedger: true,
        migrationNumber: "1",
        latestMigration: 1
      })
    ).toBe(1);
  });

  it("rejects private, invalid, and newer migration ledgers", () => {
    expect(() =>
      resolveCurrentMigration({
        hasApplicationSchema: true,
        hasMigrationLedger: false,
        migrationNumber: "",
        latestMigration: 1
      })
    ).toThrow(/remove the existing Jarvis PostgreSQL volume.*setup again/i);
    expect(() =>
      resolveCurrentMigration({
        hasApplicationSchema: true,
        hasMigrationLedger: true,
        migrationNumber: "invalid",
        latestMigration: 1
      })
    ).toThrow(/ledger is empty or invalid/i);
    expect(() =>
      resolveCurrentMigration({
        hasApplicationSchema: true,
        hasMigrationLedger: true,
        migrationNumber: "2",
        latestMigration: 1
      })
    ).toThrow(/newer than this checkout supports/i);
  });
});
