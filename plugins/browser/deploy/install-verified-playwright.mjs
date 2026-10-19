#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const deployDirectory = dirname(fileURLToPath(import.meta.url));
const expectedNames = ["chromium", "chromium-headless-shell", "ffmpeg"];

export function selectPlatformArchives(manifest, packageManifest, browsers, architecture) {
  const platform =
    architecture === "x64" ? "linux/amd64" : architecture === "arm64" ? "linux/arm64" : undefined;
  if (!platform) throw new Error(`Unsupported Browser build architecture: ${architecture}`);
  if (
    manifest.schemaVersion !== 1 ||
    packageManifest.dependencies?.playwright !== manifest.playwrightVersion
  ) {
    throw new Error("Browser package and reviewed Playwright archive manifest disagree.");
  }
  for (const [name, revision, version] of [
    ["chromium", manifest.chromiumRevision, manifest.chromiumVersion],
    ["chromium-headless-shell", manifest.chromiumRevision, manifest.chromiumVersion],
    ["ffmpeg", manifest.ffmpegRevision, undefined]
  ]) {
    const browser = browsers.browsers?.find((entry) => entry.name === name);
    if (!browser || browser.revision !== revision || browser.browserVersion !== version) {
      throw new Error(`Browser package and reviewed ${name} revision disagree.`);
    }
  }
  const entries = manifest.platforms?.[platform];
  if (!Array.isArray(entries) || entries.length !== expectedNames.length) {
    throw new Error(`Reviewed Playwright archives are missing for ${platform}.`);
  }
  for (const [index, entry] of entries.entries()) {
    if (
      entry.name !== expectedNames[index] ||
      typeof entry.path !== "string" ||
      !/^builds\/[A-Za-z0-9./-]+\.zip$/u.test(entry.path) ||
      entry.path.includes("..") ||
      typeof entry.sourceUrl !== "string" ||
      !entry.sourceUrl.startsWith("https://cdn.playwright.dev/") ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes <= 0 ||
      !/^[a-f0-9]{64}$/u.test(entry.sha256)
    ) {
      throw new Error(`Invalid reviewed Playwright archive entry for ${platform}.`);
    }
  }
  return entries;
}

export async function installVerifiedArchives(entries, dependencies = {}) {
  const download = dependencies.download ?? downloadArchive;
  const install = dependencies.install ?? runPlaywrightInstaller;
  const output = dependencies.output ?? ((message) => process.stdout.write(message));
  const directory = await mkdtemp(join(tmpdir(), "jarvis-playwright-"));
  let server;
  try {
    const archives = new Map();
    for (const entry of entries) {
      const path = join(directory, `${entry.name}.zip`);
      output(`Downloading and verifying Playwright ${entry.name} archive...\n`);
      await download(entry.sourceUrl, path);
      const size = (await stat(path)).size;
      const digest = await hashFile(path);
      if (size !== entry.bytes || digest !== entry.sha256) {
        throw new Error(
          `Playwright ${entry.name} archive failed its reviewed SHA-256 or size check.`
        );
      }
      archives.set(`/${entry.path}`, { path, size });
    }

    const served = new Set();
    server = createServer((request, response) => {
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      const archive = request.method === "GET" ? archives.get(path) : undefined;
      if (!archive) {
        response.writeHead(404).end();
        return;
      }
      served.add(path);
      response.writeHead(200, {
        "content-type": "application/zip",
        "content-length": archive.size
      });
      createReadStream(archive.path)
        .on("error", (error) => response.destroy(error))
        .pipe(response);
    });
    await listen(server);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Archive server has no port.");
    await install(`http://127.0.0.1:${address.port}`);
    if (served.size !== entries.length) {
      throw new Error("Playwright did not install every reviewed archive from the local verifier.");
    }
    output("Verified Playwright archives installed.\n");
  } finally {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

async function downloadArchive(url, path) {
  const response = await fetch(url, { signal: AbortSignal.timeout(600_000) });
  if (!response.ok || !response.body) {
    throw new Error(`Playwright archive download failed with HTTP ${response.status}.`);
  }
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(path, { flags: "wx", mode: 0o600 })
  );
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function runPlaywrightInstaller(downloadHost) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        join(deployDirectory, "node_modules", "playwright", "cli.js"),
        "install",
        "--force",
        "chromium"
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          PLAYWRIGHT_DOWNLOAD_HOST: downloadHost,
          PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST: downloadHost
        }
      }
    );
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Playwright installer exited with status ${code ?? "unknown"}.`));
    });
  });
}

async function main() {
  if (process.platform !== "linux")
    throw new Error("Verified Browser installation requires Linux.");
  const manifest = JSON.parse(
    await readFile(join(deployDirectory, "playwright-archives.json"), "utf8")
  );
  const packageManifest = JSON.parse(await readFile(join(deployDirectory, "package.json"), "utf8"));
  const browsers = JSON.parse(
    await readFile(
      join(deployDirectory, "node_modules", "playwright-core", "browsers.json"),
      "utf8"
    )
  );
  const entries = selectPlatformArchives(manifest, packageManifest, browsers, process.arch);
  await installVerifiedArchives(entries);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Verified Playwright installation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
