import {
  loadBaseServiceConfig,
  loadPiRunnerRuntimeConfig,
  loadPlatformCatalogPath
} from "@second-brain/configuration";
import {
  DeterministicPiModelProvider,
  FilePiSessionStore,
  PiCodingAgentModelProvider,
  createDefaultToolProviderRegistry,
  type PiModelProvider,
  PiRunnerService
} from "@second-brain/pi-adapter";
import { INSTALLED_PI_TOOL_PROVIDERS } from "@second-brain/installed-plugins";
import { createSecurityEventEmitter, createStructuredLogger } from "@second-brain/observability";
import {
  createPlatformAgentCatalog,
  readPlatformCatalogV2Artifact
} from "@second-brain/platform-catalog";

import { createPiRunnerServer } from "./server.js";

const config = loadBaseServiceConfig("pi-runner");
const runtimeConfig = loadPiRunnerRuntimeConfig();
const logger = createStructuredLogger({
  service: config.serviceName,
  environment: config.environment,
  version: "0.0.0"
});
const securityEvents = createSecurityEventEmitter(logger);
const platformCatalog = await readPlatformCatalogV2Artifact(loadPlatformCatalogPath(), {
  securityEvents
});
const agentCatalog = createPlatformAgentCatalog(platformCatalog.catalog);
const runtimePolicyDigest =
  runtimeConfig.platformPolicyDigest ?? platformCatalog.catalog.policyDigest;
const runtimeResourceDigest =
  runtimeConfig.resourceDigest ?? platformCatalog.catalog.resourceDigest;

const service = new PiRunnerService({
  sessionStore: new FilePiSessionStore(runtimeConfig.sessionRoot),
  modelProvider: createModelProvider()
});

function createModelProvider(): PiModelProvider {
  if (runtimeConfig.runnerImplementation === "deterministic") {
    return new DeterministicPiModelProvider();
  }

  return new PiCodingAgentModelProvider({
    sessionRoot: runtimeConfig.sessionRoot,
    workspaceRoot: runtimeConfig.workspaceRoot,
    attachmentRoot: process.env.PI_ATTACHMENT_ROOT ?? "/brain/exchange",
    profileRoot: runtimeConfig.profileRoot,
    resourceRoot: runtimeConfig.resourceRoot,
    modelsPath: runtimeConfig.modelsPath,
    providerId: runtimeConfig.providerId,
    modelId: runtimeConfig.modelId,
    allowedTools: runtimeConfig.allowedTools,
    brainControlUrl: runtimeConfig.brainControlUrl,
    agentCatalog,
    platformCatalog,
    ...(runtimePolicyDigest && runtimeResourceDigest && runtimeConfig.runtimeImageId
      ? {
          executionIdentity: {
            platformPolicyDigest: runtimePolicyDigest,
            resourceDigest: runtimeResourceDigest,
            runtimeImageId: runtimeConfig.runtimeImageId
          }
        }
      : {}),
    toolProviders: createDefaultToolProviderRegistry(INSTALLED_PI_TOOL_PROVIDERS, {
      securityEvents
    })
  });
}

const server = createPiRunnerServer({
  service,
  serviceName: config.serviceName,
  version: "0.0.0",
  catalogDigest: agentCatalog.digest,
  ...(runtimePolicyDigest ? { policyDigest: runtimePolicyDigest } : {}),
  ...(runtimeResourceDigest ? { resourceDigest: runtimeResourceDigest } : {}),
  ...(runtimeConfig.runtimeImageId ? { runtimeImageId: runtimeConfig.runtimeImageId } : {})
});

server.listen(runtimeConfig.port, () => {
  logger.info("Pi Runner started", {
    port: runtimeConfig.port,
    sessionRoot: runtimeConfig.sessionRoot,
    catalogDigest: agentCatalog.digest,
    brokerAuthorization: "run-scoped"
  });
});
