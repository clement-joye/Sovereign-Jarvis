import { chmod, mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileAttachmentStore } from "./file-attachment-store.js";

describe("FileAttachmentStore", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("stores, reads, stats, and deletes an attachment under its opaque key", async () => {
    const store = new FileAttachmentStore(await root());
    const reference = attachment("inbound/run-1/photo.png");

    await expect(store.put({ reference, bytes: Buffer.from("image-bytes") })).resolves.toEqual(
      reference
    );
    await expect(store.open(reference.storageKey)).resolves.toEqual(Buffer.from("image-bytes"));
    await expect(store.stat(reference.storageKey)).resolves.toMatchObject({ sizeBytes: 11 });
    await store.delete(reference.storageKey);
    await expect(store.stat(reference.storageKey)).resolves.toBeUndefined();
  });

  it("rejects absolute and traversal storage keys", async () => {
    const store = new FileAttachmentStore(await root());

    await expect(store.open("../outside")).rejects.toThrow("opaque relative keys");
    await expect(store.open("/outside")).rejects.toThrow("opaque relative keys");
  });

  it("does not follow a symlinked attachment path outside its root", async () => {
    const exchangeRoot = await root();
    const outside = join(await root(), "outside.txt");
    await writeFile(outside, "outside");
    await symlink(outside, join(exchangeRoot, "link"));
    const store = new FileAttachmentStore(exchangeRoot);

    await expect(store.open("link")).rejects.toThrow();
  });

  it("does not write through a symlinked parent directory outside its root", async () => {
    const exchangeRoot = await root();
    const outsideRoot = await root();
    await symlink(outsideRoot, join(exchangeRoot, "linked-directory"));
    const store = new FileAttachmentStore(exchangeRoot);

    await expect(
      store.put({
        reference: attachment("linked-directory/photo.png"),
        bytes: Buffer.from("image")
      })
    ).rejects.toThrow("parent path escapes");
  });

  it("does not change permissions on an existing attachment directory", async () => {
    const exchangeRoot = await root();
    const parent = join(exchangeRoot, "inbound", "matrix");
    await mkdir(parent, { recursive: true });
    await chmod(parent, 0o750);
    const store = new FileAttachmentStore(exchangeRoot);

    await store.put({
      reference: attachment("inbound/matrix/photo.png"),
      bytes: Buffer.from("image-bytes")
    });

    expect((await stat(parent)).mode & 0o777).toBe(0o750);
  });

  it.skipIf(process.platform !== "linux")(
    "preserves exchange group inheritance for a newly created attachment directory",
    async () => {
      const exchangeRoot = await root();
      const inbound = join(exchangeRoot, "inbound");
      await mkdir(inbound, { mode: 0o770 });
      await chmod(inbound, 0o2770);
      const parent = join(inbound, "matrix");
      const store = new FileAttachmentStore(exchangeRoot);

      await store.put({
        reference: attachment("inbound/matrix/photo.png"),
        bytes: Buffer.from("image-bytes")
      });

      expect((await stat(parent)).mode & 0o2777).toBe(0o2770);
      expect((await stat(join(parent, "photo.png"))).gid).toBe((await stat(inbound)).gid);
    }
  );

  async function root(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "jarvis-attachments-"));
    roots.push(directory);
    return directory;
  }
});

function attachment(storageKey: string) {
  return {
    schemaVersion: 1 as const,
    id: "attachment-1",
    purpose: "inbound" as const,
    mediaType: "image/png",
    sizeBytes: 11,
    sha256: "0".repeat(64),
    storageKey
  };
}
