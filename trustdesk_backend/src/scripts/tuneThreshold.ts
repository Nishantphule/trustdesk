import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { classifyTicket } from "../ai/pipeline/classify.js";
import { searchPolicies } from "../policies/retriever.js";
import fs from "node:fs";
import path from "node:path";

const tickets = JSON.parse(fs.readFileSync(path.join(config.dataDir, "tickets.json"), "utf8")) as {
  ticket_id: string;
  subject: string;
  body: string;
}[];

const org = await pool.query<{ id: string; confidence_threshold_default: number }>(
  "SELECT id, confidence_threshold_default FROM organizations WHERE slug = 'acme-retail'",
);
const orgId = org.rows[0]?.id;
if (!orgId) {
  console.error("Seed Acme Retail before tuning.");
  process.exit(1);
}
const modules = await pool.query<{ id: string; slug: string; name: string; keywords: string[]; description: string }>(
  "SELECT id, slug, name, keywords, description FROM modules WHERE org_id = $1",
  [orgId],
);
console.log(`Current threshold: ${org.rows[0].confidence_threshold_default}`);
for (const ticket of tickets) {
  const text = `${ticket.subject}\n${ticket.body}`;
  const classified = classifyTicket(text, modules.rows);
  const moduleId = modules.rows.find((m) => m.slug === classified.moduleSlug)?.id ?? null;
  const hits = await searchPolicies(orgId, moduleId, text, 5);
  const top = hits[0];
  console.log(
    `${ticket.ticket_id}\t${classified.moduleSlug}\t${(top?.score ?? 0).toFixed(4)}\t${hits.map((h) => h.doc_id).join(",")}`,
  );
}
const low = await searchPolicies(
  orgId,
  modules.rows.find((m) => m.slug === "general")?.id ?? null,
  "What is the cafeteria menu on the fourth floor this Friday? I am asking about lunch options only.",
  3,
);
console.log(`tkt_demo_low_retrieval\t${(low[0]?.score ?? 0).toFixed(4)}\tgeneral\t${low[0]?.doc_id ?? "none"}`);
await pool.end();
