import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseArgs, parseWorkspaceRooms, runWorkspaceBackup } from "./backup-workspace.mjs";

async function fixture(t) {
  const stateRoot = await mkdtemp(join(tmpdir(), "jarvis-workspace-backup-"));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  await writeFile(
    join(stateRoot, "setup-state.json"),
    JSON.stringify({ version: 1, completedStages: ["environment"] })
  );
  await writeFile(
    join(stateRoot, "production.env"),
    [
      "MATRIX_OWNER_ID='@owner:example.test'",
      "MATRIX_BRAIN_USER_ID='@brain:example.test'",
      "MATRIX_ACCESS_TOKEN='test-token'",
      "MATRIX_RECOVERY_KEY='recovery-key'",
      "CONTINUWUITY_ALLOW_REGISTRATION=false",
      ""
    ].join("\n"),
    { mode: 0o600 }
  );
  return stateRoot;
}

function fakeDocker(calls, archive = Buffer.from("test tar content")) {
  return async (_command, args, options) => {
    calls.push({ args, options });
    if (args.includes("psql")) {
      return Buffer.from(
        [
          JSON.stringify({
            workspaceId: "workspace-first",
            roomId: "!first:example.test",
            status: "active"
          }),
          JSON.stringify({
            workspaceId: "workspace-second",
            roomId: "!second:example.test",
            status: "archived"
          }),
          ""
        ].join("\n")
      );
    }
    if (args[0] === "volume") return Buffer.from(`${args.at(-1)}\n`);
    if (args[0] === "run") {
      await writeFile(options.outputFile, archive, { flag: "wx", mode: 0o600 });
      return Buffer.alloc(0);
    }
    throw new Error("Unexpected Docker call");
  };
}

test("parses the separate guided command options", () => {
  assert.deepEqual(parseArgs(["--", "--state-root", "/tmp/jarvis"]), {
    stateRoot: "/tmp/jarvis"
  });
  assert.deepEqual(parseArgs(["--help"]), { help: true });
  assert.throws(() => parseArgs(["--other"]), /Unknown option/);
  assert.throws(() => parseArgs(["--state-root"]), /requires a path/);
});

test("rejects malformed workspace mappings before selecting a volume", () => {
  assert.throws(
    () =>
      parseWorkspaceRooms(
        Buffer.from('{"workspaceId":"../bad","roomId":"!room:x","status":"active"}')
      ),
    /invalid workspace-room binding/
  );
  assert.deepEqual(
    parseWorkspaceRooms(
      Buffer.from(
        '{"workspaceId":"workspace-pending","roomId":"!room:x","status":"pending_invite"}\n'
      )
    ),
    [{ workspaceId: "workspace-pending", roomId: "!room:x", status: "pending_invite" }]
  );
});

test("backs up only the selected room's workspace volume and writes a private manifest", async (t) => {
  const stateRoot = await fixture(t);
  const calls = [];
  const prompts = ["0", "2", "maybe", "y"];
  const messages = [];
  const archive = Buffer.from("selected workspace content");
  await runWorkspaceBackup(
    { stateRoot },
    {
      run: fakeDocker(calls, archive),
      prompt: async () => prompts.shift(),
      lookupRoomName: async (roomId) =>
        roomId.startsWith("!second") ? "Project Room" : "Other Room",
      output: (message) => messages.push(message),
      now: () => new Date("2026-10-13T10:00:00.000Z")
    }
  );
  const backupRoot = join(stateRoot, "backups", "workspaces");
  const [name] = await readdir(backupRoot);
  assert.match(name, /workspace-second/u);
  const destination = join(backupRoot, name);
  const manifest = JSON.parse(await readFile(join(destination, "manifest.json"), "utf8"));
  assert.equal(manifest.scope, "workspace-files");
  assert.equal(manifest.workspaceId, "workspace-second");
  assert.equal(manifest.roomId, "!second:example.test");
  assert.equal(manifest.roomName, "Project Room");
  assert.equal(manifest.archiveSha256, createHash("sha256").update(archive).digest("hex"));
  assert.deepEqual(await readFile(join(destination, "workspace.tar")), archive);
  assert.equal((await stat(destination)).mode & 0o777, 0o700);
  assert.equal((await stat(join(destination, "manifest.json"))).mode & 0o777, 0o600);
  assert.equal((await stat(join(destination, "workspace.tar"))).mode & 0o777, 0o600);
  const archiveCall = calls.find(({ args }) => args[0] === "run");
  assert.ok(archiveCall.args.includes("none"));
  assert.ok(archiveCall.args.includes("--read-only"));
  assert.ok(
    archiveCall.args.includes(
      "type=volume,src=jarvis-workspace-data-workspace-second,dst=/workspace,readonly"
    )
  );
  assert.ok(messages.join("").includes("Enter a number from 1 to 2"));
  assert.ok(messages.join("").includes("Enter y to back up"));
});

test("cancelling at room selection or confirmation does not create an archive", async (t) => {
  const stateRoot = await fixture(t);
  for (const answers of [["q"], ["1", "n"]]) {
    const calls = [];
    await runWorkspaceBackup(
      { stateRoot },
      {
        run: fakeDocker(calls),
        prompt: async () => answers.shift(),
        lookupRoomName: async () => undefined,
        output: () => undefined
      }
    );
    assert.ok(!calls.some(({ args }) => args[0] === "run"));
  }
  await assert.rejects(readdir(join(stateRoot, "backups", "workspaces")), /ENOENT/u);
});

test("an archive failure removes the partial backup directory", async (t) => {
  const stateRoot = await fixture(t);
  const run = fakeDocker([]);
  await assert.rejects(
    runWorkspaceBackup(
      { stateRoot },
      {
        run: async (command, args, options) => {
          if (args[0] === "run") {
            await writeFile(options.outputFile, "partial archive", { flag: "wx" });
            throw new Error("Docker archive failed");
          }
          return run(command, args, options);
        },
        prompt: async (question) => (question.startsWith("Room") ? "1" : "yes"),
        lookupRoomName: async () => undefined,
        output: () => undefined,
        now: () => new Date("2026-10-13T10:00:00.000Z")
      }
    ),
    /Docker archive failed/u
  );
  assert.deepEqual(await readdir(join(stateRoot, "backups", "workspaces")), []);
});

test("requires an absolute state directory before reading setup", async () => {
  await assert.rejects(runWorkspaceBackup({ stateRoot: "relative/path" }), /absolute path/u);
});
