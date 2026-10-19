import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { exampleOutboundMessage, type PlatformCatalogV2 } from "@second-brain/contracts";
import { matrixTransactionId } from "@second-brain/matrix-adapter";
import { platformCatalogDigestV2, platformPolicyDigestV2 } from "@second-brain/platform-catalog";
import { createRunId, eventually } from "@second-brain/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sanitizeMatrixGatewayDiagnostics } from "./compose-diagnostics.js";
import { runOperator } from "../../../scripts/operator/jarvis.mjs";
import { writeValidReleaseArtifacts } from "../../../scripts/setup/test-artifact-fixtures.mjs";

const execFileAsync = promisify(execFile);
const composeFile = "deploy/compose/compose.system-test.yml";
const projectName = createRunId("jarvis-compose");
let controlPort = process.env.BRAIN_CONTROL_HOST_PORT;
let gatewayPort = process.env.MATRIX_GATEWAY_HOST_PORT;
let homeserverPort = process.env.MATRIX_HOMESERVER_HOST_PORT;
let mediaWorkerPort = process.env.MEDIA_WORKER_HOST_PORT;
let controlUrl = "";
let gatewayUrl = "";
let homeserverUrl = "";
let mediaWorkerUrl = "";
const sttComposeEnabled = process.env.RUN_STT_COMPOSE === "true";
const applicationUpdateRehearsalEnabled = process.env.RUN_APPLICATION_UPDATE_REHEARSAL === "true";
const sttFixturePath = process.env.WHISPER_CPP_INTEGRATION_AUDIO_PATH;
const sttExpectedText = process.env.WHISPER_CPP_INTEGRATION_EXPECT_TEXT;
const systemTestRegistrationToken = "jarvis-system-test-registration-token";
const systemTestPluginAdminToken = "system-test-plugin-admin-token";
const systemCatalogImages = {
  base: `sha256:${"a".repeat(64)}`,
  isolated: `sha256:${"b".repeat(64)}`,
  browser: `sha256:${"c".repeat(64)}`
};
// Docker installations without Buildx use the slower serial builder for the
// application and runtime images. A cold Phase 2 build now includes the shared
// catalog and installed-plugin packages in every relevant image and can
// legitimately exceed 10 minutes on a cold builder.
const composeStartupTimeoutMs = 900_000;
let composeStartupAttempted = false;
let platformCatalogDir = "";
let platformCatalogDigest = "";
let platformPolicyDigest = "";
let deterministicWorkspaceId = "";

