import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import type { AttachmentReferenceV1 } from "@second-brain/contracts";

import {
  DeterministicMediaProcessor,
  assertOpaqueStorageKey,
  imageCacheKey,
  normalizeTtsText,
  resolveAttachmentPath,
  transcriptionCacheKey,
  ttsCacheKey,
  validateAudioAttachment,
  validateImageAttachment
} from "./index.js";

describe("media adapter", () => {
  it("rejects unsafe storage keys", () => {
    expect(() => assertOpaqueStorageKey("inbound/a.jpg")).not.toThrow();
    expect(() => assertOpaqueStorageKey("../secret")).toThrow(/opaque/);
    expect(() => assertOpaqueStorageKey("/secret")).toThrow(/opaque/);
    expect(() => assertOpaqueStorageKey("nested//file")).toThrow(/opaque/);
  });

  it("resolves files under the exchange root and rejects escaping symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "media-root-"));
    await mkdir(join(root, "inbound"));
    await writeFile(join(root, "inbound", "ok.txt"), "ok");
    await symlink("/etc/passwd", join(root, "inbound", "escape"));

    await expect(
      resolveAttachmentPath({ exchangeRoot: root, storageKey: "inbound/ok.txt" })
    ).resolves.toBe(join(root, "inbound", "ok.txt"));
    await expect(
      resolveAttachmentPath({ exchangeRoot: root, storageKey: join("inbound", "escape") })
    ).rejects.toThrow(/escapes/);
  });

  it("enforces image and audio media limits", () => {
    expect(() => validateImageAttachment(image())).not.toThrow();
    expect(() => validateImageAttachment({ ...image(), width: 100_000, height: 100_000 })).toThrow(
      /pixel/
    );
    expect(() => validateImageAttachment({ ...image(), mediaType: "text/plain" })).toThrow(
      /Unsupported/
    );

    expect(() => validateAudioAttachment(audio())).not.toThrow();
    expect(() => validateAudioAttachment({ ...audio(), durationMs: 999_999_999 })).toThrow(
      /duration/
    );
  });

  it("derives stable versioned cache keys", () => {
    expect(
      imageCacheKey({
        sourceSha256: image().sha256,
        processorVersion: "v1",
        targetProfile: "pi-input"
      })
    ).toBe(
      imageCacheKey({
        sourceSha256: image().sha256,
        processorVersion: "v1",
        targetProfile: "pi-input"
      })
    );
    expect(
      transcriptionCacheKey({ sourceSha256: audio().sha256, modelVersion: "stt-v1" })
    ).not.toBe(transcriptionCacheKey({ sourceSha256: audio().sha256, modelVersion: "stt-v2" }));
    expect(
      ttsCacheKey({ text: "Hello   world", voiceId: "a", ttsVersion: "v1", format: "ogg" })
    ).toBe(ttsCacheKey({ text: "Hello world", voiceId: "a", ttsVersion: "v1", format: "ogg" }));
  });

  it("prepares image, transcribes audio, and synthesizes speech deterministically", async () => {
    const processor = new DeterministicMediaProcessor();

    await expect(processor.prepareImage(image())).resolves.toMatchObject({
      id: "image-1-prepared",
      purpose: "prepared"
    });
    await expect(processor.transcribeAudio(audio())).resolves.toMatchObject({
      text: "transcript:audio-1",
      language: "en",
      confidence: 1
    });
    await expect(processor.synthesizeAudio({ text: " Hello   world " })).resolves.toMatchObject({
      audio: {
        purpose: "outbound",
        mediaType: "audio/ogg"
      }
    });
    expect(normalizeTtsText(" Hello   world ")).toBe("Hello world");
    expect(
      normalizeTtsText(
        "## **Status**\n\n- Read [the guide](https://example.test)\n\n```ts\ncode()\n```"
      )
    ).toBe("Status Read the guide");
  });
});

function image(): AttachmentReferenceV1 {
  return {
    schemaVersion: 1,
    id: "image-1",
    purpose: "inbound",
    mediaType: "image/png",
    sizeBytes: 1024,
    sha256: "a".repeat(64),
    storageKey: "inbound/image-1.png",
    width: 100,
    height: 100
  };
}

function audio(): AttachmentReferenceV1 {
  return {
    schemaVersion: 1,
    id: "audio-1",
    purpose: "inbound",
    mediaType: "audio/ogg",
    sizeBytes: 1024,
    sha256: "b".repeat(64),
    storageKey: "inbound/audio-1.ogg",
    durationMs: 1000
  };
}
