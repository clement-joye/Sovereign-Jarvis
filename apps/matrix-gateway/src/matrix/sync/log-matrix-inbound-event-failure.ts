import type { StructuredLogger } from "@second-brain/observability";

export function logMatrixInboundEventFailure(
  logger: StructuredLogger,
  failure: { stage: "prepare" | "process"; msgtype?: string }
): void {
  const { stage, msgtype } = failure;
  logger.error("Matrix inbound event failed", {
    error_code: stage === "prepare" ? "matrix_event_prepare_failed" : "matrix_event_process_failed",
    stage,
    ...(msgtype ? { msgtype } : {})
  });
}