describe("Compose system smoke", () => {
  beforeAll(async () => {
    platformCatalogDir = await mkdtemp(join(tmpdir(), "jarvis-system-catalog-"));
    // The containers run as an unprivileged `brain` user. mkdtemp creates a
    // 0700 directory, so make this read-only bind source traversable before
    // writing the world-readable immutable artifact into it.
    await chmod(platformCatalogDir, 0o755);
    const platformCatalog = await buildSystemCatalog(systemCatalogImages);
    platformCatalogDigest = platformCatalog.digest;
    platformPolicyDigest = platformCatalog.policyDigest;
    await assertDockerAvailable();
    if (
      sttComposeEnabled &&
      (!sttFixturePath || !sttExpectedText || !process.env.WHISPER_MODEL_HOST_DIR)
    ) {
      throw new Error(
        "RUN_STT_COMPOSE requires WHISPER_MODEL_HOST_DIR, WHISPER_CPP_INTEGRATION_AUDIO_PATH, and WHISPER_CPP_INTEGRATION_EXPECT_TEXT."
      );
    }
    const allocatedPorts = await availablePorts(
      [
        controlPort,
        gatewayPort,
        homeserverPort,
        ...(sttComposeEnabled ? [mediaWorkerPort] : [])
      ].filter((port) => port === undefined).length
    );
    controlPort ??= allocatedPorts.shift();
    gatewayPort ??= allocatedPorts.shift();
    homeserverPort ??= allocatedPorts.shift();
    if (sttComposeEnabled) {
      mediaWorkerPort ??= allocatedPorts.shift();
    }
    controlUrl = `http://127.0.0.1:${controlPort}`;
    gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
    homeserverUrl = `http://127.0.0.1:${homeserverPort}`;
    mediaWorkerUrl = `http://127.0.0.1:${mediaWorkerPort}`;
    composeStartupAttempted = true;
    try {
      await compose(["up", "--build", "--detach", "--wait"], composeEnvironment());
      const workspace = await postJson<WorkspaceResolution>(
        `${controlUrl}/v1/workspaces/accept-trusted-invite`,
        { roomId: "!brain:example" }
      );
      deterministicWorkspaceId = workspace.workspaceId;
    } catch (error) {
      await reportComposeStartupDiagnostics();
      throw error;
    }
  }, composeStartupTimeoutMs);

  afterAll(async () => {
    if (composeStartupAttempted) {
      await compose(["down", "--volumes", "--remove-orphans"], composeEnvironment());
    }
    if (platformCatalogDir) {
      await rm(platformCatalogDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("accepts one Matrix text event through gateway and delivers one deterministic outbound reply", async () => {
    await expect(getJson(`${controlUrl}/health`)).resolves.toMatchObject({
      service: "brain-control",
      status: "ready",
      catalogDigest: platformCatalogDigest
    });
    await expect(getJson(`${gatewayUrl}/health`)).resolves.toMatchObject({
      service: "matrix-gateway",
      status: "ready",
      catalogDigest: platformCatalogDigest
    });

    await expect(
      postJson(`${gatewayUrl}/v1/matrix-events`, matrixTextEvent("$compose-smoke-1", "hello"))
    ).resolves.toMatchObject({ status: "submitted", duplicate: false });

    await expect(getJson(`${controlUrl}/v1/jobs`)).resolves.toMatchObject([
      { type: "process_inbound", status: "pending" }
    ]);

    await expect(
      postJson(`${controlUrl}/v1/outbound`, {
        ...exampleOutboundMessage,
        workspaceId: deterministicWorkspaceId,
        id: "outbound-compose-smoke",
        traceId: "trace-compose-smoke",
        conversationId: "!brain:example",
        text: "compose reply",
        idempotencyKey: "compose-smoke-reply"
      })
    ).resolves.toMatchObject({ id: "outbound-compose-smoke" });

    await eventually(
      async () => {
        const outbound = await getJson<Record<string, unknown>>(
          `${controlUrl}/v1/outbound/outbound-compose-smoke`
        );
        expect(outbound).toMatchObject({ id: "outbound-compose-smoke" });
        const attempts = await deliveryAttempts("outbound-compose-smoke");
        expect(attempts).toEqual([
          {
            status: "delivered",
            external_event_id: `$${matrixTransactionId({
              ...exampleOutboundMessage,
              id: "outbound-compose-smoke:text",
              idempotencyKey: "compose-smoke-reply:text"
            })}`
          }
        ]);
      },
      { description: "matrix gateway deterministic outbound delivery", timeoutMs: 10_000 }
    );
  });

  it("creates a durable schedule and claims its due occurrence into the worker queue", async () => {
    const runAt = new Date(Date.now() + 8_000).toISOString();
    const created = await postJson<{
      schedule: { id: string; workspaceId: string; nextRunAt?: string; enabled: boolean };
      preview: { nextRunAt?: string };
    }>(`${controlUrl}/v1/schedules`, {
      workspaceId: deterministicWorkspaceId,
      destinationConversationId: "!brain:example",
      name: "Compose schedule acceptance",
      instruction: "Return the fixed phrase: compose schedule accepted",
      schedule: { type: "once", runAt },
      sessionPolicy: { type: "fresh" },
      notificationPolicy: "always",
      missedRunPolicy: "run_once"
    });

    expect(created.schedule).toMatchObject({
      workspaceId: deterministicWorkspaceId,
      enabled: true,
      name: "Compose schedule acceptance"
    });
    expect(created.schedule.nextRunAt).toBe(created.preview.nextRunAt);
    expect(created.schedule.nextRunAt).toBeDefined();

    await eventually(
      async () => {
        const claimed = await postJson<Array<{ id: string; scheduleId: string; status: string }>>(
          `${controlUrl}/v1/schedules/claim-due`,
          { limit: 10 }
        );
        expect(claimed).toEqual([
          expect.objectContaining({ scheduleId: created.schedule.id, status: "queued" })
        ]);
      },
      { description: "due schedule queued for worker execution", timeoutMs: 20_000 }
    );

    await expect(
      getJson<Array<{ scheduleId: string; status: string }>>(
        `${controlUrl}/v1/schedules/${encodeURIComponent(created.schedule.id)}/history`
      )
    ).resolves.toEqual([
      expect.objectContaining({ scheduleId: created.schedule.id, status: "queued" })
    ]);
    await expect(
      getJson<Array<{ type: string; status: string }>>(`${controlUrl}/v1/jobs`)
    ).resolves.toContainEqual(expect.objectContaining({ type: "run_schedule", status: "pending" }));
  });

  it("recovers a gateway restart after inbound acceptance without duplicating Pi work", async () => {
    const event = matrixTextEvent("$compose-restart-1", "restart recovery");

    await expect(postJson(`${gatewayUrl}/v1/matrix-events`, event)).resolves.toMatchObject({
      status: "submitted",
      duplicate: false
    });

    await compose(["restart", "matrix-gateway"], composeEnvironment());

    await eventually(
      async () => {
        await expect(getJson(`${gatewayUrl}/health`)).resolves.toMatchObject({
          service: "matrix-gateway",
          status: "ready"
        });
      },
      { description: "matrix gateway restart", timeoutMs: 10_000 }
    );

    await expect(postJson(`${gatewayUrl}/v1/matrix-events`, event)).resolves.toMatchObject({
      status: "submitted",
      duplicate: true
    });

    const inboundJobs = (
      await getJson<Array<{ type: string; status: string }>>(`${controlUrl}/v1/jobs`)
    ).filter((job) => job.type === "process_inbound");
    expect(inboundJobs).toMatchObject([
      { type: "process_inbound", status: "pending" },
      { type: "process_inbound", status: "pending" }
    ]);
  });

  it(
    "restarts the deployed stack without losing accepted inbound idempotency state",
    async () => {
      const event = matrixTextEvent("$compose-reboot-1", "reboot recovery");
      const initialJobCount = (await getJson<unknown[]>(`${controlUrl}/v1/jobs`)).length;

      await expect(postJson(`${gatewayUrl}/v1/matrix-events`, event)).resolves.toMatchObject({
        status: "submitted",
        duplicate: false
      });
      await expect(getJson(`${controlUrl}/v1/jobs`)).resolves.toHaveLength(initialJobCount + 1);

      await compose(["down", "--remove-orphans"], composeEnvironment());
      await compose(["up", "--build", "--detach", "--wait"], composeEnvironment());

      await expect(getJson(`${controlUrl}/health`)).resolves.toMatchObject({
        service: "brain-control",
        status: "ready"
      });
      await expect(getJson(`${gatewayUrl}/health`)).resolves.toMatchObject({
        service: "matrix-gateway",
        status: "ready"
      });
      await expect(postJson(`${gatewayUrl}/v1/matrix-events`, event)).resolves.toMatchObject({
        status: "submitted",
        duplicate: true
      });
      await expect(getJson(`${controlUrl}/v1/jobs`)).resolves.toHaveLength(initialJobCount + 1);
    },
    composeStartupTimeoutMs
  );

  it(
    "round-trips the isolated database and release artifacts through the operator backup and restore commands",
    async (context) => {
      const stateRoot = await mkdtemp(join(tmpdir(), "jarvis-restore-rehearsal-"));
      context.onTestFinished(() => rm(stateRoot, { recursive: true, force: true }));
      await writeFile(
        join(stateRoot, "setup-state.json"),
        JSON.stringify({
          version: 1,
          completedStages: ["preflight", "state-directories", "environment"]
        })
      );
      await writeFile(
        join(stateRoot, "production.env"),
        [
          "MATRIX_OWNER_ID='@owner:system-test'",
          "MATRIX_BRAIN_USER_ID='@brain:system-test'",
          "MATRIX_ACCESS_TOKEN='system-test-token'",
          "MATRIX_RECOVERY_KEY='system-test-recovery-key'",
          "CONTINUWUITY_ALLOW_REGISTRATION=false",
          ""
        ].join("\n"),
        { mode: 0o600 }
      );
      const originalArtifacts = {
        "platform-catalog": ["platform-catalog.v2.json", '{"catalogDigest":"before"}\n'],
        "runtime-profile": ["current-runtime.json", '{"profileDigest":"before"}\n']
      } as const;
      for (const [directory, [filename, content]] of Object.entries(originalArtifacts)) {
        await mkdir(join(stateRoot, directory));
        await writeFile(join(stateRoot, directory, filename), content);
      }

      const table = `restore_rehearsal_${createRunId("backup").replaceAll("-", "_")}`;
      const operatorComposeArgs = [
        "compose",
        "--project-name",
        projectName,
        ...(sttComposeEnabled ? ["--profile", "stt"] : []),
        "-f",
        composeFile
      ];
      const operatorRun = (
        program: string,
        args: string[],
        options: { outputFile?: string; inputFile?: string } = {}
      ) => {
        const env = { ...process.env, ...composeEnvironment() };
        let outputFd: number | undefined;
        try {
          if (options.outputFile) outputFd = openSync(options.outputFile, "wx", 0o600);
          const result = spawnSync(program, args, {
            cwd: new URL("../../..", import.meta.url),
            env,
            input: options.inputFile ? readFileSync(options.inputFile) : undefined,
            stdio: options.outputFile
              ? ["ignore", outputFd!, "inherit"]
              : options.inputFile
                ? ["pipe", "inherit", "inherit"]
                : "inherit"
          });
          if (result.error) throw result.error;
          if (result.status !== 0)
            throw new Error(`${program} exited with status ${result.status}.`);
          return Buffer.alloc(0);
        } finally {
          if (outputFd !== undefined) closeSync(outputFd);
        }
      };
      const operatorDependencies = {
        composeArgs: operatorComposeArgs,
        run: operatorRun,
        output: () => undefined
      };

      try {
        await compose(
          [
            "exec",
            "-T",
            "brain-db",
            "psql",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "brain",
            "-d",
            "brain",
            "-c",
            `CREATE TABLE public.${table} (value text NOT NULL); INSERT INTO public.${table} VALUES ('before');`
          ],
          composeEnvironment()
        );
        await runOperator({ command: "backup", stateRoot }, operatorDependencies);
        const backupDirectories = await readdir(join(stateRoot, "backups"));
        expect(backupDirectories).toHaveLength(1);
        const backupPath = join(stateRoot, "backups", backupDirectories[0]!);

        await compose(
          [
            "exec",
            "-T",
            "brain-db",
            "psql",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "brain",
            "-d",
            "brain",
            "-c",
            `UPDATE public.${table} SET value = 'mutated';`
          ],
          composeEnvironment()
        );
        for (const [directory, [filename]] of Object.entries(originalArtifacts)) {
          await writeFile(
            join(stateRoot, directory, filename),
            directory === "platform-catalog"
              ? '{"catalogDigest":"mutated"}\n'
              : '{"profileDigest":"mutated"}\n'
          );
        }

        await runOperator(
          { command: "restore", positional: [backupPath], stateRoot, yes: true },
          operatorDependencies
        );
        const query = await composeOutput(
          [
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
            `SELECT value FROM public.${table}`
          ],
          composeEnvironment()
        );
        expect(query.trim()).toBe("before");
        for (const [directory, [filename, content]] of Object.entries(originalArtifacts)) {
          await expect(readFile(join(stateRoot, directory, filename), "utf8")).resolves.toBe(
            content
          );
        }
      } finally {
        await compose(
          [
            "exec",
            "-T",
            "brain-db",
            "psql",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "brain",
            "-d",
            "brain",
            "-c",
            `DROP TABLE IF EXISTS public.${table}`
          ],
          composeEnvironment()
        );
      }
    },
    composeStartupTimeoutMs
  );

  it("delivers one outbound text message through a real private Matrix room", async () => {
    const matrixRunId = createRunId("matrix");
    await resetMatrixHomeserver();
    await eventually(
      async () => {
        const versions = await getJson<{ versions?: unknown }>(
          `${homeserverUrl}/_matrix/client/versions`
        );
        expect(Array.isArray(versions.versions)).toBe(true);
      },
      { description: "Matrix homeserver readiness", timeoutMs: 30_000 }
    );

    const owner = await registerBootstrapMatrixUser(`owner-${matrixRunId}`);
    const brain = await registerMatrixUser(`brain-${matrixRunId}`, systemTestRegistrationToken);
    const room = await matrixPost<{ room_id: string }>(
      owner.accessToken,
      "/_matrix/client/v3/createRoom",
      { invite: [brain.userId], is_direct: true, preset: "private_chat" }
    );
    await matrixPost(
      brain.accessToken,
      `/_matrix/client/v3/join/${encodeURIComponent(room.room_id)}`,
      {}
    );
    const workspace = await postJson<WorkspaceResolution>(
      `${controlUrl}/v1/workspaces/accept-trusted-invite`,
      { roomId: room.room_id }
    );

    await compose(["up", "--detach", "--force-recreate", "--no-deps", "matrix-gateway"], {
      ...composeEnvironment(),
      MATRIX_ACCESS_TOKEN: brain.accessToken,
      MATRIX_OWNER_ID: owner.userId,
      MATRIX_BRAIN_USER_ID: brain.userId
    });
    await waitForGatewayReady();

    // This test can be run by itself or after the preceding smoke tests. Count
    // only the work added here instead of relying on the suite's accumulated
    // job total.
    const initialJobCount = (await getJson<unknown[]>(`${controlUrl}/v1/jobs`)).length;

    await matrixPut(
      owner.accessToken,
      `/_matrix/client/v3/rooms/${encodeURIComponent(room.room_id)}/send/m.room.message/owner-inbound`,
      { msgtype: "m.text", body: "real Matrix inbound" }
    );
    await eventually(
      async () => {
        await expect(getJson(`${controlUrl}/v1/jobs`)).resolves.toHaveLength(initialJobCount + 1);
      },
      { description: "real Matrix inbound acceptance", timeoutMs: 30_000 }
    );

    const inboundFile = await matrixUpload(
      owner.accessToken,
      "fixture.txt",
      "text/plain",
      Buffer.from("private file fixture")
    );
    await matrixPut(
      owner.accessToken,
      `/_matrix/client/v3/rooms/${encodeURIComponent(room.room_id)}/send/m.room.message/owner-file-inbound`,
      {
        msgtype: "m.file",
        body: "fixture.txt",
        url: inboundFile,
        info: { mimetype: "text/plain", size: 20 }
      }
    );
    try {
      await eventually(
        async () => {
          await expect(getJson(`${controlUrl}/v1/jobs`)).resolves.toHaveLength(initialJobCount + 2);
        },
        { description: "real Matrix file inbound acceptance", timeoutMs: 30_000 }
      );
    } catch (error) {
      await reportMatrixGatewayFailureDiagnostics();
      throw error;
    }

    await expect(
      postJson(`${controlUrl}/v1/outbound`, {
        ...exampleOutboundMessage,
        workspaceId: workspace.workspaceId,
        id: "outbound-real-matrix",
        traceId: "trace-real-matrix",
        conversationId: room.room_id,
        text: "real Matrix reply",
        idempotencyKey: "real-matrix-reply"
      })
    ).resolves.toMatchObject({ id: "outbound-real-matrix" });

    await eventually(
      async () => {
        const sync = await matrixGet<MatrixSyncResponse>(
          owner.accessToken,
          "/_matrix/client/v3/sync"
        );
        const events = sync.rooms?.join?.[room.room_id]?.timeline?.events ?? [];
        expect(hasMatrixMessage(events, brain.userId, "m.text", "real Matrix reply")).toBe(true);
      },
      { description: "real Matrix outbound delivery", timeoutMs: 30_000 }
    );

    const audioStorageKey = `outbound/audio/${matrixRunId}.ogg`;
    await placeExchangeFile(audioStorageKey, Buffer.from("synthetic-ogg-media"));
    await expect(
      postJson(`${controlUrl}/v1/outbound`, {
        ...exampleOutboundMessage,
        workspaceId: workspace.workspaceId,
        id: "outbound-real-matrix-audio",
        traceId: "trace-real-matrix-audio",
        conversationId: room.room_id,
        text: undefined,
        audio: {
          schemaVersion: 1,
          id: `audio-${matrixRunId}`,
          purpose: "outbound",
          mediaType: "audio/ogg",
          sizeBytes: 19,
          sha256: "a".repeat(64),
          storageKey: audioStorageKey,
          originalFilename: "reply.ogg",
          durationMs: 1000
        },
        images: [],
        idempotencyKey: "real-matrix-audio"
      })
    ).resolves.toMatchObject({ id: "outbound-real-matrix-audio" });
    await eventually(
      async () => {
        const sync = await matrixGet<MatrixSyncResponse>(
          owner.accessToken,
          "/_matrix/client/v3/sync"
        );
        const events = sync.rooms?.join?.[room.room_id]?.timeline?.events ?? [];
        expect(hasMatrixAudioMessage(events, brain.userId)).toBe(true);
      },
      { description: "real Matrix audio delivery", timeoutMs: 30_000 }
    );

    const fileStorageKey = `outbound/files/${matrixRunId}.txt`;
    await placeExchangeFile(fileStorageKey, Buffer.from("outbound file fixture"));
    await expect(
      postJson(`${controlUrl}/v1/outbound`, {
        ...exampleOutboundMessage,
        workspaceId: workspace.workspaceId,
        id: "outbound-real-matrix-file",
        traceId: "trace-real-matrix-file",
        conversationId: room.room_id,
        text: undefined,
        images: [],
        files: [
          {
            schemaVersion: 1,
            id: `file-${matrixRunId}`,
            purpose: "outbound",
            mediaType: "text/plain",
            sizeBytes: 21,
            sha256: "b".repeat(64),
            storageKey: fileStorageKey,
            originalFilename: "reply.txt"
          }
        ],
        idempotencyKey: "real-matrix-file"
      })
    ).resolves.toMatchObject({ id: "outbound-real-matrix-file" });
    await eventually(
      async () => {
        const sync = await matrixGet<MatrixSyncResponse>(
          owner.accessToken,
          "/_matrix/client/v3/sync"
        );
        const events = sync.rooms?.join?.[room.room_id]?.timeline?.events ?? [];
        expect(hasMatrixFileMessage(events, brain.userId)).toBe(true);
      },
      { description: "real Matrix file delivery", timeoutMs: 30_000 }
    );
  }, 90_000);

  it("retries a real Matrix outbound delivery after a homeserver outage", async () => {
    const matrixRunId = createRunId("matrix-retry");
    await resetMatrixHomeserver();
    const owner = await registerBootstrapMatrixUser(`owner-${matrixRunId}`);
    const brain = await registerMatrixUser(`brain-${matrixRunId}`, systemTestRegistrationToken);
    const room = await matrixPost<{ room_id: string }>(
      owner.accessToken,
      "/_matrix/client/v3/createRoom",
      { invite: [brain.userId], is_direct: true, preset: "private_chat" }
    );
    await matrixPost(
      brain.accessToken,
      `/_matrix/client/v3/join/${encodeURIComponent(room.room_id)}`,
      {}
    );
    const workspace = await postJson<WorkspaceResolution>(
      `${controlUrl}/v1/workspaces/accept-trusted-invite`,
      { roomId: room.room_id }
    );
    await compose(["up", "--detach", "--force-recreate", "--no-deps", "matrix-gateway"], {
      ...composeEnvironment(),
      MATRIX_ACCESS_TOKEN: brain.accessToken,
      MATRIX_OWNER_ID: owner.userId,
      MATRIX_BRAIN_USER_ID: brain.userId
    });
    await waitForGatewayReady();

    await compose(["stop", "matrix-homeserver"], composeEnvironment());
    await expect(
      postJson(`${controlUrl}/v1/outbound`, {
        ...exampleOutboundMessage,
        workspaceId: workspace.workspaceId,
        id: "outbound-real-matrix-retry",
        traceId: "trace-real-matrix-retry",
        conversationId: room.room_id,
        text: "real Matrix retry",
        idempotencyKey: "real-matrix-retry"
      })
    ).resolves.toMatchObject({ id: "outbound-real-matrix-retry" });
    await eventually(
      async () => {
        expect(await deliveryAttempts("outbound-real-matrix-retry")).toEqual(
          expect.arrayContaining([{ status: "retry_wait", external_event_id: null }])
        );
      },
      { description: "Matrix outbound retry persistence", timeoutMs: 30_000 }
    );

    await compose(["start", "matrix-homeserver"], composeEnvironment());
    await eventually(
      async () => {
        const sync = await matrixGet<MatrixSyncResponse>(
          owner.accessToken,
          "/_matrix/client/v3/sync"
        );
        const events = sync.rooms?.join?.[room.room_id]?.timeline?.events ?? [];
        const replies = events.filter(
          (event) =>
            event.type === "m.room.message" &&
            event.sender === brain.userId &&
            isRecord(event.content) &&
            event.content.msgtype === "m.text" &&
            event.content.body === "real Matrix retry"
        );
        expect(replies).toHaveLength(1);
        expect(await deliveryAttempts("outbound-real-matrix-retry")).toEqual(
          expect.arrayContaining([expect.objectContaining({ status: "delivered" })])
        );
      },
      { description: "Matrix outbound retry delivery", timeoutMs: 30_000 }
    );
  }, 120_000);

  it("accepts a trusted invite through Matrix, activates it, and ignores an untrusted invite", async () => {
    const { owner, brain } = await bootstrapWorkspaceRegistry();
    const trustedRoom = await createPrivateRoom(owner, brain);
    const workspace = await waitForWorkspaceStatus(trustedRoom, "active");
    expect(workspace).toMatchObject({
      templateId: "second-brain",
      templateVersion: "1.0.0"
    });
    await waitForWorkspace(workspace.workspaceId, (current) => {
      expect(current).toMatchObject({
        status: "active",
        defaultAgent: "brain",
        configuration: {}
      });
    });

    await configureGatewayForUntrustedInvites(owner, brain);
    const untrustedRoom = await createPrivateRoom(owner, brain);
    await eventually(
      async () => {
        const response = await postJsonResponse(`${controlUrl}/v1/workspaces/resolve-room`, {
          roomId: untrustedRoom
        });
        expect(response.status).toBe(404);
        const membership = await matrixGet<Record<string, unknown>>(
          owner.accessToken,
          `/_matrix/client/v3/rooms/${encodeURIComponent(untrustedRoom)}/state/m.room.member/${encodeURIComponent(brain.userId)}`
        );
        expect(membership).toMatchObject({ membership: "invite" });
      },
      { description: "untrusted Matrix invite remains unbound", timeoutMs: 30_000 }
    );
  }, 120_000);

  it("preserves active workspaces across restart and archives them on command or kick", async () => {
    const { owner, brain } = await bootstrapWorkspaceRegistry();
    const restartRoom = await createPrivateRoom(owner, brain);
    const restartWorkspace = await waitForWorkspaceStatus(restartRoom, "active");

    await compose(["restart", "brain-control", "matrix-gateway"], composeEnvironment());
    await eventually(
      async () => {
        await expect(getJson(`${controlUrl}/health`)).resolves.toMatchObject({ status: "ready" });
        await expect(getJson(`${gatewayUrl}/health`)).resolves.toMatchObject({ status: "ready" });
      },
      { description: "workspace stack restart", timeoutMs: 30_000 }
    );
    await expect(waitForWorkspaceStatus(restartRoom, "active")).resolves.toMatchObject({
      workspaceId: restartWorkspace.workspaceId
    });

    await sendMatrixText(owner, restartRoom, "workspace-archive", "/workspace archive");
    await expect(waitForWorkspaceStatus(restartRoom, "archived")).resolves.toMatchObject({
      workspaceId: restartWorkspace.workspaceId
    });

    const kickedRoom = await createPrivateRoom(owner, brain);
    const kickedWorkspace = await waitForActiveWorkspace(kickedRoom);
    await matrixPost(
      owner.accessToken,
      `/_matrix/client/v3/rooms/${encodeURIComponent(kickedRoom)}/kick`,
      {
        user_id: brain.userId,
        reason: "system test kick"
      }
    );
    await expect(waitForWorkspaceStatus(kickedRoom, "archived")).resolves.toMatchObject({
      workspaceId: kickedWorkspace.workspaceId
    });
  }, 120_000);

  it("enables, persists, and disables a workspace plugin through the deployed control plane", async () => {
    const { owner, brain } = await bootstrapWorkspaceRegistry();
    const room = await createPrivateRoom(owner, brain);
    const workspace = await waitForActiveWorkspace(room);
    const bindingUrl = `${controlUrl}/v1/workspaces/${workspace.workspaceId}/plugins/example-echo`;

    await expect(
      pluginBindingRequest(bindingUrl, "PUT", {
        enabledAgents: ["echo"],
        configuration: {}
      })
    ).resolves.toBe(204);
    await expect(pluginBindingGet(bindingUrl)).resolves.toMatchObject({
      workspaceId: workspace.workspaceId,
      pluginId: "example-echo",
      enabledAgents: ["echo"],
      configuration: {}
    });

    await compose(["restart", "brain-control"], composeEnvironment());
    await eventually(
      async () => {
        await expect(getJson(`${controlUrl}/health`)).resolves.toMatchObject({ status: "ready" });
        await expect(pluginBindingGet(bindingUrl)).resolves.toMatchObject({
          pluginId: "example-echo",
          enabledAgents: ["echo"]
        });
      },
      { description: "workspace plugin binding restart persistence", timeoutMs: 30_000 }
    );

    await expect(pluginBindingRequest(bindingUrl, "DELETE")).resolves.toBe(204);
    await expect(pluginBindingGet(bindingUrl)).resolves.toBeNull();
  }, 120_000);

  it("keeps two simultaneously active Matrix workspaces isolated at the job boundary", async () => {
    const { owner, brain } = await bootstrapWorkspaceRegistry();
    // Conduwuit may coalesce identical concurrent createRoom requests. Create
    // the rooms sequentially so this test exercises workspace isolation rather
    // than homeserver request deduplication.
    const firstRoom = await createPrivateRoom(owner, brain);
    const secondRoom = await createPrivateRoom(owner, brain);
    expect(firstRoom).not.toBe(secondRoom);
    const [firstWorkspace, secondWorkspace] = await Promise.all([
      waitForActiveWorkspace(firstRoom),
      waitForActiveWorkspace(secondRoom)
    ]);
    expect(firstWorkspace.workspaceId).not.toBe(secondWorkspace.workspaceId);

    const firstMessage = await sendMatrixText(owner, firstRoom, "first-message", "first workspace");
    const secondMessage = await sendMatrixText(
      owner,
      secondRoom,
      "second-message",
      "second workspace"
    );
    await eventually(
      async () => {
        const jobs = await getJson<
          Array<{ workspaceId?: string; payload?: Record<string, unknown> }>
        >(`${controlUrl}/v1/jobs`);
        expect(
          jobs.find((job) => job.payload?.externalEventId === firstMessage.event_id)
        ).toMatchObject({ workspaceId: firstWorkspace.workspaceId });
        expect(
          jobs.find((job) => job.payload?.externalEventId === secondMessage.event_id)
        ).toMatchObject({ workspaceId: secondWorkspace.workspaceId });
      },
      { description: "two workspace inbound jobs", timeoutMs: 30_000 }
    );
  }, 120_000);

  it("accepts a trusted invite through the E2EE gateway lifecycle path", async () => {
    await resetMatrixHomeserver();
    const runId = createRunId("workspace-e2ee");
    const owner = await registerBootstrapMatrixUser(`owner-${runId}`);
    const brain = await registerMatrixUser(`brain-${runId}`, systemTestRegistrationToken);
    await configureWorkspaceGateway(owner, brain, { e2ee: true });

    const projectRoom = await createPrivateRoom(owner, brain);
    await expect(waitForWorkspaceStatus(projectRoom, "active")).resolves.toMatchObject({
      templateId: "second-brain",
      templateVersion: "1.0.0"
    });
  }, 120_000);

  it("fails gateway readiness when one deployed service reloads mismatched policy", async () => {
    const replacement = await buildPolicyVariantSystemCatalog(systemCatalogImages);
    expect(replacement.digest).not.toBe(platformCatalogDigest);
    expect(replacement.policyDigest).not.toBe(platformPolicyDigest);

    try {
      await compose(
        ["up", "--detach", "--force-recreate", "--no-deps", "brain-control"],
        composeEnvironment()
      );
      await eventually(
        async () => {
          await expect(getJson(`${controlUrl}/health`)).resolves.toMatchObject({
            status: "ready",
            catalogDigest: replacement.digest,
            policyDigest: replacement.policyDigest
          });
        },
        { description: "brain-control catalog replacement", timeoutMs: 30_000 }
      );
      await eventually(
        async () => {
          const response = await fetch(`${gatewayUrl}/health`);
          expect(response.status).toBe(503);
          await expect(response.json()).resolves.toMatchObject({
            service: "matrix-gateway",
            status: "degraded",
            catalogDigest: platformCatalogDigest,
            policyDigest: platformPolicyDigest
          });
        },
        { description: "gateway mismatched policy rejection", timeoutMs: 30_000 }
      );
    } finally {
      await buildSystemCatalog(systemCatalogImages);
      await compose(
        ["up", "--detach", "--force-recreate", "--no-deps", "brain-control"],
        composeEnvironment()
      );
      await eventually(
        async () => {
          await expect(getJson(`${gatewayUrl}/health`)).resolves.toMatchObject({
            status: "ready",
            catalogDigest: platformCatalogDigest
          });
        },
        { description: "gateway catalog restoration", timeoutMs: 30_000 }
      );
    }
  }, 120_000);

  it.skipIf(!sttComposeEnabled)(
    "transcribes the verified real Ogg fixture through the hardened Compose media worker",
    async () => {
      if (!sttFixturePath || !sttExpectedText) {
        throw new Error(
          "RUN_STT_COMPOSE requires WHISPER_CPP_INTEGRATION_AUDIO_PATH and WHISPER_CPP_INTEGRATION_EXPECT_TEXT."
        );
      }
      const bytes = await readFile(sttFixturePath);
      const storageKey = `inbound/compose-stt-${createRunId("fixture")}.ogg`;
      await placeExchangeFile(storageKey, bytes);

      const transcript = await postJson<{ text: string; language?: string }>(
        `${mediaWorkerUrl}/v1/media/transcriptions`,
        {
          schemaVersion: 1,
          id: "compose-stt-fixture",
          purpose: "inbound",
          mediaType: "audio/ogg",
          sizeBytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          storageKey
        }
      );

      expect(transcript.text.toLocaleLowerCase()).toContain(sttExpectedText.toLocaleLowerCase());
      expect(transcript.language).toBe("en");
    },
    120_000
  );

  it.skipIf(!applicationUpdateRehearsalEnabled)(
    "runs the application updater against this isolated Compose database",
    async (context) => {
      const stateRoot = await mkdtemp(join(tmpdir(), "jarvis-update-rehearsal-"));
      context.onTestFinished(() => rm(stateRoot, { recursive: true, force: true }));
      await writeFile(
        join(stateRoot, "setup-state.json"),
        JSON.stringify({
          version: 1,
          completedStages: ["preflight", "state-directories", "environment"]
        })
      );
      await writeFile(
        join(stateRoot, "production.env"),
        // Setup readiness needs synthetic Matrix values; Compose interpolation
        // is explicitly overridden to the unauthenticated system-test defaults
        // in composeEnvironment() so this token never reaches the gateway.
        [
          "MATRIX_OWNER_ID='@owner:system-test'",
          "MATRIX_BRAIN_USER_ID='@brain:system-test'",
          "MATRIX_ACCESS_TOKEN='system-test-token'",
          "MATRIX_RECOVERY_KEY='system-test-recovery-key'",
          "CONTINUWUITY_ALLOW_REGISTRATION=false",
          ""
        ].join("\n"),
        { mode: 0o600 }
      );
      for (const directory of ["platform-catalog", "runtime-profile"]) {
        await mkdir(join(stateRoot, directory));
      }
      await writeValidReleaseArtifacts(stateRoot);

      const queryMigration = () =>
        composeOutput(
          [
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
            "SELECT migration_number FROM brain_core.schema_metadata WHERE singleton"
          ],
          composeEnvironment()
        );
      const migrationBefore = (await queryMigration()).trim();
      expect(Number(migrationBefore)).toBeGreaterThan(0);

      const operatorRun = (program: string, args: string[]) => {
        const result = spawnSync(program, args, {
          cwd: new URL("../../..", import.meta.url),
          env: { ...process.env, ...composeEnvironment() },
          stdio: "inherit"
        });
        if (result.error) throw result.error;
        if (result.status !== 0) {
          throw new Error(`${program} exited with status ${result.status}.`);
        }
        return Buffer.alloc(0);
      };

      const operatorDependencies = {
        projectName,
        composeFile,
        run: operatorRun,
        output: () => undefined
      } as Parameters<typeof runOperator>[1];
      await runOperator(
        { command: "update", positional: ["application"], stateRoot },
        operatorDependencies
      );

      expect((await queryMigration()).trim()).toBe(migrationBefore);
      await eventually(
        async () => {
          await expect(getJson(`${controlUrl}/health`)).resolves.toMatchObject({
            status: "ready",
            catalogDigest: platformCatalogDigest
          });
        },
        { description: "application update service readiness", timeoutMs: 60_000 }
      );
    },
    composeStartupTimeoutMs
  );
});

async function assertDockerAvailable(): Promise<void> {
  try {
    await execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"]);
  } catch {
    throw new Error(
      "Docker is unavailable. Start Docker Desktop and wait until `docker info` succeeds before running pnpm test:system:compose."
    );
  }
}

async function compose(args: string[], env: NodeJS.ProcessEnv = {}): Promise<void> {
  await composeOutput(args, env);
}

async function composeOutput(args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  const result = await execFileAsync(
    "docker",
    [
      "compose",
      "-p",
      projectName,
      "-f",
      composeFile,
      ...(sttComposeEnabled ? ["--profile", "stt"] : []),
      ...args
    ],
    {
      cwd: new URL("../../..", import.meta.url),
      env: { ...process.env, ...env }
    }
  );
  return result.stdout;
}

async function reportComposeStartupDiagnostics(): Promise<void> {
  const diagnostics = [
    ["ps", "-a"],
    ["logs", "--no-color", "brain-control"]
  ] as const;
  for (const args of diagnostics) {
    try {
      const result = await execFileAsync(
        "docker",
        [
          "compose",
          "-p",
          projectName,
          "-f",
          composeFile,
          ...(sttComposeEnabled ? ["--profile", "stt"] : []),
          ...args
        ],
        {
          cwd: new URL("../../..", import.meta.url),
          env: { ...process.env, ...composeEnvironment() }
        }
      );
      console.error(
        `\nCompose startup diagnostics: docker compose ${args.join(" ")}\n${result.stdout}`
      );
      if (result.stderr) console.error(result.stderr);
    } catch (diagnosticError) {
      const output = diagnosticError as { stdout?: string; stderr?: string; message?: string };
      console.error(
        `\nCompose startup diagnostics unavailable for docker compose ${args.join(" ")}:\n${output.stdout ?? ""}${output.stderr ?? output.message ?? ""}`
      );
    }
  }
}

async function reportMatrixGatewayFailureDiagnostics(): Promise<void> {
  try {
    const result = await execFileAsync(
      "docker",
      [
        "compose",
        "-p",
        projectName,
        "-f",
        composeFile,
        "logs",
        "--no-color",
        "--no-log-prefix",
        "--since",
        "5m",
        "matrix-gateway"
      ],
      {
        cwd: new URL("../../..", import.meta.url),
        env: { ...process.env, ...composeEnvironment() }
      }
    );
    const diagnostics = sanitizeMatrixGatewayDiagnostics(`${result.stdout}\n${result.stderr}`);
    console.error(
      `\nCompose Matrix gateway failure diagnostics (allowlisted):\n${diagnostics.records.join("\n") || "No matching gateway failure records."}\nTotal matching failure records: ${diagnostics.totalRecords}; omitted: ${Math.max(0, diagnostics.totalRecords - diagnostics.records.length)}.`
    );
  } catch (error) {
    const output = error as { stdout?: string; stderr?: string };
    const diagnostics = sanitizeMatrixGatewayDiagnostics(
      `${output.stdout ?? ""}\n${output.stderr ?? ""}`
    );
    console.error(
      `\nCompose Matrix gateway failure diagnostics unavailable.\n${diagnostics.records.join("\n") || "No matching gateway failure records."}\nTotal matching failure records: ${diagnostics.totalRecords}; omitted: ${Math.max(0, diagnostics.totalRecords - diagnostics.records.length)}.`
    );
  }
}

function composeEnvironment(): NodeJS.ProcessEnv {
  return {
    BRAIN_CONTROL_HOST_PORT: controlPort,
    MATRIX_GATEWAY_HOST_PORT: gatewayPort,
    MATRIX_HOMESERVER_HOST_PORT: homeserverPort,
    MATRIX_ACCESS_TOKEN: "",
    MATRIX_OWNER_ID: "@owner:example",
    MATRIX_BRAIN_USER_ID: "@brain:example",
    MATRIX_E2EE_ENABLED: "false",
    PLATFORM_CATALOG_DIR: platformCatalogDir,
    ...(sttComposeEnabled
      ? {
          MEDIA_WORKER_HOST_PORT: mediaWorkerPort,
          WHISPER_MODEL_HOST_DIR: process.env.WHISPER_MODEL_HOST_DIR
        }
      : {})
  };
}

async function buildSystemCatalog(images: {
  base: string;
  isolated: string;
  browser: string;
}): Promise<{ digest: string; policyDigest: string }> {
  const outputPath = join(platformCatalogDir, "platform-catalog.v2.json");
  await execFileAsync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/plugins/platform-catalog-release.mjs",
      "build",
      "--output",
      outputPath
    ],
    {
      cwd: new URL("../../..", import.meta.url),
      env: {
        ...process.env,
        PLATFORM_CATALOG_RUNTIME_IMAGES: JSON.stringify(images)
      }
    }
  );
  const artifact = JSON.parse(await readFile(outputPath, "utf8")) as {
    digest?: unknown;
    policyDigest?: unknown;
  };
  if (typeof artifact.digest !== "string" || typeof artifact.policyDigest !== "string") {
    throw new Error("Generated system-test platform catalog has no execution identity.");
  }
  return { digest: artifact.digest, policyDigest: artifact.policyDigest };
}

async function buildPolicyVariantSystemCatalog(images: {
  base: string;
  isolated: string;
  browser: string;
}): Promise<{ digest: string; policyDigest: string }> {
  await buildSystemCatalog(images);
  const outputPath = join(platformCatalogDir, "platform-catalog.v2.json");
  const artifact = JSON.parse(await readFile(outputPath, "utf8")) as PlatformCatalogV2;
  const runtimeClass = artifact.runtimeClasses.find(({ id }) => id === "isolated");
  if (!runtimeClass) throw new Error("Generated system-test catalog has no isolated runtime.");
  runtimeClass.resourceCeiling.memoryMiB += 1;
  artifact.policyDigest = platformPolicyDigestV2(artifact);
  const { digest: _digest, ...content } = artifact;
  artifact.digest = platformCatalogDigestV2(content);
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return { digest: artifact.digest, policyDigest: artifact.policyDigest };
}

async function availablePorts(count: number): Promise<string[]> {
  const servers = await Promise.all(
    Array.from({ length: count }, async () => {
      const server = createServer();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
      });
      return server;
    })
  );
  try {
    return servers.map((server) => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Unable to allocate a localhost port for Compose system testing.");
      }
      return String(address.port);
    });
  } finally {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
          )
      )
    );
  }
}

