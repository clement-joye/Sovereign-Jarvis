import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import type { AttachmentReferenceV1 } from "@second-brain/contracts";

import { assertOpaqueStorageKey } from "../index.js";

export class FileAttachmentStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(input: {
    bytes: Uint8Array;
    reference: AttachmentReferenceV1;
  }): Promise<AttachmentReferenceV1> {
    const path = this.pathFor(input.reference.storageKey);
    const parent = dirname(path);
    // A shared exchange directory can be owned by another unprivileged
    // service.  That service may grant this process group access without
    // granting ownership, so chmod is only valid when this process created
    // the target directory itself.
    const created = await mkdir(parent, { recursive: true, mode: 0o770 });
    if (created !== undefined) {
      // Preserve group inheritance from the shared exchange volume. Without
      // setgid, subsequent files use the writer's private primary group and
      // cannot be read by the Pi runtime's exchange group.
      await chmod(parent, 0o2770);
    }
    await this.assertSafeParentPath(path);
    const temporaryPath = `${path}.tmp-${randomUUID()}`;
    await writeFile(temporaryPath, input.bytes, { flag: "wx", mode: 0o660 });
    await rename(temporaryPath, path);
    return input.reference;
  }

  async open(storageKey: string): Promise<Uint8Array> {
    const path = this.pathFor(storageKey);
    await this.assertSafeExistingPath(path);
    return readFile(path);
  }

  async stat(storageKey: string): Promise<AttachmentReferenceV1 | undefined> {
    try {
      const path = this.pathFor(storageKey);
      await this.assertSafeExistingPath(path);
      const file = await stat(path);
      return file.isFile()
        ? {
            schemaVersion: 1,
            id: `stored-${Buffer.from(storageKey).toString("base64url")}`,
            purpose: "inbound",
            mediaType: "application/octet-stream",
            sizeBytes: file.size,
            sha256: "0".repeat(64),
            storageKey
          }
        : undefined;
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async delete(storageKey: string): Promise<void> {
    await rm(this.pathFor(storageKey), { force: true });
  }

  async listOrphans(): Promise<string[]> {
    return [];
  }

  private pathFor(storageKey: string): string {
    assertOpaqueStorageKey(storageKey);
    const path = resolve(this.root, storageKey);
    if (!path.startsWith(`${this.root}${sep}`)) {
      throw new Error("Attachment storage key escapes the configured root.");
    }
    return path;
  }

  private async assertSafeExistingPath(path: string): Promise<void> {
    const resolvedRoot = await realpath(this.root);
    const resolvedPath = await realpath(path);
    if (!isWithinRoot(resolvedPath, resolvedRoot)) {
      throw new Error("Attachment path escapes the configured root through a symlink.");
    }
    const file = await lstat(path);
    if (!file.isSymbolicLink()) {
      return;
    }
    const target = await realpath(path);
    if (!target.startsWith(`${this.root}${sep}`)) {
      throw new Error("Attachment symlink escapes the configured root.");
    }
  }

  private async assertSafeParentPath(path: string): Promise<void> {
    const resolvedRoot = await realpath(this.root);
    const resolvedParent = await realpath(dirname(path));
    if (!isWithinRoot(resolvedParent, resolvedRoot)) {
      throw new Error("Attachment parent path escapes the configured root through a symlink.");
    }
  }
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isWithinRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}
