import { mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  inspectRecoveryHandoff,
  markIdentityCreationStarted,
  persistRecoveryKey,
  readRecoveryKey
} from "./recovery-handoff.js";

describe("brain recovery handoff", () => {
  const brainUserId = "@brain:example.test";

  it("persists the attempt before the key and refuses a second attempt", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-e2ee-handoff-"));
    expect(await inspectRecoveryHandoff(root)).toBe("unstarted");

    await markIdentityCreationStarted(root, brainUserId);
    expect(await inspectRecoveryHandoff(root, brainUserId)).toBe("ambiguous");
    await expect(markIdentityCreationStarted(root, brainUserId)).rejects.toThrow(
      /identity may exist/u
    );

    await persistRecoveryKey(root, "private recovery key", brainUserId);
    expect(await inspectRecoveryHandoff(root, brainUserId)).toBe("key-persisted");
    expect(await readRecoveryKey(root, brainUserId)).toBe("private recovery key");
    await expect(readRecoveryKey(root, "@other:example.test")).rejects.toThrow(/another account/u);
    expect((await stat(join(root, "bootstrap-recovery.key"))).mode & 0o077).toBe(0);
    expect(await readFile(join(root, "bootstrap-recovery.pending"), "utf8")).not.toContain(
      "private recovery key"
    );
    await expect(markIdentityCreationStarted(root, brainUserId)).rejects.toThrow(
      /identity may exist/u
    );
  });

  it("refuses a key without an attempt marker or a symlinked handoff", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-e2ee-unpaired-"));
    await writeFile(join(root, "bootstrap-recovery.key"), "unexpected\n", { mode: 0o600 });
    await expect(inspectRecoveryHandoff(root)).rejects.toThrow(/without an identity attempt/u);

    const second = await mkdtemp(join(tmpdir(), "jarvis-e2ee-symlink-"));
    await symlink(join(root, "bootstrap-recovery.key"), join(second, "bootstrap-recovery.key"));
    await expect(inspectRecoveryHandoff(second)).rejects.toThrow(/private regular file/u);
  });

  it("treats a crash while writing account binding as a manual reconciliation state", async () => {
    const root = await mkdtemp(join(tmpdir(), "jarvis-e2ee-partial-marker-"));
    await writeFile(join(root, "bootstrap-recovery.pending"), "", { mode: 0o600 });
    await expect(inspectRecoveryHandoff(root, brainUserId)).rejects.toThrow(/account binding/u);
    await expect(markIdentityCreationStarted(root, brainUserId)).rejects.toThrow(
      /account binding/u
    );
  });
});
