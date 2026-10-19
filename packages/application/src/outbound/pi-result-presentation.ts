import type { AttachmentReferenceV1, PiRunResultV1 } from "@second-brain/contracts";

/** User-facing presentation rules shared by interactive and scheduled Pi runs. */
export function piResultText(result: Pick<PiRunResultV1, "status" | "text" | "error">): string {
  if (result.status === "completed") {
    return result.text?.trim() || "Pi run completed with no text response.";
  }
  if (result.status === "cancelled") {
    return "Pi run was cancelled.";
  }
  if (result.status === "timed_out") {
    return "Pi run timed out.";
  }
  return result.error?.message || "Pi run failed.";
}

export function generatedImages(
  result: Pick<PiRunResultV1, "generatedFiles">
): AttachmentReferenceV1[] {
  return result.generatedFiles.filter((attachment) => attachment.mediaType.startsWith("image/"));
}

/** Non-image generated artifacts are delivered as Matrix m.file messages. */
export function generatedFiles(
  result: Pick<PiRunResultV1, "generatedFiles">
): AttachmentReferenceV1[] {
  return result.generatedFiles.filter((attachment) => !attachment.mediaType.startsWith("image/"));
}
