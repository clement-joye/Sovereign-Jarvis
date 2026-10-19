import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { AttachmentReferenceV1 } from "@second-brain/contracts";

const MAX_DOCUMENT_CHARACTERS = 50_000;

/** Extract bounded text from formats intentionally supported by the runtime image. */
export async function extractDocumentText(
  root: string,
  attachment: AttachmentReferenceV1
): Promise<string | undefined> {
  const source = safeSource(root, attachment.storageKey);
  const label = attachment.originalFilename ?? attachment.id;
  if (attachment.mediaType.startsWith("text/") || attachment.mediaType === "application/json") {
    return format(label, await readFile(source, "utf8"));
  }
  if (attachment.mediaType === "application/pdf") {
    return format(label, await commandOutput("pdftotext", ["-f", "1", "-l", "50", source, "-"]));
  }
  if (
    attachment.mediaType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const xml = await commandOutput("unzip", ["-p", source, "word/document.xml"]);
    return xml ? format(label, xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")) : undefined;
  }
  if (attachment.mediaType.startsWith("image/")) {
    return format(label, await commandOutput("tesseract", [source, "stdout", "-l", "eng"]));
  }
  return undefined;
}

function safeSource(root: string, storageKey: string): string {
  if (storageKey.startsWith("/") || storageKey.split("/").includes("..")) {
    throw new Error("Invalid attachment storage key.");
  }
  return join(root, storageKey);
}

function format(label: string, text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  return trimmed ? `[${label}]\n${trimmed.slice(0, MAX_DOCUMENT_CHARACTERS)}` : undefined;
}

async function commandOutput(command: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) =>
    execFile(command, args, { maxBuffer: MAX_DOCUMENT_CHARACTERS + 5_000 }, (error, stdout) =>
      resolve(error ? undefined : stdout)
    )
  );
}
