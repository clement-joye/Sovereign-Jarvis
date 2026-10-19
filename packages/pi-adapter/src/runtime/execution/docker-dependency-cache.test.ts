import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const imagePaths = [
  "deploy/images/node.Dockerfile",
  "deploy/images/runtime-provisioner.Dockerfile",
  "deploy/images/media-worker.Dockerfile",
  "deploy/images/pi-jarvis.Dockerfile"
];
const scopedSourceCopies = new Map([
  ["deploy/images/node.Dockerfile", "COPY apps/${APP_NAME} ./apps/${APP_NAME}"],
  [
    "deploy/images/runtime-provisioner.Dockerfile",
    "COPY apps/runtime-provisioner ./apps/runtime-provisioner"
  ],
  ["deploy/images/media-worker.Dockerfile", "COPY apps/media-worker ./apps/media-worker"],
  ["deploy/images/pi-jarvis.Dockerfile", "COPY apps/pi-runner ./apps/pi-runner"]
]);

describe("Docker dependency cache inputs", () => {
  it("primes a persistent pnpm store from the lockfile before copying source", () => {
    for (const relativePath of imagePaths) {
      const source = readFileSync(
        new URL(`../../../../../${relativePath}`, import.meta.url),
        "utf8"
      );
      const sourceCopy = scopedSourceCopies.get(relativePath)!;
      const fetch = "pnpm fetch --frozen-lockfile --store-dir=/pnpm/store";

      expect(source).toContain("# syntax=docker/dockerfile:1.7");
      expect(source).toContain("COPY package.json pnpm-lock.yaml pnpm-workspace.yaml");
      expect(source).toContain("--mount=type=cache,id=jarvis-pnpm-store,target=/pnpm/store");
      expect(source).toContain(fetch);
      expect(source).toContain(sourceCopy);
      expect(source.indexOf(fetch)).toBeLessThan(source.indexOf(sourceCopy));
      expect(source).not.toContain("COPY apps ./apps");
      expect(source).not.toContain("COPY . .");
      expect(source).toContain("pnpm install --frozen-lockfile --store-dir=/pnpm/store");
      expect(source).not.toContain("pnpm install --offline");
    }
  });

  it("builds only the selected application", () => {
    const expectedBuilds = new Map([
      ["deploy/images/node.Dockerfile", 'pnpm --filter "@second-brain/${APP_NAME}" build'],
      [
        "deploy/images/runtime-provisioner.Dockerfile",
        "pnpm --filter @second-brain/runtime-provisioner build"
      ],
      ["deploy/images/media-worker.Dockerfile", "pnpm --filter @second-brain/media-worker build"],
      ["deploy/images/pi-jarvis.Dockerfile", "pnpm --filter @second-brain/pi-runner build"]
    ]);

    for (const [relativePath, build] of expectedBuilds) {
      const source = readFileSync(
        new URL(`../../../../../${relativePath}`, import.meta.url),
        "utf8"
      );
      expect(source).toContain(build);
      expect(source).not.toContain("RUN pnpm build");
    }
  });

  it("keeps the profile npm dependencies in a BuildKit cache", () => {
    const source = readFileSync(
      new URL("../../../../../deploy/images/pi-jarvis.Dockerfile", import.meta.url),
      "utf8"
    );
    expect(source).toContain("--mount=type=cache,id=jarvis-profile-npm-cache,target=/root/.npm");
  });
});
