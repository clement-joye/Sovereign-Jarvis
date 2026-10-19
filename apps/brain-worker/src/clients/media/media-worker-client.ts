import type { MediaProcessorPort } from "@second-brain/application";
import {
  AttachmentReferenceV1Schema,
  MediaSpeechResponseV1Schema,
  MediaTranscriptionResponseV1Schema,
  type AttachmentReferenceV1
} from "@second-brain/contracts";

import { requestJson } from "../../http/http-json-client.js";
import { mapMediaWorkerError } from "../../media-worker-error.js";

export class HttpMediaProcessor implements MediaProcessorPort {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number | undefined = undefined
  ) {}

  async transcribeAudio(
    attachment: AttachmentReferenceV1
  ): Promise<{ text: string; language?: string }> {
    const result = await this.post("/v1/media/transcriptions", attachment, (body) =>
      MediaTranscriptionResponseV1Schema.parse(body)
    );
    return {
      text: result.text,
      ...(result.language !== undefined ? { language: result.language } : {})
    };
  }

  prepareImage(attachment: AttachmentReferenceV1): Promise<AttachmentReferenceV1> {
    return this.post("/v1/media/images/prepare", attachment, (body) =>
      AttachmentReferenceV1Schema.parse(body)
    );
  }

  async synthesizeAudio(text: string): Promise<AttachmentReferenceV1> {
    const result = await this.post("/v1/media/speech", { text }, (body) =>
      MediaSpeechResponseV1Schema.parse(body)
    );
    return result.audio;
  }

  private async post<T>(path: string, body: unknown, parse: (response: unknown) => T): Promise<T> {
    try {
      return await requestJson({
        baseUrl: this.baseUrl,
        path,
        method: "POST",
        body,
        ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
        parse
      });
    } catch (error) {
      throw mapMediaWorkerError(error);
    }
  }
}
