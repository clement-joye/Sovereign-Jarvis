import { pathToFileURL } from "node:url";

import {
  createBrainControlComposition,
  type BrainControlCompositionOptions
} from "./composition/composition.js";

export {
  createBrainControlComposition,
  type BrainControlComposition,
  type BrainControlCompositionOptions
} from "./composition/composition.js";
export { createBrainControlHttpServer, type BrainControlHttpServerOptions } from "./server.js";

export async function createBrainControlServer(options: BrainControlCompositionOptions = {}) {
  const composition = await createBrainControlComposition(options);
  return composition.createServer();
}

export async function startBrainControlFromEnvironment(
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  if (!env.RUN_AUTHORIZATION_SECRET) {
    throw new Error("RUN_AUTHORIZATION_SECRET is required.");
  }
  const composition = await createBrainControlComposition({ env });
  if (!composition.catalogDigest) {
    throw new Error("PLATFORM_CATALOG_PATH is required.");
  }
  const server = composition.createServer();
  server.listen(composition.port, () => {
    composition.logger.info("Brain Control started", {
      port: composition.port,
      storageMode: composition.storageMode,
      catalogDigest: composition.catalogDigest,
      policyDigest: composition.policyDigest
    });
  });
}

if (isEntrypoint()) {
  await startBrainControlFromEnvironment();
}

function isEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}
