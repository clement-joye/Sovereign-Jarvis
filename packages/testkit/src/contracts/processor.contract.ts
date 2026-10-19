import { describe, expect, it } from "vitest";

import type { MediaProcessorPort, PiRunnerPort } from "@second-brain/application";
import type { AttachmentReferenceV1, PiRunRequestV1 } from "@second-brain/contracts";

export interface PiRunnerContractSubject {
  name: string;
  create(): PiRunnerPort;
}

export function piRunnerContract(subject: PiRunnerContractSubject): void {
  describe(`${subject.name} Pi runner contract`, () => {
    it("returns a terminal result for a valid text run", async () => {
      const runner = subject.create();

      const result = await runner.run(piRunRequest());

      expect(result).toMatchObject({
        schemaVersion: 1,
        id: "pi-run-1",
        traceId: "trace-1",
        sessionId: "session-1"
      });
      expect(["completed", "cancelled", "failed", "timed_out"]).toContain(result.status);
    });

    it("accepts cancellation requests idempotently", async () => {
      const runner = subject.create();

      await expect(runner.cancel("pi-run-1")).resolves.toBeUndefined();
      await expect(runner.cancel("pi-run-1")).resolves.toBeUndefined();
    });
  });
}

export interface MediaProcessorContractSubject {
  name: string;
  create(): MediaProcessorPort;
}

export function mediaProcessorContract(subject: MediaProcessorContractSubject): void {
  describe(`${subject.name} media processor contract`, () => {
    it("prepares images without losing attachment identity metadata", async () => {
      const processor = subject.create();

      await expect(
        processor.prepareImage(attachment({ mediaType: "image/jpeg" }))
      ).resolves.toMatchObject({
        schemaVersion: 1,
        id: "attachment-1",
        purpose: "prepared",
        mediaType: "image/jpeg"
      });
    });

    it("transcribes audio and synthesizes outbound audio references", async () => {
      const processor = subject.create();

      const transcript = await processor.transcribeAudio(attachment({ mediaType: "audio/ogg" }));
      const audio = await processor.synthesizeAudio("hello");

      expect(transcript.text.length).toBeGreaterThan(0);
      expect(audio).toMatchObject({
        schemaVersion: 1,
        purpose: "outbound"
      });
      expect(audio.mediaType.startsWith("audio/")).toBe(true);
      expect(audio.storageKey.length).toBeGreaterThan(0);
    });
  });
}

function piRunRequest(overrides: Partial<PiRunRequestV1> = {}): PiRunRequestV1 {
  return {
    schemaVersion: 1,
    id: "pi-run-1",
    traceId: "trace-1",
    sessionId: "session-1",
    inputText: "hello",
    images: [],
    sourceReferences: [],
    timeoutSeconds: 600,
    priority: "interactive",
    ...overrides
  };
}

function attachment(overrides: Partial<AttachmentReferenceV1> = {}): AttachmentReferenceV1 {
  return {
    schemaVersion: 1,
    id: "attachment-1",
    purpose: "inbound",
    mediaType: "image/jpeg",
    sizeBytes: 1024,
    sha256: "0".repeat(64),
    storageKey: "inbound/attachment-1",
    ...overrides
  };
}