async function getJson<T = unknown>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`POST ${url} failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function postJsonResponse(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function pluginBindingGet(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${systemTestPluginAdminToken}` }
  });
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  return response.json();
}

async function pluginBindingRequest(
  url: string,
  method: "PUT" | "DELETE",
  body?: unknown
): Promise<number> {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${systemTestPluginAdminToken}`,
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!response.ok) throw new Error(`${method} ${url} failed: ${response.status}`);
  return response.status;
}

async function bootstrapWorkspaceRegistry(): Promise<{ owner: MatrixUser; brain: MatrixUser }> {
  await resetMatrixHomeserver();
  const runId = createRunId("workspace-registry");
  const owner = await registerBootstrapMatrixUser(`owner-${runId}`);
  const brain = await registerMatrixUser(`brain-${runId}`, systemTestRegistrationToken);
  await configureWorkspaceGateway(owner, brain);
  return { owner, brain };
}

async function configureWorkspaceGateway(
  owner: MatrixUser,
  brain: MatrixUser,
  options: { e2ee?: boolean } = {}
): Promise<void> {
  await compose(["up", "--detach", "--force-recreate", "--no-deps", "matrix-gateway"], {
    ...composeEnvironment(),
    MATRIX_ACCESS_TOKEN: brain.accessToken,
    MATRIX_OWNER_ID: owner.userId,
    MATRIX_BRAIN_USER_ID: brain.userId,
    MATRIX_E2EE_ENABLED: options.e2ee ? "true" : "false"
  });
  await waitForGatewayReady();
}

async function waitForGatewayReady(): Promise<void> {
  await eventually(
    async () => {
      await expect(getJson(`${gatewayUrl}/health`)).resolves.toMatchObject({ status: "ready" });
    },
    { description: "workspace registry gateway readiness", timeoutMs: 30_000 }
  );
}

async function configureGatewayForUntrustedInvites(
  owner: MatrixUser,
  brain: MatrixUser
): Promise<void> {
  await configureWorkspaceGateway(
    { ...owner, userId: `@untrusted-${createRunId("workspace")}:matrix.test` },
    brain
  );
}

async function createPrivateRoom(owner: MatrixUser, brain: MatrixUser): Promise<string> {
  const room = await matrixPost<{ room_id: string }>(
    owner.accessToken,
    "/_matrix/client/v3/createRoom",
    { invite: [brain.userId], is_direct: true, preset: "private_chat" }
  );
  return room.room_id;
}

async function sendMatrixText(
  sender: MatrixUser,
  roomId: string,
  transactionId: string,
  body: string
): Promise<{ event_id: string }> {
  return matrixPut(
    sender.accessToken,
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${transactionId}`,
    { msgtype: "m.text", body }
  );
}

