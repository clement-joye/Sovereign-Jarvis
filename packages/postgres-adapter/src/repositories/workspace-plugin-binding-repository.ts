import type {
  WorkspacePluginBinding,
  WorkspacePluginBindingListingRepositoryPort,
  WorkspacePluginBindingRepositoryPort
} from "@second-brain/application/ports/workspace";
import type { PostgresQueryable } from "../postgres-queryable.js";
import { typedDatabase, type TypedPostgresDatabase } from "../typed-database.js";

export class PostgresWorkspacePluginBindingRepository
  implements WorkspacePluginBindingListingRepositoryPort
{
  private readonly db: TypedPostgresDatabase;

  constructor(queryable: PostgresQueryable) {
    this.db = typedDatabase(queryable);
  }

  async upsert(
    input: Parameters<WorkspacePluginBindingRepositoryPort["upsert"]>[0]
  ): Promise<void> {
    await this.db
      .withSchema("brain_core")
      .insertInto("workspace_plugin_bindings")
      .values({
        workspace_id: input.workspaceId,
        plugin_id: input.pluginId,
        plugin_version: input.pluginVersion,
        enabled_agents: input.enabledAgents,
        configuration: input.configuration,
        credential_ref: input.credentialRef ?? null,
        updated_at: input.updatedAt
      })
      .onConflict((conflict) =>
        conflict.columns(["workspace_id", "plugin_id"]).doUpdateSet({
          plugin_version: input.pluginVersion,
          enabled_agents: input.enabledAgents,
          configuration: input.configuration,
          credential_ref: input.credentialRef ?? null,
          updated_at: input.updatedAt
        })
      )
      .execute();
  }

  async get(workspaceId: string, pluginId: string): Promise<WorkspacePluginBinding | undefined> {
    const row = await bindingQuery(this.db)
      .where("workspace_id", "=", workspaceId)
      .where("plugin_id", "=", pluginId)
      .executeTakeFirst();
    return row ? bindingFromRow(row) : undefined;
  }

  async list(workspaceId: string): Promise<WorkspacePluginBinding[]> {
    const rows = await bindingQuery(this.db)
      .where("workspace_id", "=", workspaceId)
      .orderBy("plugin_id", "asc")
      .execute();
    return rows.map(bindingFromRow);
  }

  async disable(workspaceId: string, pluginId: string): Promise<boolean> {
    const result = await this.db
      .withSchema("brain_core")
      .deleteFrom("workspace_plugin_bindings")
      .where("workspace_id", "=", workspaceId)
      .where("plugin_id", "=", pluginId)
      .executeTakeFirst();
    return result.numDeletedRows === 1n;
  }
}

function bindingQuery(db: TypedPostgresDatabase) {
  return db
    .withSchema("brain_core")
    .selectFrom("workspace_plugin_bindings")
    .select([
      "workspace_id",
      "plugin_id",
      "plugin_version",
      "enabled_agents",
      "configuration",
      "credential_ref"
    ]);
}

function bindingFromRow(
  row: Awaited<ReturnType<ReturnType<typeof bindingQuery>["executeTakeFirstOrThrow"]>>
): WorkspacePluginBinding {
  return {
    workspaceId: row.workspace_id,
    pluginId: row.plugin_id,
    pluginVersion: row.plugin_version,
    enabledAgents: row.enabled_agents,
    configuration: row.configuration,
    ...(row.credential_ref ? { credentialRef: row.credential_ref } : {})
  };
}
