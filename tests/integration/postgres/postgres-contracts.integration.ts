import { exampleScheduledJob } from "@second-brain/contracts";
import {
  PostgresExecutionRepository,
  PostgresJobQueue,
  PostgresOutboundRepository,
  PostgresScheduleRepository,
  PostgresSessionRepository
} from "@second-brain/postgres-adapter";
import {
  executionRepositoryContract,
  jobQueueContract,
  outboundRepositoryContract,
  scheduleRepositoryContract,
  sessionRepositoryContract
} from "@second-brain/testkit";
import type { Pool } from "pg";
import { afterAll, beforeAll } from "vitest";

import {
  resetDatabase,
  startPostgresIntegrationHarness,
  type PostgresIntegrationHarness
} from "./harness.js";

let harness: PostgresIntegrationHarness;
let pool: Pool;

beforeAll(async () => {
  harness = await startPostgresIntegrationHarness();
  pool = harness.pool;
}, 120_000);

afterAll(async () => {
  await harness?.stop();
});

sessionRepositoryContract({
  name: "postgres",
  beforeEach: async () => {
    await resetDatabase(pool);
    await seedAdditionalWorkspaces(pool);
  },
  create: () => new PostgresSessionRepository({ db: pool })
});

scheduleRepositoryContract({
  name: "postgres",
  beforeEach: async () => resetDatabase(pool),
  create: () => new PostgresScheduleRepository({ db: pool })
});

executionRepositoryContract({
  name: "postgres",
  beforeEach: async () => {
    await resetDatabase(pool);
    await new PostgresScheduleRepository({ db: pool }).create(exampleScheduledJob);
  },
  create: () => new PostgresExecutionRepository({ db: pool })
});

outboundRepositoryContract({
  name: "postgres",
  beforeEach: async () => {
    await resetDatabase(pool);
    await seedAdditionalWorkspaces(pool);
  },
  create: () => new PostgresOutboundRepository({ db: pool })
});

jobQueueContract({
  name: "postgres",
  beforeEach: async () => {
    await resetDatabase(pool);
    await seedAdditionalWorkspaces(pool);
  },
  create: () => new PostgresJobQueue({ db: pool })
});

async function seedAdditionalWorkspaces(pool: Pool): Promise<void> {
  await pool.query(
    `
      INSERT INTO brain_core.workspaces (
        id, template_id, template_version, configuration, status, origin, created_at, updated_at
      )
      VALUES
        ('workspace-one', 'second-brain', 1, '{}', 'active', 'migration', now(), now()),
        ('workspace-two', 'second-brain', 1, '{}', 'active', 'migration', now(), now())
      ON CONFLICT (id) DO NOTHING
    `
  );
}
