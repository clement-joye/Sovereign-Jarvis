import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { AttachmentReferenceV1, PiRunRequestV1 } from "@second-brain/contracts";

import { extractDocumentText } from "../tools/document-extraction.js";
import type { PiRunBudgetMeter } from "./pi-run-budget.js";

export interface PiAttachmentExchangeOptions {
  attachmentRoot?: string | undefined;
  workspaceRoot?: string | undefined;
}

/** Bounded inbound/outbound attachment exchange for a Pi run. */
export class PiAttachmentExchange {
  private readonly attachmentRoot: string | undefined;
  private readonly workspaceRoot: string | undefined;

  constructor(options: PiAttachmentExchangeOptions = {}) {
    this.attachmentRoot = options.attachmentRoot;
    this.workspaceRoot = options.workspaceRoot;
  }

  async inputImages(
    attachments: PiRunRequestV1["images"]
  ): Promise<Array<{ type: "image"; data: string; mimeType: string }>> {
    if (!this.attachmentRoot) return [];
    return Promise.all(
      attachments.map(async (attachment) => ({
        type: "image" as const,
        data: Buffer.from(
          await readAttachment(this.attachmentRoot!, attachment.storageKey)
        ).toString("base64"),
        mimeType: attachment.mediaType
      }))
    );
  }

  async documentText(attachments: AttachmentReferenceV1[]): Promise<string> {
    if (!this.attachmentRoot) return "";
    const documents = attachments.filter(
      (attachment) => !attachment.mediaType.startsWith("audio/")
    );
    const parts = await Promise.all(
      documents.map((attachment) => extractDocumentText(this.attachmentRoot!, attachment))
    );
    const available = parts.filter((part): part is string => part !== undefined);
    return available.length > 0 ? `\n\nAttached document text:\n${available.join("\n\n")}` : "";
  }

  async collectGeneratedFiles(
    runId: string,
    meter: PiRunBudgetMeter
  ): Promise<AttachmentReferenceV1[]> {
    if (!this.attachmentRoot || !this.workspaceRoot) return [];
    const outputDirectory = join(this.workspaceRoot, ".outbox", runId);
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(outputDirectory, { withFileTypes: true });
    } catch {
      return [];
    }
    const files: AttachmentReferenceV1[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filename = basename(entry.name);
      const bytes = await readFile(join(outputDirectory, filename));
      meter.consumeOutput(bytes.byteLength);
      const storageKey = `outbound/pi/${runId}/${filename}`;
      const reference: AttachmentReferenceV1 = {
        schemaVersion: 1,
        id: `pi-file-${runId}-${files.length + 1}`,
        purpose: "outbound",
        mediaType: mediaTypeFor(filename),
        sizeBytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        storageKey,
        originalFilename: filename
      };
      await writeAttachment(this.attachmentRoot, storageKey, bytes);
      files.push(reference);
    }
    return files;
  }
}

function mediaTypeFor(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase();
  return (
    (
      {
        pdf: "application/pdf",
        txt: "text/plain",
        md: "text/markdown",
        csv: "text/csv",
        json: "application/json",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        zip: "application/zip"
      } as Record<string, string>
    )[extension ?? ""] ?? "application/octet-stream"
  );
}

async function readAttachment(root: string, storageKey: string): Promise<Uint8Array> {
  if (storageKey.includes("..") || storageKey.startsWith("/"))
    throw new Error("Invalid attachment storage key.");
  return readFile(join(root, storageKey));
}

async function writeAttachment(root: string, storageKey: string, bytes: Uint8Array): Promise<void> {
  if (storageKey.includes("..") || storageKey.startsWith("/"))
    throw new Error("Invalid attachment storage key.");
  const path = join(root, storageKey);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { mode: 0o660 });
}
