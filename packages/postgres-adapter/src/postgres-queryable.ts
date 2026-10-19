import type { QueryResult, QueryResultRow } from "pg";

/**
 * The database surface shared by repositories and transaction helpers.
 *
 * Keeping this independent from the job queue prevents repository modules
 * from depending on queue implementation details merely to describe a query.
 */
export interface PostgresQueryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<T>>;
}
