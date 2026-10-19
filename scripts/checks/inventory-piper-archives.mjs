#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const PINNED_PIPER_ARCHIVES = Object.freeze({
  x86_64: "a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992",
  aarch64: "fea0fd2d87c54dbc7078d0f878289f404bd4d6eea6e7444a77835d1537ab88eb"
});
export const PINNED_TASHKEEL_MODEL_SHA256 =
  "9f27090af3e0f661913af048a739632a3f577b3233512551d8c90580ccad4aa8";
export const EXPECTED_PIPER_MEMBERS = Object.freeze([
  "piper/espeak-ng",
  "piper/espeak-ng-data",
  "piper/libespeak-ng.so.1.52.0.1",
  "piper/libonnxruntime.so.1.14.1",
  "piper/libpiper_phonemize.so.1.2.0",
  "piper/libtashkeel_model.ort",
  "piper/piper",
  "piper/piper_phonemize"
]);

export function verifyPiperArchiveFacts(members) {
  const normalized = validateArchiveMembers(members);
  const missing = EXPECTED_PIPER_MEMBERS.filter((member) => !normalized.includes(member));
  if (missing.length)
    throw new Error(`Piper archive is missing expected members: ${missing.join(", ")}`);
  const licenseFiles = normalized.filter((member) =>
    /(?:^|\/)(?:license|copying|notice|copyright)(?:$|[^a-z])/i.test(member)
  );
  if (licenseFiles.length)
    throw new Error(
      `Piper archive unexpectedly contains license/notice files: ${licenseFiles.join(", ")}`
    );
  return { memberCount: normalized.length, members: normalized };
}

export function validateArchiveMembers(members) {
  const seen = new Set();
  return members
    .map((raw) => {
      const member = raw.replace(/\\/g, "/").replace(/\/$/, "");
      if (!member || member.startsWith("/") || /^[A-Za-z]:/.test(member)) {
        throw new Error(`Unsafe Piper archive member path: ${JSON.stringify(raw)}`);
      }
      const segments = member.split("/");
      if (segments.some((segment) => segment === ".." || segment === "." || segment === "")) {
        throw new Error(`Unsafe Piper archive member path: ${JSON.stringify(raw)}`);
      }
      if (seen.has(member)) throw new Error(`Duplicate Piper archive member: ${member}`);
      seen.add(member);
      return member;
    })
    .sort();
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function inventory(arch, path) {
  const actual = await sha256(path);
  const expected = PINNED_PIPER_ARCHIVES[arch];
  if (actual !== expected) {
    throw new Error(`${arch} Piper archive SHA-256 mismatch: expected ${expected}, got ${actual}`);
  }
  const { stdout } = await execFileAsync("tar", ["-tzf", path], { maxBuffer: 16 * 1024 * 1024 });
  const { memberCount, members } = verifyPiperArchiveFacts(stdout.split(/\r?\n/).filter(Boolean));
  const { stdout: model } = await execFileAsync(
    "tar",
    ["-xOzf", path, "piper/libtashkeel_model.ort"],
    { encoding: "buffer", maxBuffer: 128 * 1024 * 1024 }
  );
  const modelSha256 = createHash("sha256").update(model).digest("hex");
  if (modelSha256 !== PINNED_TASHKEEL_MODEL_SHA256) {
    throw new Error(
      `${arch} libtashkeel_model.ort SHA-256 mismatch: expected ${PINNED_TASHKEEL_MODEL_SHA256}, got ${modelSha256}`
    );
  }
  process.stdout.write(
    `# ${arch} sha256=${actual} members=${memberCount} embedded-license-files=0 libtashkeel_model.ort-sha256=${modelSha256}\n`
  );
  for (const member of members) process.stdout.write(`${arch}\t${member}\n`);
  return members;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [x86, arm] = process.argv.slice(2);
  if (!x86 || !arm || process.argv.length !== 4) {
    process.stderr.write(
      "Usage: node scripts/checks/inventory-piper-archives.mjs <piper_linux_x86_64.tar.gz> <piper_linux_aarch64.tar.gz>\n"
    );
    process.exitCode = 2;
  } else {
    try {
      const x86Members = await inventory("x86_64", x86);
      const armMembers = await inventory("aarch64", arm);
      if (JSON.stringify(x86Members) !== JSON.stringify(armMembers)) {
        throw new Error("Pinned Piper architecture archives have different member paths");
      }
      process.stdout.write(`# architecture-member-paths-identical=true\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
