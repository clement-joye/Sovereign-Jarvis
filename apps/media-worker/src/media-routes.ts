import type { IncomingMessage, ServerResponse } from "node:http";

import {
  AttachmentReferenceV1Schema,
  MediaSpeechResponseV1Schema,
  MediaTranscriptionResponseV1Schema
} from "@second-brain/contracts";

import type { MediaHttpProcessor } from "./media-server.js";

type ReadJson = (request: IncomingMessage) => Promise<unknown>;
type WriteJson = (response: ServerResponse, statusCode: number, body: unknown) => void;

export interface MediaRouteDependencies {
  processor: MediaHttpProcessor;
  readJson: ReadJson;
  writeJson: WriteJson;
}

export async function handleMediaRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dependencies: MediaRouteDependencies
): Promise<boolean> {
  const method = request.method ?? "GET";
  const { processor, readJson, writeJson } = dependencies;

  if (method === "POST" && url.pathname === "/v1/media/transcriptions") {
    const parsed = AttachmentReferenceV1Schema.safeParse(await readJson(request));
    if (!parsed.success) {
      writeJson(response, 400, { error: "invalid_attachment", issues: parsed.error.issues });
      return true;
    }
    const result = await processor.transcribeAudio(parsed.data);
    writeJson(response, 200, MediaTranscriptionResponseV1Schema.strip().parse(result));
    return true;
  }

  if (method === "POST" && url.pathname === "/v1/media/images/prepare") {
    const parsed = AttachmentReferenceV1Schema.safeParse(await readJson(request));
    if (!parsed.success) {
      writeJson(response, 400, { error: "invalid_attachment", issues: parsed.error.issues });
      return true;
    }
    writeJson(response, 200, await processor.prepareImage(parsed.data));
    return true;
  }

  if (method !== "POST" || url.pathname !== "/v1/media/speech") return false;

  const body = (await readJson(request)) as { text?: unknown; voiceId?: unknown };
  if (typeof body.text !== "string") {
    writeJson(response, 400, { error: "text_required" });
    return true;
  }
  const result = await processor.synthesizeAudio({
    text: body.text,
    ...(typeof body.voiceId === "string" ? { voiceId: body.voiceId } : {})
  });
  writeJson(response, 200, MediaSpeechResponseV1Schema.strip().parse(result));
  return true;
}
