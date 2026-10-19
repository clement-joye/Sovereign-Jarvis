import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const image = (letter) => `sha256:${letter.repeat(64)}`;

export async function writeValidReleaseArtifacts(stateRoot) {
  const runtime = {
    schemaVersion: 1,
    profileArtifact: {
      schemaVersion: 1,
      id: "pi-jarvis",
      version: "1.0.0",
      source: {
        repository: "https://example.test/jarvis-profile",
        revision: "0123456789abcdef0123456789abcdef01234567",
        digest: image("c")
      },
      runtimeImage: image("a"),
      modelsPath: "models.json",
      resources: [
        {
          path: "extensions/example",
          kind: "extension",
          compatibility: "sdk-compatible",
          rationale: "Fixture profile resource."
        }
      ]
    },
    currentRuntime: {
      templateId: "code-project",
      templateVersion: "1.0.0",
      imageId: image("a"),
      runtimeImageIds: { browser: image("b") },
      network: "restricted",
      modelNetwork: "restricted"
    }
  };
  const content = {
    schemaVersion: 2,
    runtimeClasses: [
      { id: "base", image: image("a") },
      { id: "isolated", image: image("a") },
      { id: "browser", image: image("b") }
    ],
    plugins: [{ id: "fixture" }],
    agents: [{ id: "fixture" }],
    capabilities: [],
    runtimeFeatures: [],
    reviewedModels: []
  };
  const digest = `sha256:${createHash("sha256").update(stableJson(content)).digest("hex")}`;
  await writeFile(
    join(stateRoot, "runtime-profile", "current-runtime.json"),
    `${JSON.stringify(runtime)}\n`
  );
  await writeFile(
    join(stateRoot, "platform-catalog", "platform-catalog.v2.json"),
    `${JSON.stringify({ ...content, digest })}\n`
  );
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
