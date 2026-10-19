import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { StagedRelease } from "../../../scripts/plugins/plugin-release.mjs";
import {
  createComposePluginReleaseDeployer,
  durableAgentReferencesSql,
  schemaMigrationSql
} from "../../../scripts/plugins/compose-plugin-release-deployer.mjs";

const image = `sha256:${"a".repeat(64)}`;

function release(controlPlane = image): StagedRelease {
  const artifact = (path: string) => ({ path, sha256: image });
  return {
    schemaVersion: 1,
    pluginApiSchemaRevision: 1,
    id: "release-test",
    gitRevision: "a".repeat(40),
    databaseCompatibility: { minimumMigration: 1, maximumMigration: 3 },
    catalogDigest: image,
    modelCatalogDigest: image,
    artifacts: {
      catalog: artifact("platform-catalog.v2.json"),
      runtimeManifest: artifact("runtime-manifest.json"),
      modelCatalog: artifact("model-catalog.json")
    },
    imageIds: {
      controlPlane,
      runtimeClasses: { base: image, isolated: image, browser: image }
    }
  };
}

describe("Compose plugin release deployer", () => {
  it("uses the same active durable-reference semantics as the PostgreSQL adapter", () => {
    for (const historicalTable of ["inbound_messages", "agent_artifacts"]) {
      expect(durableAgentReferencesSql).not.toContain(historicalTable);
    }
    expect(durableAgentReferencesSql).toContain("enabled = true AND deleted_at IS NULL");
    for (const status of [
      "queued",
      "running",
      "proposed",
      "approved",
      "pending",
      "leased",
      "retry_wait"
    ])
      expect(durableAgentReferencesSql).toContain(`'${status}'`);
    for (const status of [
      "completed",
      "dead_letter",
      "rejected",
      "consumed",
      "expired",
      "cancelled"
    ])
      expect(durableAgentReferencesSql).not.toContain(`'${status}'`);
    expect(durableAgentReferencesSql).toContain("delegation_grants.expires_at > now()");
    expect(durableAgentReferencesSql).toContain("payload->>'agentId'");
  });

  it("preflights, snapshots, atomically publishes, migrates, and resumes services", async () => {
    const root = await mkdtemp(join(tmpdir(), "compose-release-"));
    const releaseDirectory = join(root, "release");
    const migrationsDirectory = join(root, "migrations");
    const catalogTarget = join(root, "live", "platform-catalog.v2.json");
    const runtimeTarget = join(root, "live", "current-runtime.json");
    await mkdir(releaseDirectory);
    await mkdir(migrationsDirectory);
    await mkdir(join(root, "live"));
    await Promise.all([
      writeFile(join(releaseDirectory, "platform-catalog.v2.json"), "new catalog"),
      writeFile(join(releaseDirectory, "runtime-manifest.json"), "new runtime"),
      writeFile(catalogTarget, "old catalog"),
      writeFile(runtimeTarget, "old runtime"),
      writeFile(join(migrationsDirectory, "0002_additive.sql"), "SELECT 2;"),
      writeFile(join(migrationsDirectory, "0003_additive.sql"), "SELECT 3;")
    ]);
    const calls: Array<{ args: string[]; input?: string }> = [];
    const runner = (_command: string, args: string[], options?: { input?: string }) => {
      if (options?.input === undefined) calls.push({ args });
      else calls.push({ args, input: options.input });
      const sql = args.at(-1);
      if (args[0] === "image") return { status: 0, stdout: `${image}\n` };
      if (args.includes("config"))
        return {
          status: 0,
          stdout: JSON.stringify({
            services: { "brain-control": { image: `jarvis/brain-control@${image}` } }
          })
        };
      if (sql?.includes("json_build_object"))
        return {
          status: 0,
          stdout:
            '{"brainCoreSchema":true,"hasMigrationLedger":true,"hasDynamicAgentIdentifiers":true}\n'
        };
      if (sql === schemaMigrationSql) return { status: 0, stdout: "1\n" };
      if (sql === durableAgentReferencesSql) return { status: 0, stdout: "durable-agent\n" };
      if (args.includes("pg_dump")) return { status: 0, stdout: "-- dump\n" };
      return { status: 0, stdout: "" };
    };
    const deployer = createComposePluginReleaseDeployer({
      commandRunner: runner,
      projectRoot: root,
      migrationsDirectory,
      backupDirectory: join(root, "backups"),
      artifactTargets: { catalog: catalogTarget, runtimeManifest: runtimeTarget }
    });
    await deployer.deploy(release(), releaseDirectory);
    await expect(readFile(catalogTarget, "utf8")).resolves.toBe("new catalog");
    await expect(readFile(runtimeTarget, "utf8")).resolves.toBe("new runtime");
    expect(calls.some(({ args }) => args.includes("pg_dump"))).toBe(true);
    expect(calls.filter(({ input }) => input).map(({ input }) => input)).toEqual([
      "SELECT 2;",
      "SELECT 3;"
    ]);
    const catalogConsumers = [
      "brain-control",
      "runtime-provisioner",
      "matrix-gateway",
      "brain-worker",
      "brain-delegation-worker"
    ];
    expect(
      calls.some(
        ({ args }) =>
          args.includes("stop") &&
          [...catalogConsumers, "scheduler"].every((service) => args.includes(service))
      )
    ).toBe(true);
    expect(
      calls.some(
        ({ args }) =>
          args.includes("--wait") &&
          args.includes("--force-recreate") &&
          catalogConsumers.every((service) => args.includes(service))
      )
    ).toBe(true);
    expect(calls.some(({ args }) => args.includes("start") && args.includes("scheduler"))).toBe(
      true
    );
    expect(
      calls
        .filter(({ args }) => args.includes("stop") || args.includes("start"))
        .every(({ args }) => !args.includes("--volumes"))
    ).toBe(true);
    const backupDirectory = join(root, "backups");
    const backup = (await (await import("node:fs/promises")).readdir(backupDirectory))[0];
    if (!backup) throw new Error("Expected a deployment backup.");
    await expect(readFile(join(backupDirectory, backup, "brain-db.sql"), "utf8")).resolves.toBe(
      "-- dump\n"
    );
  });

  it("refuses a release whose image does not match Compose before mutation", async () => {
    const root = await mkdtemp(join(tmpdir(), "compose-release-"));
    const target = join(root, "catalog.json");
    await writeFile(target, "old");
    let calls = 0;
    const deployer = createComposePluginReleaseDeployer({
      artifactTargets: { catalog: target, runtimeManifest: target },
      projectRoot: root,
      commandRunner: (_command, args) => {
        calls++;
        if (args[0] === "image") return { status: 0, stdout: image };
        if (args.includes("config"))
          return {
            status: 0,
            stdout: JSON.stringify({ services: { "brain-control": { image } } })
          };
        if (args.at(-1)?.includes("json_build_object"))
          return {
            status: 0,
            stdout:
              '{"brainCoreSchema":true,"hasMigrationLedger":true,"hasDynamicAgentIdentifiers":true}'
          };
        if (args.at(-1) === schemaMigrationSql) return { status: 0, stdout: "1" };
        return { status: 0, stdout: "" };
      }
    });
    await expect(deployer.deploy(release(`sha256:${"b".repeat(64)}`), root)).rejects.toThrow(
      /does not match/
    );
    expect(calls).toBe(5);
    await expect(readFile(target, "utf8")).resolves.toBe("old");
  });

  it("rejects a private schema when the public ledger is absent", async () => {
    const calls: string[] = [];
    const deployer = createComposePluginReleaseDeployer({
      projectRoot: await mkdtemp(join(tmpdir(), "compose-release-")),
      artifactTargets: { catalog: "/tmp/catalog.json", runtimeManifest: "/tmp/runtime.json" },
      commandRunner: (_command, args) => {
        const sql = args.at(-1) ?? "";
        calls.push(sql);
        if (args[0] === "image") return { status: 0, stdout: image };
        if (args.includes("config")) {
          return {
            status: 0,
            stdout: JSON.stringify({
              services: { "brain-control": { image: `jarvis/brain-control@${image}` } }
            })
          };
        }
        if (sql === schemaMigrationSql) return { status: 0, stdout: "" };
        if (sql === durableAgentReferencesSql) return { status: 0, stdout: "legacy-agent\n" };
        return {
          status: 0,
          stdout:
            '{"brainCoreSchema":true,"hasMigrationLedger":false,"hasDynamicAgentIdentifiers":true}'
        };
      }
    });

    await expect(deployer.preflight()).rejects.toThrow(/ledger is absent or invalid/);
    expect(calls).not.toContain(schemaMigrationSql);
    expect(calls).not.toContain(durableAgentReferencesSql);
  });

  it("fails closed when both the migration ledger and legacy 0023 sentinel are absent", async () => {
    const calls: string[] = [];
    const deployer = createComposePluginReleaseDeployer({
      projectRoot: await mkdtemp(join(tmpdir(), "compose-release-")),
      artifactTargets: { catalog: "/tmp/catalog.json", runtimeManifest: "/tmp/runtime.json" },
      commandRunner: (_command, args) => {
        const sql = args.at(-1) ?? "";
        calls.push(sql);
        if (args[0] === "image") return { status: 0, stdout: image };
        if (args.includes("config")) {
          return {
            status: 0,
            stdout: JSON.stringify({
              services: { "brain-control": { image: `jarvis/brain-control@${image}` } }
            })
          };
        }
        return {
          status: 0,
          stdout:
            '{"brainCoreSchema":true,"hasMigrationLedger":false,"hasDynamicAgentIdentifiers":false}'
        };
      }
    });

    await expect(deployer.preflight()).rejects.toThrow(/ledger is absent or invalid/);
    expect(calls).not.toContain(durableAgentReferencesSql);
  });
});
