import { Kysely, PostgresDialect } from "kysely";
import type { PostgresPool, PostgresPoolClient, PostgresQueryResult } from "kysely";

import type { JarvisDatabase } from "./database-schema.js";
import type { PostgresQueryable } from "./postgres-queryable.js";

export type TypedPostgresDatabase = Kysely<JarvisDatabase>;

const databases = new WeakMap<PostgresQueryable, TypedPostgresDatabase>();

/**
 * Returns a typed query builder over an existing pool or transaction client.
 * The caller continues to own the underlying connection lifecycle.
 */
export function typedDatabase(queryable: PostgresQueryable): TypedPostgresDatabase {
  const existing = databases.get(queryable);
  if (existing) return existing;

  const database = new Kysely<JarvisDatabase>({
    dialect: new PostgresDialect({ pool: toKyselyPool(queryable) })
  });
  databases.set(queryable, database);
  return database;
}

function toKyselyPool(queryable: PostgresQueryable): PostgresPool {
  if (isKyselyPool(queryable)) return queryable;

  return {
    async connect() {
      return {
        query: async <Row>(
          sql: string,
          parameters: readonly unknown[]
        ): Promise<PostgresQueryResult<Row>> =>
          (await queryable.query(sql, parameters)) as unknown as PostgresQueryResult<Row>,
        release() {}
      } as unknown as PostgresPoolClient;
    },
    async end() {}
  };
}

function isKyselyPool(queryable: PostgresQueryable): queryable is PostgresQueryable & PostgresPool {
  return (
    "connect" in queryable &&
    typeof queryable.connect === "function" &&
    "totalCount" in queryable &&
    typeof queryable.totalCount === "number"
  );
}
