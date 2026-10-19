/**
 * Compatibility facade for tests. Reusable in-memory adapters live in their
 * own package so production applications never depend on testkit.
 */
export * from "@second-brain/memory-adapter";

import type { MediaProcessorPort, PiRunnerPort } from "@second-brain/application";
import type { AttachmentReferenceV1 } from "@second-brain/contracts";
import type { ClockPort, IdGeneratorPort } from "@second-brain/domain";

export class FakeClock implements ClockPort {
  private current: Date;

  constructor(initial: string | Date) {
    this.current = new Date(initial);
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): Date {
    this.current = new Date(this.current.getTime() + ms);
    return this.now();
  }
}

export class SequentialIdGenerator implements IdGeneratorPort {
  private next = 1;

  nextId(prefix: string): string {
    const id = `${prefix}-${this.next}`;
    this.next += 1;
    return id;
  }
}

export class DeterministicPiRunner implements PiRunnerPort {
  readonly requests: Array<Parameters<PiRunnerPort["run"]>[0]> = [];
  nextText = "pi response";
  nextStatus: Awaited<ReturnType<PiRunnerPort["run"]>>["status"] = "completed";

  async run(request: Parameters<PiRunnerPort["run"]>[0]): ReturnType<PiRunnerPort["run"]> {
    this.requests.push(request);
    const now = new Date().toISOString();
    return {
      schemaVersion: 1,
      id: request.id,
      traceId: request.traceId,
      sessionId: request.sessionId,
      status: this.nextStatus,
      ...(this.nextStatus === "completed" ? { text: this.nextText } : {}),
      generatedFiles: [],
      startedAt: now,
      finishedAt: now,
      ...(this.nextStatus === "failed"
        ? {
            error: {
              schemaVersion: 1,
              code: "fake_failure",
              category: "internal",
              message: "Fake Pi failure.",
              retryable: false
            }
          }
        : {})
    };
  }

  async cancel(): Promise<void> {
    return undefined;
  }

  async cancelSession(): Promise<void> {
    return undefined;
  }
}

export class DeterministicMediaProcessor implements MediaProcessorPort {
  async transcribeAudio(
    attachment: AttachmentReferenceV1
  ): Promise<{ text: string; language?: string }> {
    return { text: `transcribed:${attachment.id}`, language: "en" };
  }

  async prepareImage(attachment: AttachmentReferenceV1): Promise<AttachmentReferenceV1> {
    return { ...attachment, purpose: "prepared" };
  }

  async synthesizeAudio(text: string): Promise<AttachmentReferenceV1> {
    return {
      schemaVersion: 1,
      id: `tts-${text.length}`,
      purpose: "outbound",
      mediaType: "audio/wav",
      sizeBytes: text.length,
      sha256: "0".repeat(64),
      storageKey: `tts/${text.length}.wav`
    };
  }
}

export function matrixTextEvent(input: {
  eventId?: string;
  roomId?: string;
  sender?: string;
  body?: string;
  originServerTs?: number;
  relatesTo?: Record<string, unknown>;
  newContent?: Record<string, unknown>;
  threadRootExternalEventId?: string;
}) {
  return {
    type: "m.room.message",
    event_id: input.eventId ?? "$event-1",
    room_id: input.roomId ?? "!brain:example",
    sender: input.sender ?? "@owner:example",
    origin_server_ts: input.originServerTs ?? Date.parse("2026-07-17T15:00:00.000Z"),
    content: {
      msgtype: "m.text",
      body: input.body ?? "hello",
      ...(input.relatesTo ? { "m.relates_to": input.relatesTo } : {}),
      ...(input.newContent ? { "m.new_content": input.newContent } : {}),
      ...(input.threadRootExternalEventId
        ? {
            "m.relates_to": {
              ...(input.relatesTo ?? {}),
              rel_type: "m.thread",
              event_id: input.threadRootExternalEventId
            }
          }
        : {})
    }
  };
}
