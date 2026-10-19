import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FileTranscriptionCache } from "../index.js";

describe("FileTranscriptionCache", () => {
  it("returns only fresh, well-formed entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "transcription-cache-"));
    const now = new Date("2026-07-19T12:00:00.000Z");
    const cache = new FileTranscriptionCache(root, 1_000, Number.POSITIVE_INFINITY, () => now);
    const value = { text: "hello", warnings: [], cacheKey: "transcription:key" };

    await cache.put("transcription:key", value);
    await expect(cache.get("transcription:key")).resolves.toEqual(value);

    const expired = new FileTranscriptionCache(
      root,
      1,
      Number.POSITIVE_INFINITY,
      () => new Date("2026-07-19T12:00:01.000Z")
    );
    await expect(expired.get("transcription:key")).resolves.toBeUndefined();
    await writeFile(join(root, "corrupt.json"), "not json");
    await expect(cache.get("different-key")).resolves.toBeUndefined();

    const entry = (await readdir(root)).find((name) => name !== "corrupt.json");
    await writeFile(
      join(root, entry!),
      JSON.stringify({
        schemaVersion: 1,
        cacheKey: "transcription:key",
        createdAt: now.toISOString(),
        result: { text: "hello", warnings: [42], cacheKey: "transcription:key" }
      })
    );
    await expect(cache.get("transcription:key")).resolves.toBeUndefined();
  });

  it("bounds the dedicated cache volume by evicting the oldest records", async () => {
    const root = await mkdtemp(join(tmpdir(), "transcription-cache-bound-"));
    let now = new Date("2026-07-19T12:00:00.000Z");
    const cache = new FileTranscriptionCache(root, 60_000, 220, () => now);

    await cache.put("one", { text: "one", warnings: [], cacheKey: "one" });
    now = new Date("2026-07-19T12:00:01.000Z");
    await cache.put("two", { text: "two", warnings: [], cacheKey: "two" });

    expect((await readdir(root)).filter((entry) => entry.endsWith(".json"))).toHaveLength(1);
    await expect(cache.get("one")).resolves.toBeUndefined();
    await expect(cache.get("two")).resolves.toMatchObject({ text: "two" });
  });
});
