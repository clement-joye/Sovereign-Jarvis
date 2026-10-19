export type MatrixSyncFailureKind = "network" | "http" | "other";

export function matrixSyncFailureKind(error: unknown): MatrixSyncFailureKind {
  if (error instanceof TypeError) return "network";
  if (error instanceof Error && /failed: [45]\d\d$/.test(error.message)) return "http";
  return "other";
}
