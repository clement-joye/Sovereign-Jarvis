import pg, { type Pool as PgPool, type PoolConfig } from "pg";

import type { PostgresQueryable } from "./postgres-queryable.js";

export type { PoolConfig as PostgresPoolConfig } from "pg";

const { Pool } = pg;

export function createPostgresPool(connection: string | PoolConfig): PgPool {
  return new Pool(typeof connection === "string" ? { connectionString: connection } : connection);
}

/** Returns whether a trivial query completes before the readiness timeout. */
export async function pingPostgresPool(
  pool: PostgresQueryable,
  timeoutMs = 1_000
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("postgres_ping_timeout")), timeoutMs);
    });
    await Promise.race([pool.query("SELECT 1"), timeout]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
