import type { DurableAgentReferenceRepositoryPort } from "@second-brain/application/ports/workspace";
import { sql } from "kysely";

import type { PostgresQueryable } from "../postgres-queryable.js";
import { typedDatabase, type TypedPostgresDatabase } from "../typed-database.js";

export class PostgresDurableAgentReferenceRepository
  implements DurableAgentReferenceRepositoryPort
{
  private readonly db: TypedPostgresDatabase;

  constructor(source: PostgresQueryable) {
    this.db = typedDatabase(source);
  }

  async listReferencedAgentIds(): Promise<string[]> {
    const core = this.db.withSchema("brain_core");
    const jobs = this.db.withSchema("brain_jobs");
    const references = core
      .selectFrom("workspaces")
      .select("default_agent as agent_id")
      .union(core.selectFrom("session_bindings").select("agent_id"))
      .union(core.selectFrom("thread_agent_selections").select("agent_id"))
      .union(
        core
          .selectFrom("scheduled_jobs")
          .select("agent_id")
          .where("enabled", "=", true)
          .where("deleted_at", "is", null)
      )
      .union(
        core
          .selectFrom("agent_runs")
          .select("agent_id")
          .where("status", "in", ["queued", "running"])
      )
      .union(
        core
          .selectFrom("delegation_grants")
          .innerJoin("agent_runs", "agent_runs.id", "delegation_grants.parent_run_id")
          .select("delegation_grants.child_agent_id as agent_id")
          .where("agent_runs.status", "in", ["queued", "running"])
          .where("delegation_grants.expires_at", ">", sql<Date>`now()`)
      )
      .union(
        core
          .selectFrom("action_proposals")
          .select("agent_id")
          .where("status", "in", ["proposed", "approved"])
      )
      .union(
        core
          .selectFrom("workspace_plugin_bindings")
          .select(sql<string>`unnest(enabled_agents)`.as("agent_id"))
      )
      .union(
        jobs
          .selectFrom("jobs")
          .select(sql<string>`payload->>'agentId'`.as("agent_id"))
          .where("status", "in", ["pending", "leased", "running", "retry_wait"])
      );
    const rows = await this.db
      .selectFrom(references.as("refs"))
      .select("agent_id")
      .distinct()
      .where("agent_id", "is not", null)
      .orderBy("agent_id")
      .execute();
    return rows.map((row) => row.agent_id);
  }
}
