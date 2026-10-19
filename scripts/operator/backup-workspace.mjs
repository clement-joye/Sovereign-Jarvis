#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, createReadStream, openSync } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { assertSetupEnvironment } from "../setup/install-readiness.mjs";
import { defaultStateRoot, readSetupEnvironmentValues } from "../setup/setup-core.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const composeFile = join(projectRoot, "deploy/compose/compose.production.yml");
const archiveImage =
  "alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc";
const workspaceIdPattern = /^workspace-[A-Za-z0-9_-]+$/u;

export function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg !== "--state-root") throw new Error(`Unknown option: ${arg}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error("--state-root requires a path.");
    options.stateRoot = value;
    index += 1;
  }
  return options;
}

export async function runWorkspaceBackup(options, dependencies = {}) {
  const output = dependencies.output ?? ((text) => process.stdout.write(text));
  const run = dependencies.run ?? runCommand;
  const now = dependencies.now ?? (() => new Date());
  if (options.help) {
    output("Usage: pnpm jarvis:backup:workspace [--state-root <absolute-path>]\n");
    output("Guides you through a files-only backup of one Matrix room's Jarvis workspace.\n");
    return;
  }
  if (options.stateRoot && !isAbsolute(options.stateRoot)) {
    throw new Error("State root must be an absolute path.");
  }
  const stateRoot = resolve(
    options.stateRoot ??
      process.env.JARVIS_STATE_ROOT ??
      defaultStateRoot({
        platform: process.platform,
        home: homedir(),
        xdgStateHome: process.env.XDG_STATE_HOME
      })
  );
  await assertSetupEnvironment(stateRoot);
  const environment = await readSetupEnvironmentValues(stateRoot);
  const compose = [
    "compose",
    "--project-name",
    dependencies.projectName ?? "jarvis",
    "--env-file",
    join(stateRoot, "production.env"),
    "-f",
    dependencies.composeFile ?? composeFile
  ];
  const rooms = parseWorkspaceRooms(
    await run("docker", [
      ...compose,
      "exec",
      "-T",
      "brain-db",
      "psql",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "brain",
      "-d",
      "brain",
      "-c",
      "SELECT json_build_object('workspaceId', w.id, 'roomId', b.room_id, 'status', w.status) FROM brain_core.workspaces w JOIN brain_core.workspace_room_bindings b ON b.workspace_id = w.id ORDER BY CASE WHEN w.status = 'active' THEN 0 ELSE 1 END, w.created_at, b.room_id"
    ])
  );
  if (rooms.length === 0) {
    output("No Matrix rooms with Jarvis workspaces were found.\n");
    return;
  }
  const lookupRoomName = dependencies.lookupRoomName ?? defaultRoomNameLookup;
  const namedRooms = await Promise.all(
    rooms.map(async (room) => ({
      ...room,
      name: await lookupRoomName(room.roomId, environment)
    }))
  );
  const terminal = dependencies.prompt
    ? undefined
    : createInterface({ input: process.stdin, output: process.stderr });
  const prompt = dependencies.prompt ?? ((question) => terminal.question(question));
  try {
    if (!dependencies.prompt && !process.stdin.isTTY) {
      throw new Error("Guided workspace backup requires an interactive terminal.");
    }
    output("Choose a Matrix room to back up:\n");
    for (const [index, room] of namedRooms.entries()) {
      output(`  ${index + 1}. ${displayName(room.name ?? room.roomId)} (${room.status})\n`);
      output(`     ${room.roomId} · ${room.workspaceId}\n`);
    }
    const selected = await chooseRoom(namedRooms, prompt, output);
    if (!selected) {
      output("Backup cancelled.\n");
      return;
    }
    const volumeName = `jarvis-workspace-data-${selected.workspaceId}`;
    const inspectedName = (
      await run("docker", ["volume", "inspect", "--format", "{{.Name}}", volumeName])
    )
      .toString("utf8")
      .trim();
    if (inspectedName !== volumeName)
      throw new Error("Selected workspace data volume was not found.");

    const backupRoot = join(stateRoot, "backups", "workspaces");
    const stamp = now().toISOString().replaceAll(":", "-");
    const destination = join(backupRoot, `${stamp}-${selected.workspaceId}`);
    output(`\nRoom: ${displayName(selected.name ?? selected.roomId)}\n`);
    output(`Workspace: ${selected.workspaceId}\n`);
    output(`Backup directory: ${destination}\n`);
    output("Includes: files in this workspace's /workspace volume.\n");
    output(
      "Excludes: Matrix room history/media, Jarvis database records, schedules, and Pi sessions.\n"
    );
    output("Avoid agent activity in this room until the copy completes.\n");
    if (!(await confirmBackup(prompt, output))) {
      output("Backup cancelled.\n");
      return;
    }

    await mkdir(backupRoot, { recursive: true, mode: 0o700 });
    await mkdir(destination, { mode: 0o700 });
    try {
      const archivePath = join(destination, "workspace.tar");
      await run(
        "docker",
        [
          "run",
          "--rm",
          "--network",
          "none",
          "--read-only",
          "--mount",
          `type=volume,src=${volumeName},dst=/workspace,readonly`,
          archiveImage,
          "tar",
          "-C",
          "/workspace",
          "-cf",
          "-",
          "."
        ],
        { outputFile: archivePath }
      );
      const archive = await stat(archivePath);
      if (!archive.size) throw new Error("Docker returned an empty workspace archive.");
      const manifest = {
        version: 1,
        scope: "workspace-files",
        createdAt: now().toISOString(),
        workspaceId: selected.workspaceId,
        roomId: selected.roomId,
        ...(selected.name ? { roomName: selected.name } : {}),
        volumeName,
        archive: "workspace.tar",
        archiveBytes: archive.size,
        archiveSha256: await hashFile(archivePath)
      };
      await writeFile(
        join(destination, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        {
          mode: 0o600,
          flag: "wx"
        }
      );
      output(`\nWorkspace files backed up at ${destination}\n`);
    } catch (error) {
      await rm(destination, { recursive: true, force: true });
      throw error;
    }
  } finally {
    terminal?.close();
  }
}

export function parseWorkspaceRooms(raw) {
  const lines = raw.toString("utf8").split(/\r?\n/u).filter(Boolean);
  return lines.map((line) => {
    const value = JSON.parse(line);
    if (
      !value ||
      typeof value.workspaceId !== "string" ||
      !workspaceIdPattern.test(value.workspaceId) ||
      typeof value.roomId !== "string" ||
      !value.roomId.startsWith("!") ||
      ![
        "pending_invite",
        "configuring",
        "provisioning",
        "active",
        "archived",
        "closed",
        "failed"
      ].includes(value.status)
    ) {
      throw new Error("Database returned an invalid workspace-room binding.");
    }
    return value;
  });
}

async function chooseRoom(rooms, prompt, output) {
  while (true) {
    const answer = (await prompt("Room number (or q to cancel): ")).trim();
    if (answer.toLowerCase() === "q") return undefined;
    if (/^[1-9]\d*$/u.test(answer) && Number(answer) <= rooms.length) {
      return rooms[Number(answer) - 1];
    }
    output(`Enter a number from 1 to ${rooms.length}, or q.\n`);
  }
}

async function confirmBackup(prompt, output) {
  while (true) {
    const answer = (await prompt("Create this files-only backup? [y/N] ")).trim().toLowerCase();
    if (answer === "y" || answer === "yes") return true;
    if (answer === "" || answer === "n" || answer === "no" || answer === "q") return false;
    output("Enter y to back up, or n to cancel.\n");
  }
}

function displayName(value) {
  return value
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .trim()
    .slice(0, 120);
}

async function defaultRoomNameLookup(roomId, environment) {
  const token = environment.get("MATRIX_ACCESS_TOKEN");
  const port = Number(environment.get("MATRIX_HOST_PORT") || "8008");
  if (!token || !Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  try {
    const url = new URL(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.name`,
      `http://127.0.0.1:${port}`
    );
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3_000)
    });
    if (!response.ok) return undefined;
    const body = await response.json();
    return typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined;
  } catch {
    return undefined;
  }
}

function runCommand(command, args, options = {}) {
  let outputFd;
  try {
    if (options.outputFile) outputFd = openSync(options.outputFile, "wx", 0o600);
    const result = spawnSync(command, args, {
      cwd: projectRoot,
      stdio: ["ignore", outputFd ?? "pipe", "inherit"]
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`${command} exited with status ${result.status ?? "unknown"}.`);
    }
    return outputFd === undefined ? result.stdout : Buffer.alloc(0);
  } finally {
    if (outputFd !== undefined) closeSync(outputFd);
  }
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWorkspaceBackup(parseArgs(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`Jarvis workspace backup failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
