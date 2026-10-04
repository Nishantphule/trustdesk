import { query } from "../db/pool.js";

export type SearchHit = {
  doc_id: string;
  title: string;
  snippet: string;
  content: string;
  score: number;
  version: string;
  module_id: string | null;
};

export async function searchPolicies(
  orgId: string,
  moduleId: string | null,
  q: string,
  k = 5,
): Promise<SearchHit[]> {
  const trimmed = q.replace(/[^\w\s@.-]/g, " ").replace(/\s+/g, " ").trim();
  if (!trimmed) return [];
  const result = await query<{
    doc_id: string;
    title: string;
    snippet: string | null;
    content_md: string;
    score: number;
    version: string;
    module_id: string | null;
  }>(
    `WITH parsed AS (
       SELECT to_tsquery(
         'english',
         NULLIF((
           SELECT string_agg(lexeme, ' | ')
           FROM unnest(to_tsvector('english', $3)) AS t(lexeme, positions)
           WHERE lexeme ~ '^[a-z][a-z0-9]{2,}$'
         ), '')
       ) AS query
     )
     SELECT p.doc_id, p.title, p.content_md, p.version, p.module_id,
            ts_rank_cd(p.search_vector, parsed.query, 32)::float8 AS score,
            ts_headline('english', p.content_md, parsed.query, 'MaxWords=24, MinWords=6, MaxFragments=1') AS snippet
     FROM policies p, parsed
     WHERE p.org_id = $1
       AND p.status = 'published'
       AND ($2::text IS NULL OR p.module_id = $2 OR p.module_id IS NULL)
       AND parsed.query IS NOT NULL
       AND p.search_vector @@ parsed.query
     ORDER BY score DESC
     LIMIT $4`,
    [orgId, moduleId, trimmed.slice(0, 500), k],
  );
  return result.rows.map((row) => ({
    doc_id: row.doc_id,
    title: row.title,
    snippet: row.snippet ?? row.content_md.slice(0, 240),
    content: row.content_md,
    score: Number(row.score),
    version: row.version,
    module_id: row.module_id,
  }));
}