interface WorkspaceResolution {
  workspaceId: string;
  templateId: string;
  templateVersion: string;
  status: string;
}

async function waitForWorkspaceStatus(
  roomId: string,
  status: string
): Promise<WorkspaceResolution> {
  return eventually(
    async () => {
      const workspace = await postJson<WorkspaceResolution>(
        `${controlUrl}/v1/workspaces/resolve-room`,
        { roomId }
      );
      expect(workspace.status).toBe(status);
      return workspace;
    },
    { description: `workspace ${roomId} to become ${status}`, timeoutMs: 30_000 }
  );
}

async function waitForWorkspace(
  workspaceId: string,
  assertion: (
    workspace: Record<string, unknown> & { configuration: Record<string, unknown> }
  ) => void
): Promise<void> {
  await eventually(
    async () =>
      assertion(
        await getJson<Record<string, unknown> & { configuration: Record<string, unknown> }>(
          `${controlUrl}/v1/workspaces/${workspaceId}`
        )
      ),
    { description: `workspace ${workspaceId} state update`, timeoutMs: 30_000 }
  );
}

async function waitForActiveWorkspace(roomId: string): Promise<WorkspaceResolution> {
  return waitForWorkspaceStatus(roomId, "active");
}

async function deliveryAttempts(
  outboundMessageId: string
): Promise<Array<{ status: string; external_event_id: string | null }>> {
  const { stdout } = await execFileAsync(
    "docker",
    [
      "compose",
      "-p",
      projectName,
      "-f",
      composeFile,
      "exec",
      "-T",
      "brain-db",
      "psql",
      "-U",
      "brain",
      "-d",
      "brain",
      "-t",
      "-A",
      "-F",
      ",",
      "-c",
      `SELECT status, COALESCE(external_event_id, '') FROM brain_core.delivery_attempts WHERE outbound_message_id = '${outboundMessageId}' ORDER BY attempted_at ASC`
    ],
    {
      cwd: new URL("../../..", import.meta.url),
      env: { ...process.env, ...composeEnvironment() }
    }
  );
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, externalEventId] = line.split(",");
      return { status: status ?? "", external_event_id: externalEventId || null };
    });
}

