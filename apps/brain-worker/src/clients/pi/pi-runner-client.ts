import type { PiRunnerPort } from "@second-brain/application";
import {
  PiRunCancelResponseV1Schema,
  PiRunResultV1Schema,
  PiSessionCancelResponseV1Schema,
  type PiRunRequestV1,
  type PiRunResultV1
} from "@second-brain/contracts";

import { requestJson } from "../../http/http-json-client.js";

export class HttpPiRunner implements PiRunnerPort {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number | undefined = undefined
  ) {}

  run(request: PiRunRequestV1): Promise<PiRunResultV1> {
    return this.post("/v1/pi-runs", request, (body) => PiRunResultV1Schema.parse(body));
  }

  async cancel(runId: string): Promise<void> {
    await this.post(`/v1/pi-runs/${encodeURIComponent(runId)}/cancel`, {}, (body) =>
      PiRunCancelResponseV1Schema.parse(body)
    );
  }

  async cancelSession(sessionId: string): Promise<void> {
    await this.post(`/v1/pi-sessions/${encodeURIComponent(sessionId)}/cancel`, {}, (body) =>
      PiSessionCancelResponseV1Schema.parse(body)
    );
  }

  private async post<T>(path: string, body: unknown, parse: (response: unknown) => T): Promise<T> {
    return requestJson({
      baseUrl: this.baseUrl,
      path,
      method: "POST",
      body,
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      parse
    });
  }
}
