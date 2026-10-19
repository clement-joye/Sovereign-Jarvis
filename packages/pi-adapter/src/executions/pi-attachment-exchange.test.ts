import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PiAttachmentExchange } from "./pi-attachment-exchange.js";
import { PiRunBudgetMeter } from "./pi-run-budget.js";

describe("PiAttachmentExchange", () => {
  it("returns no attachments when roots are not configured", async () => {
    const exchange = new PiAttachmentExchange();
    await expect(exchange.inputImages([attachment("image.png", "image/png")])).resolves.toEqual([]);
    await expect(exchange.documentText([attachment("note.txt", "text/plain")])).resolves.toBe("");
    await expect(
      exchange.collectGeneratedFiles("run-1", new PiRunBudgetMeter(10, 100))
    ).resolves.toEqual([]);
  });

  it("rejects traversal keys for image input", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-pi-exchange-"));
    const exchange = new PiAttachmentExchange({ attachmentRoot: root });
    await expect(
      exchange.inputImages([attachment("escape", "image/png", "../outside")])
    ).rejects.toThrow("Invalid attachment storage key");
  });

  it("extracts attached text and skips audio", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-pi-exchange-"));
    await mkdir(join(root, "inbound"));
    await writeFile(join(root, "inbound", "note.txt"), "hello from attachment");
    const exchange = new PiAttachmentExchange({ attachmentRoot: root });
    await expect(
      exchange.documentText([
        attachment("note.txt", "text/plain"),
        attachment("voice.mp3", "audio/mpeg")
      ])
    ).resolves.toContain("[note.txt]\nhello from attachment");
  });

  it("collects, hashes, stores, and meters generated outbox files", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-pi-exchange-"));
    const workspace = join(root, "workspace");
    const exchangeRoot = join(root, "exchange");
    await mkdir(join(workspace, ".outbox", "run-1"), { recursive: true });
    await writeFile(join(workspace, ".outbox", "run-1", "result.json"), "{}\n");
    const exchange = new PiAttachmentExchange({
      attachmentRoot: exchangeRoot,
      workspaceRoot: workspace
    });
    const files = await exchange.collectGeneratedFiles("run-1", new PiRunBudgetMeter(10, 3));
    expect(files[0]).toMatchObject({
      id: "pi-file-run-1-1",
      mediaType: "application/json",
      sizeBytes: 3,
      sha256: createHash("sha256").update("{}\n").digest("hex"),
      storageKey: "outbound/pi/run-1/result.json",
      originalFilename: "result.json"
    });
    await expect(
      readFile(join(exchangeRoot, "outbound/pi/run-1/result.json"), "utf8")
    ).resolves.toBe("{}\n");
  });

  it("enforces the output byte budget for generated files", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-pi-exchange-"));
    const workspace = join(root, "workspace");
    await mkdir(join(workspace, ".outbox", "run-1"), { recursive: true });
    await writeFile(join(workspace, ".outbox", "run-1", "result.txt"), "too long");
    const exchange = new PiAttachmentExchange({
      attachmentRoot: join(root, "exchange"),
      workspaceRoot: workspace
    });
    await expect(
      exchange.collectGeneratedFiles("run-1", new PiRunBudgetMeter(10, 3))
    ).rejects.toThrow("output budget");
  });
});

function attachment(filename: string, mediaType: string, storageKey = `inbound/${filename}`) {
  return {
    schemaVersion: 1 as const,
    id: filename,
    purpose: "inbound" as const,
    mediaType,
    sizeBytes: 1,
    sha256: "a".repeat(64),
    storageKey,
    originalFilename: filename
  };
}
