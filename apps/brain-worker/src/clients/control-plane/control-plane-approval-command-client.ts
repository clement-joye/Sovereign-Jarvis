import type { ApprovalCommand, SessionRoutingResult } from "@second-brain/application";
import type { InboundMessageV1 } from "@second-brain/contracts";

import { requestJson } from "../../http/http-json-client.js";

/** Routes owner approval decisions to the control plane that owns proposal state and execution. */
export class HttpApprovalCommandHandler {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number | undefined = undefined
  ) {}

  async handle(message: InboundMessageV1, _command: ApprovalCommand): Promise<string> {
    const result = await requestJson({
      baseUrl: this.baseUrl,
      path: "/v1/session-routing/matrix",
      method: "POST",
      body: message,
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      parse: parseApprovalResponse
    });
    return result.text;
  }
}

function parseApprovalResponse(
  value: unknown
): Extract<SessionRoutingResult, { kind: "command-response" }> {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as Record<string, unknown>).kind !== "command-response" ||
    typeof (value as Record<string, unknown>).text !== "string"
  ) {
    throw new Error("Brain Control returned an invalid approval command response.");
  }
  return value as Extract<SessionRoutingResult, { kind: "command-response" }>;
}
