import pg from "pg";
import { config } from "../config.js";

pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (value) => value);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (value) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}
