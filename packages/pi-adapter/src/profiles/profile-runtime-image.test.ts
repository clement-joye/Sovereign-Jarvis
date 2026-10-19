import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const dockerfile = fileURLToPath(
  new URL("../../../../deploy/images/pi-jarvis.Dockerfile", import.meta.url)
);
const dockerignore = fileURLToPath(new URL("../../../../.dockerignore", import.meta.url));
const browserDockerfile = fileURLToPath(
  new URL("../../../../plugins/browser/deploy/browser.Dockerfile", import.meta.url)
);
const runtimeModels = fileURLToPath(
  new URL("../../../../deploy/pi-runtime/models.json", import.meta.url)
);
const releaseBuilder = fileURLToPath(
  new URL("../../../../scripts/runtime/build-host-local-profile-release.mjs", import.meta.url)
);

describe("reviewed profile runtime image", () => {
  it("passes its immutable profile root explicitly to Pi Runner", () => {
    const source = readFileSync(dockerfile, "utf8");

    expect(source).toContain("PI_PROFILE_ROOT=/opt/profile");
    expect(source).not.toContain("PI_CODING_AGENT_DIR=/opt/profile");
    expect(source).toContain("PI_WORKSPACE_ROOT=/workspace");
    expect(source).toContain("PI_RUNNER_IMPLEMENTATION=pi-coding-agent");
    expect(source).not.toContain("git_status");
    expect(source).not.toContain("PI_BRAIN_ALLOWED_TOOLS=");
    expect(source).not.toContain("PI_CODE_ALLOWED_TOOLS=");
    expect(source).not.toContain("LITTLE_CODER_ALLOWED_TOOLS=");
    expect(source).toContain("PI_MODELS_PATH=/opt/profile/models.json");
    expect(source).toContain("apt-get install --no-install-recommends --yes curl tesseract-ocr");
    expect(source).not.toContain("curl wget");
    expect(source).toContain(
      "COPY --from=build /opt/profile-dependencies/node_modules /opt/profile/node_modules"
    );
    expect(source).toContain("# syntax=docker/dockerfile:1.7");
    expect(source).toContain("pnpm fetch --frozen-lockfile --store-dir=/pnpm/store");
    expect(source).toContain("COPY tsconfig.json tsconfig.base.json ./");
    expect(source).toContain("pnpm install --frozen-lockfile --store-dir=/pnpm/store");
    expect(source).not.toContain("pnpm install --offline");
    expect(source).toContain("--mount=type=cache,id=jarvis-pnpm-store,target=/pnpm/store");
    expect(source).toContain("--mount=type=cache,id=jarvis-profile-npm-cache,target=/root/.npm");
    expect(source).toContain("pnpm --filter @second-brain/pi-runner build");
    expect(source).toContain(
      "pnpm --filter @second-brain/pi-runner deploy --legacy --prod /runtime"
    );
    expect(source).not.toContain("deploy --legacy --prod --offline");
    expect(source).toContain("COPY apps/pi-runner ./apps/pi-runner");
    expect(source).not.toContain("COPY . .");
    expect(source.indexOf("pnpm fetch --frozen-lockfile --store-dir=/pnpm/store")).toBeLessThan(
      source.indexOf("COPY apps/pi-runner ./apps/pi-runner")
    );
    expect(readFileSync(dockerignore, "utf8")).toContain("**/.env*");
    expect(source).toContain("COPY --from=build /runtime /app");
    expect(source).not.toContain("runtime-settings.json");
    expect(source).not.toContain("jarvis-models.json");
    expect(source).not.toContain("profiles/pi-jarvis");
    expect(source).not.toContain("COPY plugins/git-remote/skills");
    expect(source).not.toContain("COPY plugins /opt/plugin-sources");
    expect(source).toContain('CMD ["node", "/app/dist/src/index.js"]');
    expect(source).toContain("FROM profile-base AS base-runtime");
    expect(source).not.toContain("browser-runtime");
    const browserSource = readFileSync(browserDockerfile, "utf8");
    expect(browserSource).toContain(
      "FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS browser-assets"
    );
    expect(browserSource).toContain("FROM ${BASE_RUNTIME_IMAGE} AS browser-runtime");
    expect(browserSource).toContain("PLAYWRIGHT_BROWSERS_PATH=/ms-playwright");
    expect(browserSource).toContain("node /opt/browser-profile/install-verified-playwright.mjs");
    expect(browserSource).toContain(
      "npm ci --prefix /opt/browser-profile --omit=dev --ignore-scripts"
    );
    expect(browserSource).toContain("COPY --from=browser-assets /ms-playwright /ms-playwright");
    expect(browserSource.indexOf("install-verified-playwright.mjs")).toBeLessThan(
      browserSource.indexOf("FROM ${BASE_RUNTIME_IMAGE} AS browser-runtime")
    );
    expect(browserSource).toContain("jq python3 python3-venv w3m");
    expect(browserSource).toContain("pip install --require-hashes");
    expect(browserSource).toContain(
      "ENV PI_ALLOWED_TOOLS=websearch,web_fetch,browser_navigate,browser_scroll,browser_extract,browser_back,browser_history,browser_click,browser_type"
    );
    expect(source).toContain("COPY deploy/pi-runtime/npm/package.json /opt/profile/package.json");
    expect(source).toContain("COPY deploy/pi-runtime/models.json /opt/profile/models.json");
    expect(source).toContain(
      "COPY plugins/core-agents/resources/extensions /opt/profile/extensions"
    );
    expect(source).not.toContain("profile-runtime");
    expect(source).not.toContain(".pi/BRAIN.md");
  });

  it("keeps Playwright out of the shared profile dependency manifest", () => {
    const sourceManifest = fileURLToPath(
      new URL("../../../../deploy/pi-runtime/npm/package.json", import.meta.url)
    );
    const manifest = JSON.parse(readFileSync(sourceManifest, "utf8")) as { dependencies: object };
    expect(manifest.dependencies).not.toHaveProperty("playwright");
  });

  it("does not package a global Pi settings or system prompt file", () => {
    const source = readFileSync(dockerfile, "utf8");
    expect(source).not.toMatch(/COPY .*settings\.json/u);
    expect(source).not.toMatch(/COPY .*SYSTEM\.md/u);
  });

  it("declares the reviewed Qwen profile as image-capable", () => {
    const runtime = JSON.parse(readFileSync(runtimeModels, "utf8")) as {
      providers: { omlx: { models: unknown } };
    };

    expect(runtime.providers.omlx.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "Qwen3.6-35B-A3B-OptiQ-4bit:profile-qwen-general",
          input: ["text", "image"]
        })
      ])
    );
  });

  it("instructs Document Analyzer to treat attachment-only messages as content", () => {
    const promptPath = fileURLToPath(
      new URL(
        "../../../../plugins/core-agents/resources/document-analyzer/AGENTS.md",
        import.meta.url
      )
    );
    const prompt = readFileSync(promptPath, "utf8");

    expect(prompt).toContain("[Attachments available in this request]");
    expect(prompt).toContain("An empty message body is normal");
    expect(prompt).toContain("Images are embedded directly in your multimodal model input");
    expect(prompt).toContain("No image-viewing, OCR, Bash, or");
    expect(prompt).toContain("workspace tool is required to see an image");
    expect(prompt).toContain("Do not inspect, search, or");
    expect(prompt).toContain("call `workspace_write` directly with that finished analysis");
  });

  it("discovers plugin-owned runtime images for the release manifest", () => {
    const source = readFileSync(releaseBuilder, "utf8");

    expect(source).toContain("buildPluginRuntimeImages");
    expect(source).toContain("buildHostLocalReleaseManifest(imageId, runtimeImageIds, {");
  });
});
