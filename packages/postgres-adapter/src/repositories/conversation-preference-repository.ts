import type { ConversationPreferencePort } from "@second-brain/application/ports/sessions";
import { requireWorkspaceId } from "@second-brain/domain";
import { sql } from "kysely";

import type { PostgresQueryable } from "../postgres-queryable.js";
import { typedDatabase, type TypedPostgresDatabase } from "../typed-database.js";

export class PostgresConversationPreferenceRepository implements ConversationPreferencePort {
  private readonly db: TypedPostgresDatabase;

  constructor(queryable: PostgresQueryable) {
    this.db = typedDatabase(queryable);
  }

  async getVoiceReplies(input: {
    workspaceId?: string;
    conversationId: string;
    threadRootExternalEventId?: string;
  }): Promise<boolean> {
    const threadRootExternalEventId = input.threadRootExternalEventId ?? null;
    const row = await this.db
      .withSchema("brain_core")
      .selectFrom("conversation_preferences")
      .select("voice_replies_enabled")
      .where(
        "workspace_id",
        "=",
        requireWorkspaceId(input.workspaceId, "Conversation preference lookup")
      )
      .where("conversation_id", "=", input.conversationId)
      .where(
        sql<boolean>`thread_root_external_event_id is not distinct from ${threadRootExternalEventId}`
      )
      .executeTakeFirst();
    return row?.voice_replies_enabled ?? false;
  }

  async setVoiceReplies(input: {
    workspaceId?: string;
    conversationId: string;
    threadRootExternalEventId?: string;
    enabled: boolean;
  }): Promise<boolean> {
    const row = await this.db
      .withSchema("brain_core")
      .insertInto("conversation_preferences")
      .values({
        workspace_id: requireWorkspaceId(input.workspaceId, "Conversation preference update"),
        conversation_id: input.conversationId,
        thread_root_external_event_id: input.threadRootExternalEventId ?? null,
        voice_replies_enabled: input.enabled
      })
      .onConflict((conflict) =>
        conflict
          .columns(["workspace_id", "conversation_id", "thread_root_external_event_id"])
          .doUpdateSet({
            voice_replies_enabled: input.enabled,
            updated_at: sql`now()`
          })
      )
      .returning("voice_replies_enabled")
      .executeTakeFirst();
    return row?.voice_replies_enabled ?? input.enabled;
  }

  async getSessionContext(input: {
    workspaceId?: string;
    conversationId: string;
    threadRootExternalEventId?: string;
  }): Promise<{ mode?: "persistent"; historyLimit?: number }> {
    const row = await this.db
      .withSchema("brain_core")
      .selectFrom("conversation_preferences")
      .select(["session_context_mode", "session_history_limit"])
      .where("workspace_id", "=", requireWorkspaceId(input.workspaceId, "Session context lookup"))
      .where("conversation_id", "=", input.conversationId)
      .where(
        sql<boolean>`thread_root_external_event_id is not distinct from ${input.threadRootExternalEventId ?? null}`
      )
      .executeTakeFirst();
    return {
      ...(row?.session_context_mode ? { mode: row.session_context_mode } : {}),
      ...(row?.session_history_limit !== null && row?.session_history_limit !== undefined
        ? { historyLimit: row.session_history_limit }
        : {})
    };
  }

  async setSessionContext(input: {
    workspaceId?: string;
    conversationId: string;
    threadRootExternalEventId?: string;
    mode?: "persistent";
    historyLimit?: number;
  }): Promise<{ mode?: "persistent"; historyLimit?: number }> {
    const values = {
      session_context_mode: input.mode ?? null,
      session_history_limit: input.historyLimit ?? null
    };
    const row = await this.db
      .withSchema("brain_core")
      .insertInto("conversation_preferences")
      .values({
        workspace_id: requireWorkspaceId(input.workspaceId, "Session context update"),
        conversation_id: input.conversationId,
        thread_root_external_event_id: input.threadRootExternalEventId ?? null,
        ...values
      })
      .onConflict((conflict) =>
        conflict
          .columns(["workspace_id", "conversation_id", "thread_root_external_event_id"])
          .doUpdateSet({
            ...values,
            updated_at: sql`now()`
          })
      )
      .returning(["session_context_mode", "session_history_limit"])
      .executeTakeFirst();
    return {
      ...(row?.session_context_mode ? { mode: row.session_context_mode } : {}),
      ...(row?.session_history_limit !== null && row?.session_history_limit !== undefined
        ? { historyLimit: row.session_history_limit }
        : {})
    };
  }
}
