import { MediaProcessingError } from "@second-brain/media-adapter";

export function mediaErrorResponse(error: unknown): {
  statusCode: number;
  body: { error: string };
} {
  if (error instanceof MediaProcessingError) {
    return {
      statusCode: error.retryable ? 503 : 422,
      body: { error: error.code }
    };
  }

  return { statusCode: 500, body: { error: "media_worker_internal_error" } };
}
