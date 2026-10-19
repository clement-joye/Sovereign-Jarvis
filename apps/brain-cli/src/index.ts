#!/usr/bin/env node
import { loadBaseServiceConfig } from "@second-brain/configuration";

import { dispatchCliCommand, type ControlApiRequestOptions } from "./commands.js";

const config = loadBaseServiceConfig("brain-cli");
const controlBaseUrl = (process.env.BRAIN_CONTROL_URL ?? "http://localhost:3000").replace(
  /\/$/,
  ""
);
const args = process.argv.slice(2);

try {
  const result = await dispatchCliCommand(args, { request });
  console.log(JSON.stringify({ service: config.serviceName, ...result }, null, 2));
} catch (error) {
  console.error(
    JSON.stringify(
      {
        service: config.serviceName,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown brainctl error."
      },
      null,
      2
    )
  );
  process.exitCode = 1;
}

async function request(path: string, options: ControlApiRequestOptions = {}): Promise<unknown> {
  const init: RequestInit = {
    method: options.method ?? "GET",
    ...(options.body ? { headers: { "content-type": "application/json" } } : {}),
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  };
  const response = await fetch(`${controlBaseUrl}${path}`, init);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Control API ${path} failed with ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}
