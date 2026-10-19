import type { PiRunRequestV1, PiRunResultV1 } from "@second-brain/contracts";

import type { ActiveCatalogDigestPort, PiRunnerPort } from "../../ports.js";
import { TerminalWorkerError } from "../../workers/worker-errors.js";

/** Adds the process's immutable catalog identity to every Pi execution request. */
export class CatalogDigestPiRunner implements PiRunnerPort {
  constructor(
    private readonly delegate: PiRunnerPort,
    private readonly activeCatalog: ActiveCatalogDigestPort
  ) {}

  async run(request: PiRunRequestV1): Promise<PiRunResultV1> {
    if (
      request.catalogDigest !== undefined &&
      request.catalogDigest !== this.activeCatalog.catalogDigest
    ) {
      throw new TerminalWorkerError(
        `Pi request catalog digest ${request.catalogDigest} does not match active catalog digest ${this.activeCatalog.catalogDigest}.`
      );
    }
    return this.delegate.run({
      ...request,
      catalogDigest: this.activeCatalog.catalogDigest
    });
  }

  cancel(runId: string): Promise<void> {
    return this.delegate.cancel(runId);
  }

  cancelSession(sessionId: string): Promise<void> {
    return this.delegate.cancelSession(sessionId);
  }
}
