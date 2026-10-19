import type { AttachmentReferenceV1, PiRunRequestV1, PiRunResultV1 } from "@second-brain/contracts";
import { structuredError } from "@second-brain/application";

import type { PiSessionRecord } from "../sessions/session-store.js";

export interface PiModelRunInput {
  request: PiRunRequestV1;
  session: PiSessionRecord;
  signal: AbortSignal;
}

export interface PiModelProvider {
  run(input: PiModelRunInput): Promise<PiRunResultV1>;
}

export class DeterministicPiModelProvider implements PiModelProvider {
  async run(input: PiModelRunInput): Promise<PiRunResultV1> {
    const startedAt = new Date().toISOString();

    if (input.request.inputText.includes("__delay__")) {
      await waitUntilAborted(input.signal);
    }

    if (input.signal.aborted) {
      return result(input.request, startedAt, {
        status: "cancelled",
        text: "fake:cancelled"
      });
    }

    if (input.request.inputText.includes("__retryable_failure__")) {
      return result(input.request, startedAt, {
        status: "failed",
        error: structuredError({
          code: "fake_retryable_failure",
          category: "dependency",
          message: "Deterministic fake retryable failure.",
          retryable: true
        })
      });
    }

    if (input.request.inputText.includes("__terminal_failure__")) {
      return result(input.request, startedAt, {
        status: "failed",
        error: structuredError({
          code: "fake_terminal_failure",
          category: "validation",
          message: "Deterministic fake terminal failure.",
          retryable: false
        })
      });
    }

    if (input.request.inputText.includes("__generated_file__")) {
      return result(input.request, startedAt, {
        status: "completed",
        text: "fake:generated-file",
        generatedFiles: [generatedFile(input.request.id)]
      });
    }

    if (input.request.inputText.includes("__schedule_tool__")) {
      return result(input.request, startedAt, {
        status: "completed",
        text: "fake:tool:schedule_create"
      });
    }

    if (input.request.images.length > 0) {
      return result(input.request, startedAt, {
        status: "completed",
        text: `fake:image:${input.request.images.length}:${input.request.inputText}`
      });
    }

    if (input.request.inputText.includes("__chunks__")) {
      return result(input.request, startedAt, {
        status: "completed",
        text: "fake:chunk-1 chunk-2 chunk-3"
      });
    }

    return result(input.request, startedAt, {
      status: "completed",
      text: `fake:${input.session.sessionId}:${input.request.inputText}`
    });
  }
}

function result(
  request: PiRunRequestV1,
  startedAt: string,
  overrides: Partial<PiRunResultV1>
): PiRunResultV1 {
  return {
    schemaVersion: 1,
    id: request.id,
    traceId: request.traceId,
    sessionId: request.sessionId,
    status: "completed",
    generatedFiles: [],
    startedAt,
    finishedAt: new Date().toISOString(),
    ...overrides
  };
}

function generatedFile(runId: string): AttachmentReferenceV1 {
  return {
    schemaVersion: 1,
    id: `${runId}-generated-1`,
    purpose: "outbound",
    mediaType: "text/plain",
    sizeBytes: 11,
    sha256: "a".repeat(64),
    storageKey: `pi-generated/${runId}/fixture.txt`,
    originalFilename: "fixture.txt"
  };
}

async function waitUntilAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
