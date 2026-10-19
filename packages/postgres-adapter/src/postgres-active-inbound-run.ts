import type { PostgresQueryable } from "./postgres-queryable.js";

/** Locks the latest interactive turn so a queued job cannot start while being cancelled. */
export async function cancelLatestInboundTurn(
  db: PostgresQueryable,
  input: {
    workspaceId: string;
    conversationId: string;
    threadRootExternalEventId?: string;
    excludeInboundMessageId: string;
  }
): Promise<{ runId: string; needsPiCancel: boolean } | undefined> {
  const result = await db.query<{ id: string; status: string }>(
    `
      SELECT jobs.id, jobs.status
      FROM brain_jobs.jobs jobs
      JOIN brain_core.inbound_messages inbound
        ON inbound.id = jobs.payload->>'inboundMessageId'
      WHERE jobs.workspace_id = $1 AND inbound.workspace_id = $1
        AND jobs.type = 'process_inbound'
        AND jobs.status IN ('pending', 'retry_wait', 'leased', 'running')
        AND jobs.payload->>'requiresRootAdmission' IS DISTINCT FROM 'false'
        AND inbound.conversation_id = $2
        AND inbound.id <> $4
        AND (
          ($3::text IS NULL AND inbound.thread_root_external_event_id IS NULL)
          OR ($3::text IS NOT NULL AND
            COALESCE(inbound.thread_root_external_event_id, inbound.external_event_id) = $3)
        )
      ORDER BY inbound.received_at DESC, jobs.id DESC
      LIMIT 1
      FOR UPDATE OF jobs
    `,
    [
      input.workspaceId,
      input.conversationId,
      input.threadRootExternalEventId ?? null,
      input.excludeInboundMessageId
    ]
  );
  const target = result.rows[0];
  if (!target) return undefined;
  const needsPiCancel = target.status === "leased" || target.status === "running";
  if (!needsPiCancel) {
    await db.query(
      `UPDATE brain_jobs.jobs
       SET status = 'cancelled', updated_at = now()
       WHERE id = $1 AND status IN ('pending', 'retry_wait')`,
      [target.id]
    );
  }
  return { runId: target.id, needsPiCancel };
}
