import { randomUUID } from "node:crypto";

import {
  AgentCatalogCompatibilityService,
  type RoomPluginCatalog
} from "@second-brain/application";
import {
  loadBaseServiceConfig,
  loadBrainControlRuntimeConfig,
  loadPlatformCatalogPath
} from "@second-brain/configuration";
import type { AgentCatalog, IdGeneratorPort } from "@second-brain/domain";
import {
  createSecurityEventEmitter,
  createStructuredLogger,
  type SecurityEventEmitter,
  type StructuredLogger
} from "@second-brain/observability";
import {
  createPostgresPool,
  PostgresDurableAgentReferenceRepository
} from "@second-brain/postgres-adapter";
import type { PostgresQueryable } from "@second-brain/postgres-adapter";
import {
  createPlatformAgentCatalog,
  readPlatformCatalogV2Artifact
} from "@second-brain/platform-catalog";

import { assertAgentCatalogCompatibleAtStartup } from "../catalog/agent-catalog-startup.js";
import { PluginCatalog } from "../catalog/plugin-catalog.js";
import { postgresConnectionConfig } from "../storage/postgres-config.js";
import {
  resolveBrainControlStorageMode,
  type BrainControlStorageMode
} from "../storage/storage-mode.js";
import { RunAuthorizationService } from "../authorization/run-authorization.js";

export interface BrainControlBootstrapOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly agentCatalog?: AgentCatalog;
  readonly pluginCatalog?: RoomPluginCatalog;
  readonly catalogDigest?: string;
  readonly policyDigest?: string;
  readonly workerCollaborationToken?: string;
  readonly runAuthorizationSecret?: string;
}

export interface BrainControlBootstrap {
  env: NodeJS.ProcessEnv;
  config: ReturnType<typeof loadBaseServiceConfig>;
  runtimeConfig: ReturnType<typeof loadBrainControlRuntimeConfig>;
  logger: StructuredLogger;
  securityEvents: SecurityEventEmitter;
  storageMode: BrainControlStorageMode;
  loadedPlatformCatalog: Awaited<ReturnType<typeof readPlatformCatalogV2Artifact>> | undefined;
  catalogDigest: string | undefined;
  policyDigest: string | undefined;
  agentCatalog: AgentCatalog;
  pluginCatalog: RoomPluginCatalog;
  postgresPool: PostgresQueryable | undefined;
  ids: IdGeneratorPort;
  workerCollaborationToken: string | undefined;
  runAuthorizations: RunAuthorizationService | undefined;
}

class UuidIdGenerator implements IdGeneratorPort {
  nextId(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  }
}

/** Owns process bootstrap concerns that precede application service composition. */
export async function createBrainControlBootstrap(
  options: BrainControlBootstrapOptions
): Promise<BrainControlBootstrap> {
  const env = options.env ?? {};
  const config = loadBaseServiceConfig("brain-control", env);
  const runtimeConfig = loadBrainControlRuntimeConfig(env);
  const logger = createStructuredLogger({
    service: config.serviceName,
    environment: config.environment,
    version: "0.0.0"
  });
  const securityEvents = createSecurityEventEmitter(logger);
  const postgresConnection = postgresConnectionConfig(env);
  const storageMode = resolveBrainControlStorageMode({
    environment: config.environment,
    postgresConnection
  });
  const catalogs = await loadCatalogs(options, env, securityEvents);
  const postgresPool = createStoragePool(storageMode, postgresConnection);
  await assertCatalogCompatibility(
    catalogs.loadedPlatformCatalog,
    postgresPool,
    catalogs.agentCatalog
  );
  const runAuthorizationSecret = options.runAuthorizationSecret ?? env.RUN_AUTHORIZATION_SECRET;

  return {
    env,
    config,
    runtimeConfig,
    logger,
    securityEvents,
    storageMode,
    loadedPlatformCatalog: catalogs.loadedPlatformCatalog,
    catalogDigest: options.catalogDigest ?? catalogs.loadedPlatformCatalog?.catalog.digest,
    policyDigest: options.policyDigest ?? catalogs.loadedPlatformCatalog?.catalog.policyDigest,
    agentCatalog: catalogs.agentCatalog,
    pluginCatalog: catalogs.pluginCatalog,
    postgresPool,
    ids: new UuidIdGenerator(),
    workerCollaborationToken:
      options.workerCollaborationToken ?? env.BRAIN_CONTROL_WORKER_COLLABORATION_TOKEN,
    runAuthorizations: runAuthorizationSecret
      ? new RunAuthorizationService(runAuthorizationSecret, undefined, securityEvents)
      : undefined
  };
}

interface BootstrapCatalogs {
  readonly loadedPlatformCatalog:
    | Awaited<ReturnType<typeof readPlatformCatalogV2Artifact>>
    | undefined;
  readonly agentCatalog: AgentCatalog;
  readonly pluginCatalog: RoomPluginCatalog;
}

async function loadCatalogs(
  options: BrainControlBootstrapOptions,
  env: NodeJS.ProcessEnv,
  securityEvents: SecurityEventEmitter
): Promise<BootstrapCatalogs> {
  const loadedPlatformCatalog = env.PLATFORM_CATALOG_PATH
    ? await readPlatformCatalogV2Artifact(loadPlatformCatalogPath(env), { securityEvents })
    : undefined;
  return {
    loadedPlatformCatalog,
    agentCatalog: loadedPlatformCatalog
      ? createPlatformAgentCatalog(loadedPlatformCatalog.catalog)
      : requireAgentCatalog(options.agentCatalog),
    pluginCatalog: loadedPlatformCatalog
      ? PluginCatalog.fromPlatformCatalog(loadedPlatformCatalog.catalog)
      : requirePluginCatalog(options.pluginCatalog)
  };
}

function createStoragePool(
  storageMode: BrainControlStorageMode,
  postgresConnection: ReturnType<typeof postgresConnectionConfig>
): PostgresQueryable | undefined {
  return storageMode === "postgres" ? createPostgresPool(postgresConnection!) : undefined;
}

async function assertCatalogCompatibility(
  loadedPlatformCatalog: BootstrapCatalogs["loadedPlatformCatalog"],
  postgresPool: PostgresQueryable | undefined,
  agentCatalog: AgentCatalog
): Promise<void> {
  if (!loadedPlatformCatalog || !postgresPool) return;
  const compatibility = new AgentCatalogCompatibilityService(
    new PostgresDurableAgentReferenceRepository(postgresPool),
    agentCatalog
  );
  await assertAgentCatalogCompatibleAtStartup(() => compatibility.assertCompatible());
}

function requireAgentCatalog(agentCatalog: AgentCatalog | undefined): AgentCatalog {
  if (!agentCatalog) {
    throw new Error(
      "PLATFORM_CATALOG_PATH is required unless an agent catalog is explicitly supplied."
    );
  }
  return agentCatalog;
}

function requirePluginCatalog(pluginCatalog: RoomPluginCatalog | undefined): RoomPluginCatalog {
  if (!pluginCatalog) {
    throw new Error("Brain Control requires an explicit plugin catalog for test fixtures.");
  }
  return pluginCatalog;
}
