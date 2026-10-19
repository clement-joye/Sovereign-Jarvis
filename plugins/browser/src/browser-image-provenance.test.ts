import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const deployDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../deploy");
const dockerfile = readFileSync(resolve(deployDirectory, "browser.Dockerfile"), "utf8");

describe("Browser image dependency provenance", () => {
  it("installs its npm runtime closure from the committed lockfile", () => {
    const manifest = JSON.parse(readFileSync(resolve(deployDirectory, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const lock = JSON.parse(
      readFileSync(resolve(deployDirectory, "package-lock.json"), "utf8")
    ) as {
      lockfileVersion: number;
      packages: Record<string, { version?: string; integrity?: string }>;
    };

    expect(lock.lockfileVersion).toBe(3);
    for (const [name, version] of Object.entries(manifest.dependencies)) {
      const locked = lock.packages[`node_modules/${name}`];
      expect(locked?.version).toBe(version);
      expect(locked?.integrity).toMatch(/^sha512-/);
    }
    expect(lock.packages["node_modules/playwright-core"]?.integrity).toMatch(/^sha512-/);
    expect(dockerfile).toContain("npm ci --prefix /opt/browser-profile");
    expect(dockerfile).not.toMatch(/npm install --prefix \/opt\/browser-profile/);
  });

  it("pins every Python runtime dependency with artifact hashes", () => {
    const requirements = readFileSync(resolve(deployDirectory, "requirements.lock"), "utf8");
    const packages = [
      ...requirements.matchAll(
        /^([A-Za-z0-9_-]+)==([^\s\\]+) \\\n((?:    --hash=sha256:[a-f0-9]{64} \\\n)*    --hash=sha256:[a-f0-9]{64})$/gm
      )
    ];

    expect(packages).toHaveLength(8);
    expect(requirements).not.toMatch(/^--hash=sha256:(?![a-f0-9]{64}$)/m);
    expect(dockerfile).toContain("pip install --require-hashes");
    expect(dockerfile).toContain("playwright-core/browsers.json");
    expect(dockerfile).toContain('["chromium","1217"]');
    expect(dockerfile).toContain('["chromium-headless-shell","1217"]');
    expect(dockerfile).toContain('["ffmpeg","1011"]');
    expect(dockerfile).toContain("browser.revision!==revision");
    expect(dockerfile).toContain("node /opt/browser-profile/install-verified-playwright.mjs");
    expect(dockerfile).not.toContain("/.bin/playwright install chromium");
  });
});