async function placeExchangeFile(storageKey: string, bytes: Uint8Array): Promise<void> {
  const script = [
    "const fs = require('node:fs');",
    `const path = '/brain/exchange/${storageKey}';`,
    "fs.mkdirSync(require('node:path').dirname(path), { recursive: true });",
    `fs.writeFileSync(path, Buffer.from('${Buffer.from(bytes).toString("base64")}', 'base64'));`
  ].join(" ");
  await execFileAsync(
    "docker",
    [
      "compose",
      "-p",
      projectName,
      "-f",
      composeFile,
      "exec",
      "-T",
      "matrix-gateway",
      "node",
      "-e",
      script
    ],
    {
      cwd: new URL("../../..", import.meta.url),
      env: { ...process.env, ...composeEnvironment() }
    }
  );
}

async function resetMatrixHomeserver(): Promise<void> {
  await compose(["stop", "matrix-homeserver"], composeEnvironment());
  await compose(["rm", "--force", "matrix-homeserver"], composeEnvironment());
  await execFileAsync("docker", ["volume", "rm", `${projectName}_matrix-homeserver-data`], {
    cwd: new URL("../../..", import.meta.url)
  });
  await compose(["up", "--detach", "matrix-homeserver"], composeEnvironment());
  await eventually(
    async () => {
      const versions = await getJson<{ versions?: unknown }>(
        `${homeserverUrl}/_matrix/client/versions`
      );
      expect(Array.isArray(versions.versions)).toBe(true);
    },
    { description: "reset Matrix homeserver readiness", timeoutMs: 30_000 }
  );
}

