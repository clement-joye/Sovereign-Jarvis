const gatewayDiagnosticMessages = new Set(["Matrix inbound event failed", "Matrix sync failed"]);
const safeGatewayDiagnosticFields = [
  "timestamp",
  "time",
  "service",
  "level",
  "message",
  "error_code",
  "stage",
  "msgtype",
  "failure_kind"
] as const;

/** Keeps only known gateway failure records and their privacy-safe fields. */
export function sanitizeMatrixGatewayDiagnostics(output: string): {
  records: string[];
  totalRecords: number;
} {
  const records: string[] = [];
  let totalRecords = 0;
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed) || !isRecord(parsed.data)) continue;
      if (typeof parsed.message !== "string" || !gatewayDiagnosticMessages.has(parsed.message)) {
        continue;
      }
      const diagnostic: Record<string, unknown> = {};
      for (const field of safeGatewayDiagnosticFields) {
        const value = parsed[field] ?? parsed.data[field];
        if (typeof value === "string") diagnostic[field] = value;
      }
      totalRecords += 1;
      if (records.length < 5) records.push(JSON.stringify(diagnostic));
    } catch {
      // Container output can include unrelated non-JSON lines; omit them.
    }
  }
  return { records, totalRecords };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
