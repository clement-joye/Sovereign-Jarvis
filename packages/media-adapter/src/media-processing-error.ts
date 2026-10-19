export class MediaProcessingError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidMediaError extends MediaProcessingError {
  constructor(message: string, code = "invalid_media") {
    super(message, code, false);
  }
}

export class MissingAttachmentError extends MediaProcessingError {
  constructor(message = "The requested media attachment is unavailable.") {
    super(message, "missing_attachment", false);
  }
}

export class SttUnavailableError extends MediaProcessingError {
  constructor(message = "Speech-to-text is temporarily unavailable.", code = "stt_unavailable") {
    super(message, code, true);
  }
}
