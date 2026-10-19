import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";

const ignoredPaths = [
  ".env",
  ".env.production",
  "deploy/compose/.env.production",
  "backups/backup.sql",
  "deploy/runtime/profile.json",
  ".jarvis/state.json",
  "deploy/compose/state/database/PG_VERSION",
  "deploy/compose/models/whisper.bin",
  "deploy/compose/platform-catalog/platform-catalog.v2.json",
  "deploy/compose/runtime-profile/current-runtime.json",
  "deploy/compose/matrix-crypto/store.db",
  "deploy/compose/media/cache/item.bin",
  "deploy/compose/postgres/PG_VERSION",
  "scripts/setup/generated-fixture.d.mts"
];

const allowedPaths = [
  ".env.example",
  "deploy/compose/production.env.example",
  "eslint.config.js",
  "scripts/migrations/apply-database-migrations.d.mts",
  "scripts/operator/jarvis.d.mts",
  "scripts/setup/test-artifact-fixtures.d.mts",
  "scripts/plugins/build-plugin-runtime-images.d.mts",
  "scripts/plugins/compose-plugin-release-deployer.d.mts",
  "scripts/plugins/create-agent-plugin.d.mts",
  "scripts/plugins/create-plugin.d.mts",
  "scripts/plugins/plugin-release.d.mts",
  "scripts/plugins/plugin-retirement.d.mts",
  "scripts/plugins/plugin-workflow.d.mts",
  "scripts/runtime/build-host-local-profile-release.d.mts",
  "scripts/runtime/build-profile-resource-bundle.d.mts",
  "scripts/runtime/bundle-profile-resources.d.mts",
  "scripts/runtime/host-local-profile-release.d.mts",
  "scripts/runtime/update-host-local-runtime-profile.d.mts",
  "scripts/runtime/verify-host-local-profile-runtime.d.mts"
];

for (const path of ignoredPaths) {
  try {
    execFileSync("git", ["check-ignore", "--no-index", "--quiet", path], {
      stdio: "ignore"
    });
  } catch {
    throw new Error(`Sensitive or disposable artifact is not ignored: ${path}`);
  }
}

for (const path of allowedPaths) {
  if (path.endsWith(".d.mts") || path === "eslint.config.js") {
    try {
      if (!lstatSync(path).isFile()) throw new Error("not a regular file");
    } catch {
      throw new Error(`Required source file is missing or not regular: ${path}`);
    }
  }

  try {
    execFileSync("git", ["check-ignore", "--no-index", "--quiet", path], {
      stdio: "ignore"
    });
    throw new Error(`Tracked example/template must remain visible to Git: ${path}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Tracked example")) {
      throw error;
    }
  }
}

process.stdout.write("Ignored-artifact rules are valid.\n");
