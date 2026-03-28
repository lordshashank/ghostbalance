import pg from "pg";

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export type QueryFn = <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
) => Promise<QueryResult<T>>;

export interface DbAdapter {
  query: QueryFn;
  transaction<T>(fn: (query: QueryFn) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createPostgresAdapter(databaseUrl: string): DbAdapter {
  const pool = new pg.Pool({ connectionString: databaseUrl });

  const query: QueryFn = async <T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> => {
    const result = await pool.query(sql, params);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
  };

  const transaction = async <T>(
    fn: (query: QueryFn) => Promise<T>
  ): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const clientQuery: QueryFn = async <R = Record<string, unknown>>(
        sql: string,
        params?: unknown[]
      ): Promise<QueryResult<R>> => {
        const result = await client.query(sql, params);
        return { rows: result.rows as R[], rowCount: result.rowCount ?? 0 };
      };
      const result = await fn(clientQuery);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  };

  const close = async (): Promise<void> => {
    await pool.end();
  };

  return { query, transaction, close };
}
