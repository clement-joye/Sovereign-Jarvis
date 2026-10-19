import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createAttachmentTools } from "./attachment-tools.js";

describe("attachment_save", () => {
  it("copies only an attachment from the current request into workspace storage", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-attachment-tool-"));
    const exchange = join(root, "exchange");
    const workspace = join(root, "workspace");
    await mkdir(join(exchange, "inbound"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(exchange, "inbound", "receipt.pdf"), "receipt");
    const [tool] = createAttachmentTools({
      workspaceRoot: workspace,
      attachmentRoot: exchange,
      attachments: [
        {
          schemaVersion: 1,
          id: "receipt",
          purpose: "inbound",
          mediaType: "application/pdf",
          sizeBytes: 7,
          sha256: "a".repeat(64),
          storageKey: "inbound/receipt.pdf",
          originalFilename: "Receipt 2026.pdf"
        }
      ]
    });
    if (!tool) throw new Error("Expected attachment_save tool.");
    await tool.execute(
      "call-1",
      { attachmentId: "receipt" },
      new AbortController().signal,
      () => {},
      {} as never
    );
    await expect(
      readFile(join(workspace, "attachments", `aaaaaaaaaaaa-Receipt-2026.pdf`), "utf8")
    ).resolves.toBe("receipt");
  });

  it("rejects attachment IDs that were not sent in the current request", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-attachment-tool-"));
    const [tool] = createAttachmentTools({
      workspaceRoot: root,
      attachmentRoot: root,
      attachments: []
    });
    if (!tool) throw new Error("Expected attachment_save tool.");

    await expect(
      tool.execute(
        "call-1",
        { attachmentId: "unrelated" },
        new AbortController().signal,
        () => {},
        {} as never
      )
    ).rejects.toThrow("not available in this request");
  });
});
