import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import type { PiRunRequestV1, PiRunResultV1 } from "@second-brain/contracts";

import { DeterministicPiModelProvider, type PiModelProvider } from "../providers/model-provider.js";
import { FilePiSessionStore, assertValidPiSessionId } from "../sessions/session-store.js";
import { PiRunnerService } from "./runner-service.js";

let stores: FilePiSessionStore[] = [];

afterEach(async () => {
  await Promise.all(stores.map((store) => store.destroyAllForTests()));
  stores = [];
});

describe("Pi session store", () => {
  it("rejects path traversal session ids", () => {
    expect(() => assertValidPiSessionId("session-1")).not.toThrow();
    expect(() => assertValidPiSessionId("../secret")).toThrow(/Invalid Pi session id/);
    expect(() => assertValidPiSessionId("nested/session")).toThrow(/Invalid Pi session id/);
    expect(() => assertValidPiSessionId("..")).toThrow(/Invalid Pi session id/);
  });

  it("persists created sessions and resumes them", async () => {
    const store = await createStore();
    const created = await store.create("session-a");
    const resumed = await store.resume("session-a");

    expect(resumed.sessionId).toBe(created.sessionId);
    expect(resumed.createdAt).toBe(created.createdAt);

    const raw = await readFile(join(store.sessionPath("session-a"), "session.json"), "utf8");
    expect(JSON.parse(raw)).toMatchObject({ sessionId: "session-a" });
  });

  it("closes sessions", async () => {
    const store = await createStore();
    await store.create("session-a");
    const closed = await store.close("session-a");
    const health = await store.health("session-a");

    expect(closed.closedAt).toBeDefined();
    expect(health).toMatchObject({ sessionId: "session-a", exists: true, closed: true });
    await expect(store.resume("session-a")).rejects.toThrow(/closed/);
  });
});

describe("Pi runner service", () => {
  it("runs text input through the deterministic provider", async () => {
    const service = await createService();
    await service.createSession("chat");

    const result = await service.run(
      request({ id: "run-1", sessionId: "chat", inputText: "hello" })
    );

    expect(result).toMatchObject({
      id: "run-1",
      sessionId: "chat",
      status: "completed",
      text: "fake:chat:hello"
    });
  });

  it("serializes concurrent runs for the same session", async () => {
    const events: string[] = [];
    const provider: PiModelProvider = {
      async run(input): Promise<PiRunResultV1> {
        events.push(`start:${input.request.id}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
        events.push(`finish:${input.request.id}`);
        return {
          schemaVersion: 1,
          id: input.request.id,
          traceId: input.request.traceId,
          sessionId: input.request.sessionId,
          status: "completed",
          text: input.request.id,
          generatedFiles: [],
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString()
        };
      }
    };
    const service = await createService(provider);
    await service.createSession("chat");

    await Promise.all([
      service.run(request({ id: "run-1", sessionId: "chat", inputText: "first" })),
      service.run(request({ id: "run-2", sessionId: "chat", inputText: "second" }))
    ]);

    expect(events).toEqual(["start:run-1", "finish:run-1", "start:run-2", "finish:run-2"]);
  });

  it("cancels an active delayed run", async () => {
    const service = await createService();
    await service.createSession("chat");

    const pending = service.run(
      request({ id: "run-cancel", sessionId: "chat", inputText: "__delay__" })
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.cancel("run-cancel");

    await expect(pending).resolves.toMatchObject({ status: "cancelled" });
  });

  it("cancels an active run by session", async () => {
    const service = await createService();
    await service.createSession("chat");

    const pending = service.run(
      request({ id: "run-session-cancel", sessionId: "chat", inputText: "__delay__" })
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.cancelSession("chat");

    await expect(pending).resolves.toMatchObject({ status: "cancelled" });
  });

  it("cancels queued runs in the same session", async () => {
    const service = await createService();
    await service.createSession("chat");

    const active = service.run(
      request({ id: "run-active", sessionId: "chat", inputText: "__delay__" })
    );
    const queued = service.run(request({ id: "run-queued", sessionId: "chat", inputText: "next" }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.cancelSession("chat");

    await expect(active).resolves.toMatchObject({ status: "cancelled" });
    await expect(queued).resolves.toMatchObject({ status: "cancelled" });
  });

  it("times out an active delayed run", async () => {
    const service = await createService();
    await service.createSession("chat");

    const result = await service.run(
      request({ id: "run-timeout", sessionId: "chat", inputText: "__delay__", timeoutSeconds: 1 })
    );

    expect(result.status).toBe("timed_out");
    expect(result.error?.code).toBe("pi_run_timed_out");
  });

  it("returns deterministic fake image, tool, generated-file, and failure markers", async () => {
    const service = await createService();
    await service.createSession("chat");

    await expect(
      service.run(request({ id: "image", sessionId: "chat", inputText: "look", images: [image()] }))
    ).resolves.toMatchObject({ status: "completed", text: "fake:image:1:look" });

    await expect(
      service.run(request({ id: "tool", sessionId: "chat", inputText: "__schedule_tool__" }))
    ).resolves.toMatchObject({ status: "completed", text: "fake:tool:schedule_create" });

    await expect(
      service.run(request({ id: "file", sessionId: "chat", inputText: "__generated_file__" }))
    ).resolves.toMatchObject({ status: "completed", generatedFiles: [{ id: "file-generated-1" }] });

    await expect(
      service.run(request({ id: "fail", sessionId: "chat", inputText: "__retryable_failure__" }))
    ).resolves.toMatchObject({
      status: "failed",
      error: { code: "fake_retryable_failure", retryable: true }
    });
  });
});

async function createStore(): Promise<FilePiSessionStore> {
  const root = await mkdtemp(join(tmpdir(), "pi-sessions-"));
  const store = new FilePiSessionStore(root);
  stores.push(store);
  return store;
}

async function createService(provider: PiModelProvider = new DeterministicPiModelProvider()) {
  return new PiRunnerService({ sessionStore: await createStore(), modelProvider: provider });
}

function request(input: {
  id: string;
  sessionId: string;
  inputText: string;
  timeoutSeconds?: number;
  images?: PiRunRequestV1["images"];
}): PiRunRequestV1 {
  return {
    schemaVersion: 1,
    id: input.id,
    traceId: `trace-${input.id}`,
    sessionId: input.sessionId,
    inputText: input.inputText,
    images: input.images ?? [],
    sourceReferences: [],
    timeoutSeconds: input.timeoutSeconds ?? 5,
    priority: "interactive"
  };
}

function image(): PiRunRequestV1["images"][number] {
  return {
    schemaVersion: 1,
    id: "image-1",
    purpose: "prepared",
    mediaType: "image/png",
    sizeBytes: 10,
    sha256: "b".repeat(64),
    storageKey: "prepared/image-1.png",
    width: 1,
    height: 1
  };
}
