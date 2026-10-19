import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import { PostgresDurableAgentReferenceRepository } from "./durable-agent-reference-repository.js";

describe("PostgresDurableAgentReferenceRepository", () => {
  it("queries every durable reference source and returns sorted IDs", async () => {
    let sql = "";
    let parameters: readonly unknown[] = [];
    const db = {
      query: async <T extends QueryResultRow = QueryResultRow>(
        query: string,
        values: readonly unknown[] = []
      ): Promise<QueryResult<T>> => {
        sql = query;
        parameters = values;
        return {
          rows: [{ agent_id: "brain" }, { agent_id: "code" }] as unknown as T[],
          command: "SELECT",
          rowCount: 2,
          oid: 0,
          fields: []
        };
      }
    };
    const repository = new PostgresDurableAgentReferenceRepository(db);

    await expect(repository.listReferencedAgentIds()).resolves.toEqual(["brain", "code"]);
    for (const table of [
      "workspaces",
      "session_bindings",
      "thread_agent_selections",
      "scheduled_jobs",
      "agent_runs",
      "delegation_grants",
      "action_proposals",
      "workspace_plugin_bindings"
    ])
      expect(sql).toContain(`"brain_core"."${table}"`);
    expect(sql).toContain('"brain_jobs"."jobs"');
    expect(sql).toContain("unnest(enabled_agents)");
    expect(sql).toContain("payload->>'agentId'");
    expect(sql).toContain('"enabled" =');
    expect(sql).toContain('"deleted_at" is null');
    expect(sql).toContain('"agent_runs"."status" in');
    expect(sql).toContain('"delegation_grants"."expires_at" > now()');
    for (const status of ["proposed", "approved"]) expect(parameters).toContain(status);
    for (const status of ["rejected", "consumed", "expired", "cancelled"])
      expect(parameters).not.toContain(status);
    for (const status of ["pending", "leased", "running", "retry_wait"])
      expect(parameters).toContain(status);
    for (const status of ["completed", "dead_letter"]) expect(parameters).not.toContain(status);
    expect(sql).toContain('order by "agent_id"');
  });
});
