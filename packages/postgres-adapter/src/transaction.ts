import type { PostgresQueryable } from "./postgres-queryable.js";

export interface PostgresTransactionalClient extends PostgresQueryable {
  release(): void;
}

export interface PostgresTransactionSource {
  connect(): Promise<PostgresTransactionalClient>;
}

/** Runs a database operation atomically while preserving the original failure. */
export async function withTransaction<T>(
  source: PostgresTransactionSource,
  operation: (client: PostgresTransactionalClient) => Promise<T>
): Promise<T> {
  const client = await source.connect();
  let started = false;
  try {
    await client.query("BEGIN");
    started = true;
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (started) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the application or commit failure that triggered rollback.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}
