import { describe, expect, it } from "vitest";

import { sanitizeMatrixGatewayDiagnostics } from "./compose-diagnostics.js";

describe("Compose gateway diagnostics", () => {
  it("retains allowlisted failure details and removes message or credential data", () => {
    const output = [
      JSON.stringify({
        service: "matrix-gateway",
        level: "error",
        message: "Matrix inbound event failed",
        data: {
          error_code: "matrix_event_prepare_failed",
          stage: "prepare",
          msgtype: "m.file",
          event_id: "$private-event",
          url: "mxc://private/media-id",
          access_token: "private-token"
        }
      }),
      JSON.stringify({ service: "matrix-gateway", message: "unrelated log", data: {} }),
      "not-json"
    ].join("\n");

    expect(sanitizeMatrixGatewayDiagnostics(output)).toEqual({
      records: [
        JSON.stringify({
          service: "matrix-gateway",
          level: "error",
          message: "Matrix inbound event failed",
          error_code: "matrix_event_prepare_failed",
          stage: "prepare",
          msgtype: "m.file"
        })
      ],
      totalRecords: 1
    });
  });

  it("limits printed records and counts all matching failures", () => {
    const repeated = JSON.stringify({
      service: "matrix-gateway",
      level: "error",
      message: "Matrix sync failed",
      data: { error_code: "matrix_sync_failed", failure_kind: "http" }
    });

    expect(sanitizeMatrixGatewayDiagnostics(Array(150).fill(repeated).join("\n"))).toMatchObject({
      records: Array(5).fill(
        JSON.stringify({
          service: "matrix-gateway",
          level: "error",
          message: "Matrix sync failed",
          error_code: "matrix_sync_failed",
          failure_kind: "http"
        })
      ),
      totalRecords: 150
    });
  });
});
