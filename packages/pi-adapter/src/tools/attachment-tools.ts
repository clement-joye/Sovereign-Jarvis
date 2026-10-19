import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AttachmentReferenceV1 } from "@second-brain/contracts";

/**
 * Exposes only the attachments carried by the current message. It never lists
 * exchange storage and copies originals only after the model has established
 * that the user explicitly asked to retain or attach one.
 */
export function createAttachmentTools(input: {
  workspaceRoot: string;
  attachmentRoot: string;
  attachments: AttachmentReferenceV1[];
}): ToolDefinition[] {
  const allowed = new Map(input.attachments.map((attachment) => [attachment.id, attachment]));
  return [
    defineTool({
      name: "attachment_save",
      label: "attachment_save",
      description:
        "Persist one attachment from the current user message into workspace attachments/. Use only after the user explicitly asks to save, remember, or attach the original. Returns a relative Markdown link; then add that link to the chosen note.",
      promptSnippet: "Persist an explicitly requested attachment into the Jarvis workspace",
      parameters: Type.Object({
        attachmentId: Type.String(),
        filename: Type.Optional(Type.String())
      }),
      async execute(_id, { attachmentId, filename }) {
        const attachment = allowed.get(attachmentId);
        if (!attachment) throw new Error("That attachment is not available in this request.");
        const outputName = safeFilename(filename ?? attachment.originalFilename ?? attachment.id);
        const relativePath = `attachments/${attachment.sha256.slice(0, 12)}-${outputName}`;
        const source = safeAttachmentPath(input.attachmentRoot, attachment.storageKey);
        const target = safeWorkspacePath(input.workspaceRoot, relativePath);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, await readFile(source), { flag: "wx", mode: 0o600 });
        return textResult(
          `Saved [${outputName}](${relativePath}) . Add this relative link to the canonical note.`
        );
      }
    })
  ];
}

function safeFilename(value: string): string {
  const name = basename(value)
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!name || name === "." || name === ".." || name.length > 180)
    throw new Error("Invalid attachment filename.");
  return name;
}

function safeAttachmentPath(root: string, storageKey: string): string {
  if (storageKey.startsWith("/") || storageKey.split("/").includes(".."))
    throw new Error("Invalid attachment storage key.");
  return within(root, join(root, storageKey));
}

function safeWorkspacePath(root: string, path: string): string {
  return within(root, join(root, path));
}

function within(root: string, path: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  if (!resolvedPath.startsWith(`${resolvedRoot}${sep}`))
    throw new Error("Attachment path escapes its root.");
  return resolvedPath;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}
