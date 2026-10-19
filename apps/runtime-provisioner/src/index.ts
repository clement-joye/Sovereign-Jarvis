import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";

import {
  createSecurityEventEmitter,
  createStructuredLogger,
  writeJsonBody
} from "@second-brain/observability";
import { loadPlatformCatalogPath } from "@second-brain/configuration";
import {
  DockerCliContainerEngine,
  HttpWorkspaceRuntimeExecutor,
  RuntimeProvisionerService
} from "@second-brain/pi-adapter";
import { PrivilegedBrokerRegistry } from "@second-brain/application";
import { createInstalledPrivilegedBrokerHandlers } from "@second-brain/installed-plugins";
import {
  createPlatformAgentCatalog,
  readPlatformCatalogV2Artifact
} from "@second-brain/platform-catalog";

import { loadHostLocalRuntimeTemplateCatalog } from "./host-local-releases.js";
import { handleRuntimeRoute, type RuntimeProvisionerServerDependencies } from "./runtime-routes.js";

export type { RuntimeProvisionerServerDependencies } from "./runtime-routes.js";
export function createRuntimeProvisionerServer(
  input?: RuntimeProvisionerServerDependencies
): Server {
  return createServer((request, response) => {
    void handleRuntimeRoute(request, response, input).catch((error: unknown) => {
      writeJsonBody(response, 500, {
        error: error instanceof Error ? error.message : "internal_error"
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.RUNTIME_PROVISIONER_TOKEN;
  if (!token) throw new Error("RUNTIME_PROVISIONER_TOKEN is required.");
  const catalogHostPath = process.env.PLATFORM_CATALOG_HOST_PATH;
  if (!catalogHostPath) throw new Error("PLATFORM_CATALOG_HOST_PATH is required.");
  const runtimeProfileHostPath = process.env.RUNTIME_PROFILE_HOST_PATH;
  if (!runtimeProfileHostPath) throw new Error("RUNTIME_PROFILE_HOST_PATH is required.");
  const logger = createStructuredLogger({
    service: "runtime-provisioner",
    environment: process.env.NODE_ENV ?? "development",
    version: "0.0.0"
  });
  const platformCatalog = await readPlatformCatalogV2Artifact(loadPlatformCatalogPath(), {
    securityEvents: createSecurityEventEmitter(logger)
  });
  const agentCatalog = createPlatformAgentCatalog(platformCatalog.catalog);
  const provisioner = new RuntimeProvisionerService({
    engine: new DockerCliContainerEngine(
      undefined,
      undefined,
      catalogHostPath,
      runtimeProfileHostPath
    ),
    templates: loadHostLocalRuntimeTemplateCatalog(
      process.env,
      agentCatalog,
      platformCatalog.catalog.resourceDigest
    ),
    executor: new HttpWorkspaceRuntimeExecutor(agentCatalog.digest, fetch, {
      ...(platformCatalog.catalog.policyDigest
        ? { policyDigest: platformCatalog.catalog.policyDigest }
        : {}),
      ...(platformCatalog.catalog.resourceDigest
        ? { resourceDigest: platformCatalog.catalog.resourceDigest }
        : {}),
      runtimeImageIds: Object.fromEntries(
        platformCatalog.catalog.runtimeClasses.map((runtimeClass) => [
          runtimeClass.id,
          runtimeClass.image
        ])
      )
    }),
    agentCatalog,
    runtimePolicies: platformCatalog.catalog.runtimeClasses,
    ...(platformCatalog.catalog.policyDigest && platformCatalog.catalog.resourceDigest
      ? {
          executionIdentity: {
            platformPolicyDigest: platformCatalog.catalog.policyDigest,
            resourceDigest: platformCatalog.catalog.resourceDigest
          }
        }
      : {})
  });
  const privilegedHandlers = createInstalledPrivilegedBrokerHandlers({
    environment: process.env,
    executeRuntimeAction: (workspaceId, agentId, operationId, parameters) =>
      provisioner.executeRuntimeAction(workspaceId, agentId, operationId, parameters)
  });
  const brokerOperations = new PrivilegedBrokerRegistry(privilegedHandlers);
  console.info(
    JSON.stringify({
      service: "runtime-provisioner",
      event: "plugin-broker-capabilities",
      registeredHandlers: privilegedHandlers.map(({ implementationId }) => implementationId)
    })
  );
  createRuntimeProvisionerServer({
    provisioner,
    token,
    catalogDigest: agentCatalog.digest,
    ...(platformCatalog.catalog.policyDigest && platformCatalog.catalog.resourceDigest
      ? {
          executionIdentity: {
            platformPolicyDigest: platformCatalog.catalog.policyDigest,
            resourceDigest: platformCatalog.catalog.resourceDigest
          }
        }
      : {}),
    brokerOperations
  }).listen(Number(process.env.RUNTIME_PROVISIONER_PORT ?? 3040));
}
