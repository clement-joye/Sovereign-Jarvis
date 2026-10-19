import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

import { HostLocalRuntimeProfileManifestV1Schema } from "@second-brain/contracts";
import type { AgentCatalog } from "@second-brain/domain";
import { RuntimeTemplateCatalog } from "@second-brain/pi-adapter";

export function loadHostLocalRuntimeTemplateCatalog(
  env: NodeJS.ProcessEnv = process.env,
  agentCatalog?: AgentCatalog,
  expectedResourceDigest?: string
): RuntimeTemplateCatalog {
  const manifestPath = env.RUNTIME_CURRENT_PROFILE_PATH;
  if (!manifestPath) return new RuntimeTemplateCatalog([]);
  const manifest = HostLocalRuntimeProfileManifestV1Schema.parse(
    JSON.parse(readFileSync(manifestPath, "utf8"))
  );
  const runtime = manifest.currentRuntime;
  if (expectedResourceDigest && runtime.resourceBundle?.digest !== expectedResourceDigest) {
    throw new Error(
      `Runtime resource bundle digest does not match platform catalog: ${runtime.resourceBundle?.digest ?? "missing"}.`
    );
  }
  if (runtime.resourceBundle) {
    verifyResourceBundle(dirname(manifestPath), runtime.resourceBundle);
  }
  if (agentCatalog) assertRuntimeImagesMatchCatalog(runtime, agentCatalog);
  return new RuntimeTemplateCatalog([
    {
      templateId: runtime.templateId,
      templateVersion: runtime.templateVersion,
      specification: {
        templateId: runtime.templateId,
        templateVersion: runtime.templateVersion,
        image: runtime.imageId,
        ...(runtime.runtimeImageIds ? { runtimeImages: runtime.runtimeImageIds } : {}),
        ...(runtime.resourceBundle ? { resourceBundle: runtime.resourceBundle } : {}),
        network: runtime.network,
        modelNetwork: runtime.modelNetwork,
        writableVolumeName: `workspace-${runtime.templateId}`
      }
    }
  ]);
}

function verifyResourceBundle(
  releaseRoot: string,
  bundle: { digest: string; artifactName: string }
): void {
  const bundleRoot = join(releaseRoot, bundle.artifactName);
  const bundleRootStat = lstatSync(bundleRoot);
  if (!bundleRootStat.isDirectory() || bundleRootStat.isSymbolicLink()) {
    throw new Error("Runtime resource bundle must be a real directory.");
  }
  const inventory = JSON.parse(readFileSync(join(bundleRoot, "resource-bundle.json"), "utf8")) as {
    schemaVersion?: unknown;
    digest?: unknown;
    files?: unknown;
  };
  if (
    inventory.schemaVersion !== 1 ||
    inventory.digest !== bundle.digest ||
    !Array.isArray(inventory.files)
  ) {
    throw new Error("Runtime resource bundle manifest does not match the reviewed release.");
  }
  const hash = createHash("sha256");
  let previous = "";
  for (const value of inventory.files) {
    if (typeof value !== "string" || !safeBundlePath(value) || value.localeCompare(previous) <= 0) {
      throw new Error("Runtime resource bundle contains an invalid file inventory.");
    }
    previous = value;
    const path = join(bundleRoot, value);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Runtime resource bundle entry must be a regular file: ${value}.`);
    }
    hash.update(value, "utf8");
    hash.update("\0", "utf8");
    hash.update(readFileSync(path));
    hash.update("\0", "utf8");
  }
  if (`sha256:${hash.digest("hex")}` !== bundle.digest) {
    throw new Error("Runtime resource bundle content does not match its reviewed digest.");
  }
}

function safeBundlePath(value: string): boolean {
  return (
    value.length > 0 &&
    !isAbsolute(value) &&
    !value.includes("\\") &&
    value.split("/").every((segment) => segment && segment !== "." && segment !== "..")
  );
}

function assertRuntimeImagesMatchCatalog(
  runtime: {
    imageId: string;
    runtimeImageIds?: Partial<Record<string, string>> | undefined;
  },
  agentCatalog: AgentCatalog
): void {
  const checked = new Set<string>();
  for (const agentId of agentCatalog.ids()) {
    const runtimeClass = agentCatalog.runtimeClass(agentId);
    if (checked.has(runtimeClass.id)) continue;
    checked.add(runtimeClass.id);
    const profileImage = runtime.runtimeImageIds?.[runtimeClass.id] ?? runtime.imageId;
    if (profileImage !== runtimeClass.image) {
      throw new Error(
        `Runtime profile image for ${runtimeClass.id} does not match platform catalog: ${profileImage}.`
      );
    }
  }
}