async function registerBootstrapMatrixUser(username: string): Promise<MatrixUser> {
  const user = await registerMatrixUser(username, await initialRegistrationToken());
  await waitForRegistrationToken(systemTestRegistrationToken);
  return user;
}

async function waitForRegistrationToken(token: string): Promise<void> {
  await eventually(
    async () => {
      const response = await getJson<{ valid?: unknown }>(
        `${homeserverUrl}/_matrix/client/v1/register/m.login.registration_token/validity?token=${encodeURIComponent(token)}`
      );
      expect(response.valid).toBe(true);
    },
    { description: "configured Matrix registration token activation", timeoutMs: 30_000 }
  );
}

async function registerMatrixUser(username: string, token: string): Promise<MatrixUser> {
  const registration = {
    username,
    password: `${username}-system-test-password`
  };
  const initialResponse = await fetch(`${homeserverUrl}/_matrix/client/v3/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(registration)
  });
  if (initialResponse.status !== 401) {
    throw new Error(
      `Matrix registration challenge failed: ${initialResponse.status} ${await initialResponse.text()}`
    );
  }
  const challenge = (await initialResponse.json()) as {
    flows?: Array<{ stages?: string[] }>;
    session?: string;
  };
  if (!challenge.flows?.some((flow) => flow.stages?.includes("m.login.registration_token"))) {
    throw new Error(
      `Matrix registration challenge did not offer the expected token stage: ${JSON.stringify(challenge.flows)}`
    );
  }
  if (!challenge.session) {
    throw new Error("Matrix registration challenge did not include a session.");
  }
  const registered = await matrixPost<{ access_token: string; user_id: string }>(
    undefined,
    "/_matrix/client/v3/register",
    {
      ...registration,
      auth: { type: "m.login.registration_token", token, session: challenge.session }
    }
  );
  return { accessToken: registered.access_token, userId: registered.user_id };
}

async function initialRegistrationToken(): Promise<string> {
  let token: string | undefined;
  await eventually(
    async () => {
      const { stdout, stderr } = await execFileAsync(
        "docker",
        [
          "compose",
          "-p",
          projectName,
          "-f",
          composeFile,
          "logs",
          "--no-color",
          "matrix-homeserver"
        ],
        {
          cwd: new URL("../../..", import.meta.url),
          env: { ...process.env, ...composeEnvironment() }
        }
      );
      const logs = `${stdout}\n${stderr}`.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
      token =
        /using registration token\s+([^\s.]+)/i.exec(logs)?.[1] ??
        /registration token\s*(?:is|:|=)?\s*([^\s.]+)/i.exec(logs)?.[1];
      expect(token).toBeDefined();
    },
    { description: "Matrix homeserver bootstrap registration token", timeoutMs: 30_000 }
  );
  if (!token) {
    throw new Error("Matrix homeserver did not emit its initial registration token.");
  }
  return token;
}

async function matrixGet<T>(accessToken: string, path: string): Promise<T> {
  return matrixRequest<T>(accessToken, path, undefined, "GET");
}

async function matrixPost<T>(
  accessToken: string | undefined,
  path: string,
  body: unknown
): Promise<T> {
  return matrixRequest<T>(accessToken, path, body, "POST");
}

async function matrixPut<T>(accessToken: string, path: string, body: unknown): Promise<T> {
  return matrixRequest<T>(accessToken, path, body, "PUT");
}

async function matrixUpload(
  accessToken: string,
  filename: string,
  mediaType: string,
  bytes: Uint8Array
): Promise<string> {
  const response = await fetch(
    `${homeserverUrl}/_matrix/media/v3/upload?filename=${encodeURIComponent(filename)}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": mediaType },
      body: bytes
    }
  );
  if (!response.ok)
    throw new Error(`Matrix media upload failed: ${response.status} ${await response.text()}`);
  const result = (await response.json()) as { content_uri?: unknown };
  if (typeof result.content_uri !== "string")
    throw new Error("Matrix media upload returned no content URI.");
  return result.content_uri;
}

