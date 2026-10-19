import { rm } from "node:fs/promises";

import { structuredError } from "@second-brain/application";
import {
  minimumTokenBudget,
  type PiRunRequestV1,
  type PiRunResultV1
} from "@second-brain/contracts";
import type { AgentCatalog } from "@second-brain/domain";

import type { PiModelRunInput } from "../providers/model-provider.js";
import { PiAttachmentExchange } from "./pi-attachment-exchange.js";
import { PiPromptAssembler } from "./pi-prompt-assembler.js";
import { PiRunBudgetMeter } from "./pi-run-budget.js";
import { PiRunOutputCollector } from "./pi-run-output-collector.js";
import type { CreatedPiSession } from "../sessions/pi-session-factory.js";

export interface PiRunExecutorOptions {
  agentCatalog: AgentCatalog;
  workspaceRoot: string;
  attachmentRoot?: string | undefined;
}

/** Owns the model event loop, run budgets, attachments, cancellation, and cleanup. */
export class PiRunExecutor {
  private readonly attachments: PiAttachmentExchange;
  private readonly prompts = new PiPromptAssembler();

  constructor(private readonly options: PiRunExecutorOptions) {
    this.attachments = new PiAttachmentExchange(options);
  }

  failure(
    request: PiRunRequestV1,
    startedAt: string,
    error: unknown,
    toolEvents: string[]
  ): PiRunResultV1 {
    const result = failedResult(
      request,
      startedAt,
      error instanceof Error ? error.message : "Unknown Pi coding-agent error."
    );
    logPiOutput(result, toolEvents);
    return result;
  }

  async execute(
    input: PiModelRunInput,
    created: CreatedPiSession,
    startedAt: string,
    toolEvents: string[]
  ): Promise<PiRunResultV1> {
    const { session, sessionDirectory, model } = created;
    const agent = this.options.agentCatalog.require(
      input.request.agentId ?? this.options.agentCatalog.defaultAgentId()
    );
    const tokenBudget = minimumTokenBudget(input.request.tokenBudget, agent.tokenBudget);
    const meter = new PiRunBudgetMeter(tokenBudget, input.request.maxOutputBytes ?? 100_000);
    const output = new PiRunOutputCollector(session, meter);
    const unsubscribe = output.subscribe();
    const abort = () => session.agent.abort();
    input.signal.addEventListener("abort", abort, { once: true });

    try {
      if (input.signal.aborted) abort();
      const images = await this.attachments.inputImages(input.request.images);
      const modelSupportsImages = model.input.includes("image");
      console.info(
        JSON.stringify({
          service: "pi-runner",
          event: "pi-input-ready",
          runId: input.request.id,
          traceId: input.request.traceId,
          sessionId: input.request.sessionId,
          agentId: input.request.agentId,
          modelProviderId: model.provider,
          modelId: model.id,
          modelSupportsImages,
          requestedImageCount: input.request.images.length,
          loadedImageCount: images.length,
          attachmentCount: input.request.attachments?.length ?? 0,
          images: input.request.images.map((image) => ({
            id: image.id,
            mediaType: image.mediaType,
            sizeBytes: image.sizeBytes
          }))
        })
      );
      if (images.length > 0 && !modelSupportsImages) {
        throw new Error(
          `Selected model ${model.provider}/${model.id} is not configured for image input.`
        );
      }
      const documents = await this.attachments.documentText(input.request.attachments ?? []);
      const prompt = this.prompts.userPrompt(input.request.inputText, documents, input.request.id);
      await session.prompt(prompt, images.length > 0 ? { images } : undefined);
      if (output.budgetError) throw output.budgetError;
      const error = session.agent.state.errorMessage;
      if (error) return this.failure(input.request, startedAt, new Error(error), toolEvents);
      const result = await this.completedResult(input, startedAt, output);
      logPiOutput(result, toolEvents);
      return result;
    } catch (error) {
      return this.failure(input.request, startedAt, error, toolEvents);
    } finally {
      input.signal.removeEventListener("abort", abort);
      unsubscribe();
      session.dispose();
      if (input.request.sessionPersistence === "ephemeral") {
        await rm(sessionDirectory, { recursive: true, force: true });
      }
    }
  }

  private async completedResult(
    input: PiModelRunInput,
    startedAt: string,
    output: PiRunOutputCollector
  ): Promise<PiRunResultV1> {
    return {
      schemaVersion: 1,
      id: input.request.id,
      traceId: input.request.traceId,
      sessionId: input.request.sessionId,
      status: input.signal.aborted ? "cancelled" : "completed",
      ...(output.text ? { text: output.text } : {}),
      generatedFiles: await this.attachments.collectGeneratedFiles(input.request.id, output.meter),
      startedAt,
      finishedAt: new Date().toISOString()
    };
  }
}

function logPiOutput(result: PiRunResultV1, toolEvents: string[]): void {
  console.info(
    JSON.stringify({
      service: "pi-runner",
      event: "pi-output",
      runId: result.id,
      traceId: result.traceId,
      sessionId: result.sessionId,
      status: result.status,
      scheduleToolEvents: toolEvents,
      ...(result.text !== undefined ? { text: result.text } : {}),
      ...(result.error ? { error: result.error.message } : {})
    })
  );
}

function failedResult(request: PiRunRequestV1, startedAt: string, message: string): PiRunResultV1 {
  return {
    schemaVersion: 1,
    id: request.id,
    traceId: request.traceId,
    sessionId: request.sessionId,
    status: "failed",
    generatedFiles: [],
    error: structuredError({
      code: "pi_coding_agent_error",
      category: "dependency",
      message,
      retryable: true
    }),
    startedAt,
    finishedAt: new Date().toISOString()
  };
}
