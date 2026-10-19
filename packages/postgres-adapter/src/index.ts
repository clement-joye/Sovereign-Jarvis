export interface MigrationDescriptor {
  id: string;
  description: string;
  path: string;
}

export const initialMigrations: MigrationDescriptor[] = [
  {
    id: "0001",
    description: "Create the complete public database baseline",
    path: "deploy/migrations/0001_public_baseline.sql"
  },
  {
    id: "0002",
    description: "Persist outbound semantic presentation",
    path: "deploy/migrations/0002_outbound_presentation.sql"
  },
  {
    id: "0003",
    description: "Persist agent-run notice origin",
    path: "deploy/migrations/0003_agent_run_notice_origin.sql"
  },
  {
    id: "0004",
    description: "Persist per-root delegation notice claims",
    path: "deploy/migrations/0004_delegation_notice_claims.sql"
  },
  {
    id: "0005",
    description: "Persist inbound audio transcripts for conversation history",
    path: "deploy/migrations/0005_inbound_audio_transcript.sql"
  },
  {
    id: "0006",
    description: "Migrate actionable references from retired planner agents",
    path: "deploy/migrations/0006_migrate_retired_agent_references.sql"
  },
  {
    id: "0007",
    description: "Persist scheduled Matrix thread destinations",
    path: "deploy/migrations/0007_schedule_thread_destination.sql"
  }
];

export * from "./inbound-acceptance.js";
export * from "./repositories/conversation-preference-repository.js";
export * from "./repositories/inbound-message-repository.js";
export * from "./job-queue.js";
export * from "./database-schema.js";
export * from "./postgres-queryable.js";
export * from "./typed-database.js";
export * from "./outbound-completion.js";
export * from "./outbound-delivery.js";
export * from "./repositories/outbound-repository.js";
export * from "./repositories/retention-repository.js";
export * from "./schedule-claim.js";
export * from "./repositories/schedule-repository.js";
export * from "./repositories/session-repository.js";
export * from "./transaction.js";
export * from "./repositories/workspace-repository.js";
export * from "./repositories/workspace-plugin-binding-repository.js";
export * from "./repositories/workspace-write-lease-repository.js";
export * from "./attachment-row.js";
export * from "./repositories/agent-collaboration-repository.js";
export * from "./repositories/durable-agent-reference-repository.js";
export * from "./repositories/action-proposal-repository.js";
export * from "./repositories/action-approval-policy-repository.js";
export * from "./retention-row.js";
export * from "./session-row.js";

export { pingPostgresPool } from "./postgres-pool.js";
