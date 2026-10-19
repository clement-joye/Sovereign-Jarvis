import { pathToFileURL } from "node:url";

import {
  loadBaseServiceConfig,
  loadSchedulerRuntimeConfig,
  SingleFlight
} from "@second-brain/configuration";
import { createStructuredLogger } from "@second-brain/observability";

const config = loadBaseServiceConfig("scheduler");
const runtimeConfig = loadSchedulerRuntimeConfig();
const controlBaseUrl = runtimeConfig.controlBaseUrl.replace(/\/$/, "");
const poller = new SingleFlight<void>();
const logger = createStructuredLogger({
  service: config.serviceName,
  environment: config.environment,
  version: "0.0.0"
});

async function claimDueSchedules(): Promise<unknown> {
  const response = await fetch(`${controlBaseUrl}/v1/schedules/claim-due`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ limit: runtimeConfig.claimLimit })
  });

  if (!response.ok) {
    throw new Error(`Schedule claim failed: ${response.status}`);
  }

  return response.json();
}

async function pollOnce(): Promise<void> {
  try {
    const claimed = await claimDueSchedules();
    logger.info("scheduler poll completed", { claimed });
  } catch {
    logger.error("scheduler poll failed", { error_code: "control_plane_unavailable" });
  }
}

logger.info("scheduler started", {
  controlBaseUrl,
  intervalMs: runtimeConfig.intervalMs,
  claimLimit: runtimeConfig.claimLimit
});

if (runtimeConfig.runOnStart) {
  await poller.run(pollOnce);
}

const interval = setInterval(() => {
  void poller.run(pollOnce);
}, runtimeConfig.intervalMs);

function beginShutdown(signal: "SIGINT" | "SIGTERM"): void {
  clearInterval(interval);
  logger.info("scheduler shutting down", { signal });
  void poller.waitForIdle(30_000).then(() => {
    logger.info("scheduler stopped", { signal });
  });
}

if (!isEntrypoint()) {
  // Module imported for tests; do not start polling or trap signals.
} else {
  process.once("SIGINT", () => beginShutdown("SIGINT"));
  process.once("SIGTERM", () => beginShutdown("SIGTERM"));
}

function isEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}
