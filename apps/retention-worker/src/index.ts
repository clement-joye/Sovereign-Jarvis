import { pathToFileURL } from "node:url";

import {
  loadBaseServiceConfig,
  loadRetentionWorkerRuntimeConfig,
  SingleFlight
} from "@second-brain/configuration";
import { createStructuredLogger } from "@second-brain/observability";

const config = loadBaseServiceConfig("retention-worker");
const runtimeConfig = loadRetentionWorkerRuntimeConfig();
const controlBaseUrl = runtimeConfig.controlBaseUrl.replace(/\/$/, "");
const poller = new SingleFlight<void>();
const logger = createStructuredLogger({
  service: config.serviceName,
  environment: config.environment,
  version: "0.0.0"
});

async function runRetention(): Promise<unknown> {
  const response = await fetch(`${controlBaseUrl}/v1/admin/retention/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dryRun: runtimeConfig.dryRun, limit: runtimeConfig.limit })
  });

  if (!response.ok) {
    throw new Error(`Retention run failed: ${response.status}`);
  }

  return response.json();
}

async function pollOnce(): Promise<void> {
  try {
    const result = await runRetention();
    logger.info("retention run completed", { result });
  } catch {
    logger.error("retention run failed", { error_code: "control_plane_unavailable" });
  }
}

function beginShutdown(interval: NodeJS.Timeout, signal: "SIGINT" | "SIGTERM"): void {
  clearInterval(interval);
  logger.info("retention worker shutting down", { signal });
  void poller.waitForIdle(30_000).then(() => {
    logger.info("retention worker stopped", { signal });
  });
}

if (!isEntrypoint()) {
  // Module imported for tests; do not start polling, run a retention pass,
  // or trap signals.
} else {
  logger.info("retention worker started", {
    controlBaseUrl,
    dryRun: runtimeConfig.dryRun,
    intervalMs: runtimeConfig.intervalMs,
    limit: runtimeConfig.limit
  });

  if (runtimeConfig.runOnStart) {
    await poller.run(pollOnce);
  }

  const interval = setInterval(() => {
    void poller.run(pollOnce);
  }, runtimeConfig.intervalMs);

  process.once("SIGINT", () => beginShutdown(interval, "SIGINT"));
  process.once("SIGTERM", () => beginShutdown(interval, "SIGTERM"));
}

function isEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}