async function matrixRequest<T>(
  accessToken: string | undefined,
  path: string,
  body: unknown,
  method: "GET" | "POST" | "PUT"
): Promise<T> {
  const response = await fetch(`${homeserverUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!response.ok) {
    throw new Error(`Matrix ${method} ${path} failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

interface MatrixUser {
  accessToken: string;
  userId: string;
}

interface MatrixSyncResponse {
  rooms?: {
    join?: Record<string, { timeline?: { events?: Array<Record<string, unknown>> } }>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasMatrixMessage(
  events: Array<Record<string, unknown>>,
  sender: string,
  msgtype: string,
  body: string
): boolean {
  return events.some(
    (event) =>
      event.type === "m.room.message" &&
      event.sender === sender &&
      isRecord(event.content) &&
      event.content.msgtype === msgtype &&
      event.content.body === body
  );
}

function hasMatrixAudioMessage(events: Array<Record<string, unknown>>, sender: string): boolean {
  return events.some((event) => {
    if (event.type !== "m.room.message" || event.sender !== sender || !isRecord(event.content)) {
      return false;
    }
    const info = event.content.info;
    return (
      event.content.msgtype === "m.audio" &&
      event.content.body === "reply.ogg" &&
      typeof event.content.url === "string" &&
      event.content.url.startsWith("mxc://") &&
      isRecord(info) &&
      info.mimetype === "audio/ogg" &&
      info.size === 19 &&
      info.duration === 1000
    );
  });
}

function hasMatrixFileMessage(events: Array<Record<string, unknown>>, sender: string): boolean {
  return events.some((event) => {
    if (event.type !== "m.room.message" || event.sender !== sender || !isRecord(event.content))
      return false;
    const info = event.content.info;
    return (
      event.content.msgtype === "m.file" &&
      event.content.body === "reply.txt" &&
      typeof event.content.url === "string" &&
      event.content.url.startsWith("mxc://") &&
      isRecord(info) &&
      info.mimetype === "text/plain" &&
      info.size === 21
    );
  });
}

function matrixTextEvent(eventId: string, body: string) {
  return {
    type: "m.room.message",
    event_id: eventId,
    room_id: "!brain:example",
    sender: "@owner:example",
    origin_server_ts: Date.parse("2026-07-18T12:00:00.000Z"),
    content: {
      msgtype: "m.text",
      body
    }
  };
}
