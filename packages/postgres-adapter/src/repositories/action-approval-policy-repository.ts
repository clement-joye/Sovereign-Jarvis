import type { ActionApprovalPolicyRepositoryPort } from "@second-brain/application/ports/approvals";
import type { ApprovalModeV1 } from "@second-brain/contracts/schemas";

import type { PostgresQueryable } from "../postgres-queryable.js";
import { withTransaction, type PostgresTransactionSource } from "../transaction.js";
import { typedDatabase, type TypedPostgresDatabase } from "../typed-database.js";

/**
 * PostgreSQL adapter for the bounded, user-strengthening approval policy.
 *
 * The table deliberately stores only owner-required rows. An absent row is
 * the durable representation of no user override; it can never lower a
 * plugin operation's reviewed minimum approval mode.
 */
export class PostgresActionApprovalPolicyRepository implements ActionApprovalPolicyRepositoryPort {
  private readonly db: TypedPostgresDatabase;

  constructor(private readonly source: PostgresTransactionSource & PostgresQueryable) {
    this.db = typedDatabase(source);
  }

  async getMode(
    workspaceId: string,
    pluginId: string,
    operationId: string
  ): Promise<ApprovalModeV1 | undefined> {
    const row = await this.db
      .withSchema("brain_core")
      .selectFrom("action_approval_policies")
      .select("mode")
      .where("workspace_id", "=", workspaceId)
      .where("plugin_id", "=", pluginId)
      .where("operation_id", "=", operationId)
      .executeTakeFirst();
    return row?.mode === "owner" ? "owner" : undefined;
  }

  /** Replaces one workspace/plugin policy atomically. */
  async replaceOwnerRequiredOperations(input: {
    workspaceId: string;
    pluginId: string;
    operationIds: readonly string[];
    updatedAt: Date;
  }): Promise<void> {
    const operationIds = [...new Set(input.operationIds)];
    await withTransaction(this.source, async (queryable) => {
      const db = typedDatabase(queryable).withSchema("brain_core");
      await db
        .deleteFrom("action_approval_policies")
        .where("workspace_id", "=", input.workspaceId)
        .where("plugin_id", "=", input.pluginId)
        .execute();
      if (operationIds.length === 0) return;
      await db
        .insertInto("action_approval_policies")
        .values(
          operationIds.map((operationId) => ({
            workspace_id: input.workspaceId,
            plugin_id: input.pluginId,
            operation_id: operationId,
            mode: "owner" as const,
            updated_at: input.updatedAt
          }))
        )
        .execute();
    });
  }
}
