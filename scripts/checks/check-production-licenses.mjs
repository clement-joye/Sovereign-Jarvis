import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const inventoryPath = join(repositoryRoot, "docs/generated/production-dependency-licenses.json");
export const allowedLicenses = new Set([
  "0BSD",
  "(AFL-2.1 OR BSD-3-Clause)",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MIT",
  "Unlicense"
]);
export const explicitlyDisallowed = /(^|\s|\()A?GPL-|(^|\s|\()LGPL-|SSPL/i;

export function loadPnpmLicenseReport() {
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(executable, ["licenses", "list", "--prod", "--json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "pnpm license inventory failed");
  }
  return JSON.parse(result.stdout);
}

export function normalizeInventory(report, lockfileDigest) {
  const packages = Object.entries(report)
    .flatMap(([groupLicense, entries]) =>
      entries.flatMap((entry) =>
        entry.versions.map((version) => ({
          name: entry.name,
          version,
          license: entry.license || groupLicense,
          ...(entry.author ? { author: entry.author } : {}),
          ...(entry.homepage ? { homepage: entry.homepage } : {})
        }))
      )
    )
    .sort((left, right) =>
      compareStrings(`${left.name}@${left.version}`, `${right.name}@${right.version}`)
    );
  return {
    schemaVersion: 1,
    source: "pnpm licenses list --prod --json",
    lockfileSha256: lockfileDigest,
    packages
  };
}

export function validateLicenses(inventory) {
  const rejected = inventory.packages.filter(
    ({ license }) => explicitlyDisallowed.test(license) || !allowedLicenses.has(license)
  );
  if (rejected.length > 0) {
    const summary = rejected.map(({ name, version, license }) => `${name}@${version}: ${license}`);
    throw new Error(`Unreviewed production licenses:\n${summary.join("\n")}`);
  }
}

export async function main(args = process.argv.slice(2)) {
  const mode = args[0] ?? "check";
  if (mode !== "check" && mode !== "generate") {
    throw new Error("Usage: check-production-licenses.mjs [check|generate]");
  }
  const lockfile = await readFile(join(repositoryRoot, "pnpm-lock.yaml"));
  const lockfileDigest = createHash("sha256").update(lockfile).digest("hex");
  const inventory = normalizeInventory(loadPnpmLicenseReport(), lockfileDigest);
  validateLicenses(inventory);
  const serialized = `${JSON.stringify(inventory, null, 2)}\n`;

  if (mode === "generate") {
    await writeFile(inventoryPath, serialized, "utf8");
    console.log(`Wrote ${inventory.packages.length} production dependency licenses.`);
  } else {
    const existing = await readFile(inventoryPath, "utf8");
    if (existing !== serialized) {
      throw new Error(
        "Production dependency license inventory is stale. Run pnpm licenses:generate."
      );
    }
    console.log(`Verified ${inventory.packages.length} production dependency licenses.`);
  }
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
