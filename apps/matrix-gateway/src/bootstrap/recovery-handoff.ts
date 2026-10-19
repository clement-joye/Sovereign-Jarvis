import { randomUUID } from "node:crypto";
import { chmod, link, lstat, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

const pendingName = "bootstrap-recovery.pending";
const keyName = "bootstrap-recovery.key";

export type RecoveryHandoffStatus = "unstarted" | "ambiguous" | "key-persisted";

async function privateDirectory(root: string): Promise<void> {
  const entry = await lstat(root);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error("The Matrix crypto store must be a regular directory.");
  }
  if (typeof process.getuid === "function" && entry.uid !== process.getuid()) {
    throw new Error("The Matrix crypto store must be owned by the current user.");
  }
  if ((entry.mode & 0o077) !== 0) await chmod(root, 0o700);
}

async function privateFileExists(path: string): Promise<boolean> {
  const entry = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!entry) return false;
  if (
    !entry.isFile() ||
    entry.isSymbolicLink() ||
    (entry.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && entry.uid !== process.getuid())
  ) {
    throw new Error("The Matrix recovery handoff must be an owned, private regular file.");
  }
  return true;
}

async function syncDirectory(root: string): Promise<void> {
  const directory = await open(root, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function inspectRecoveryHandoff(
  root: string,
  expectedUserId?: string
): Promise<RecoveryHandoffStatus> {
  await privateDirectory(root);
  const pending = await privateFileExists(join(root, pendingName));
  const key = await privateFileExists(join(root, keyName));
  if (key && !pending) {
    throw new Error(
      "The Matrix recovery key exists without an identity attempt marker. Stop and reconcile the protected crypto store."
    );
  }
  if (pending) {
    const marker = await readFile(join(root, pendingName), "utf8");
    let userId: unknown;
    try {
      userId = (JSON.parse(marker) as { userId?: unknown }).userId;
    } catch {
      throw new Error(
        "Matrix identity attempt marker has no valid account binding. Stop and reconcile the crypto store."
      );
    }
    if (typeof userId !== "string" || !/^@[^:\s]+:[^\s]+$/u.test(userId)) {
      throw new Error(
        "Matrix identity attempt marker has no valid account binding. Stop and reconcile the crypto store."
      );
    }
    if (expectedUserId !== undefined && userId !== expectedUserId) {
      throw new Error(
        "Matrix recovery handoff belongs to another account. Stop and reconcile the crypto store."
      );
    }
  }
  if (key) return "key-persisted";
  return pending ? "ambiguous" : "unstarted";
}

export async function markIdentityCreationStarted(root: string, userId: string): Promise<void> {
  if (!/^@[^:\s]+:[^\s]+$/u.test(userId)) {
    throw new Error("An authenticated Matrix user ID is required before identity creation.");
  }
  if ((await inspectRecoveryHandoff(root)) !== "unstarted") {
    throw new Error(
      "Matrix identity may exist; inspect protected recovery state. Do not retry identity creation."
    );
  }
  const marker = await open(join(root, pendingName), "wx", 0o600);
  try {
    await marker.writeFile(`${JSON.stringify({ version: 1, userId })}\n`);
    await marker.sync();
  } finally {
    await marker.close();
  }
  await syncDirectory(root);
}

export async function persistRecoveryKey(root: string, key: string, userId: string): Promise<void> {
  if (typeof key !== "string" || key.trim() === "" || /[\r\n]/u.test(key)) {
    throw new Error("The Matrix SDK returned an invalid recovery key.");
  }
  if ((await inspectRecoveryHandoff(root, userId)) !== "ambiguous") {
    throw new Error("The Matrix recovery handoff is not ready for a key.");
  }
  const temporary = join(root, `.bootstrap-recovery-${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(`${key}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
  // A hard link creates the final name exclusively, so even an unexpected
  // concurrent writer cannot replace a recovery key that is already present.
  await link(temporary, join(root, keyName));
  await syncDirectory(root);
  await unlink(temporary);
  await syncDirectory(root);
  if ((await readRecoveryKey(root, userId)) !== key) {
    throw new Error("Matrix recovery key persistence could not be verified.");
  }
}

export async function readRecoveryKey(root: string, expectedUserId: string): Promise<string> {
  if ((await inspectRecoveryHandoff(root, expectedUserId)) !== "key-persisted") {
    throw new Error(
      "Matrix identity may exist; inspect protected recovery state. No recovery key is available for import."
    );
  }
  const key = await readFile(join(root, keyName), "utf8");
  if (!key.endsWith("\n") || key.slice(0, -1).trim() === "" || /[\r\n]/u.test(key.slice(0, -1))) {
    throw new Error(
      "The protected Matrix recovery key is invalid. Stop and reconcile the crypto store."
    );
  }
  return key.slice(0, -1);
}
