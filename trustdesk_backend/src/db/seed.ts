import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { config, DEMO_PASSWORD } from "../config.js";
import { pool } from "./pool.js";
import { migrate } from "./migrate.js";

/** Default org threshold. 0.20 sits between covered tickets (~0.33+) and off-topic retrieval (~0.09). */
export const SEEDED_CONFIDENCE_THRESHOLD = 0.2;

const MODULES = [
  {
    slug: "shipping",
    name: "Shipping",
    description: "Delivery, tracking, and carrier issues.",
    keywords: ["tracking", "package", "carrier", "shipment", "no movement", "not moved", "has not moved", "business days"],
    sla: 120,
    priority: "high",
  },
  {
    slug: "refund",
    name: "Refund",
    description: "Returns, damaged items, replacements, and final-sale refunds.",
    keywords: ["refund", "return", "damaged", "cracked", "replacement", "defective", "license", "final sale", "final-sale"],
    sla: 240,
    priority: "medium",
  },
  {
    slug: "warranty",
    name: "Warranty",
    description: "Warranty coverage and product safety issues.",
    keywords: ["warranty", "battery", "swelling", "swollen", "overheating"],
    sla: 60,
    priority: "urgent",
  },
  {
    slug: "billing",
    name: "Billing",
    description: "Payments, duplicate charges, and billing investigations.",
    keywords: ["charge", "charged", "charges", "billing", "payment", "invoice", "double charge", "two charges"],
    sla: 120,
    priority: "high",
  },
  {
    slug: "account_security",
    name: "Account Security",
    description: "Identity, account changes, and secret-disclosure attempts.",
    keywords: ["account email", "identity", "password", "can't log in", "cannot log in", "sign in", "locked out", "system prompt", "api key", "internal notes", "hidden prompt", "lock account"],
    sla: 60,
    priority: "high",
  },
  {
    slug: "general",
    name: "General",
    description: "Anything that does not fit a specialist module, including coupon abuse.",
    keywords: ["coupon", "system override", "ignore all instructions", "ignore previous instructions", "goodwill"],
    sla: 480,
    priority: "medium",
  },
];

const POLICY_FILES: { file: string; module: string | null }[] = [
  { file: "shipping_policy.md", module: "shipping" },
  { file: "refund_policy.md", module: "refund" },
  { file: "warranty_policy.md", module: "warranty" },
  { file: "billing_policy.md", module: "billing" },
  { file: "account_security_policy.md", module: "account_security" },
  { file: "support_security_playbook.md", module: null },
  { file: "coupon_policy.md", module: "general" },
  { file: "adversarial_vendor_note.md", module: "general" },
];

type Customer = {
  customer_id: string;
  name: string;
  email: string;
  tier: string;
  country: string;
  created_at: string;
  verified: boolean;
  tags: string[];
};

type Order = {
  order_id: string;
  customer_id: string;
  status: string;
  placed_at?: string;
  total: number;
  payment_status: string;
  tracking_number: string | null;
  eligible_return_until: string | null;
  delivered_at: string | null;
  items: { sku: string; final_sale?: boolean; category?: string }[];
};

type Ticket = {
  ticket_id: string;
  customer_id: string;
  order_id: string | null;
  channel: string;
  subject: string;
  body: string;
  created_at: string;
  status: string;
};

type Tool = {
  tool_name: string;
  description: string;
  risk_level: "low" | "medium" | "high";
  allowed_categories: string[];
  required_fields: string[];
  max_amount_inr?: number;
};

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(config.dataDir, file), "utf8")) as T;
}

function parsePolicy(markdown: string) {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "Untitled";
  const docId = markdown.match(/Doc ID:\s*(\S+)/)?.[1];
  const version = markdown.match(/Version:\s*(\S+)/)?.[1] ?? "1";
  const audienceLine = markdown.match(/Audience:\s*(.+)/)?.[1] ?? "";
  const audience = /engineering|admin|imported|internal/i.test(audienceLine) ? "internal" : "external";
  if (!docId) throw new Error(`Missing doc id in policy: ${title}`);
  return { title, docId, version, audience };
}

function roleForRisk(risk: string): "agent" | "supervisor" | "admin" {
  if (risk === "high") return "admin";
  if (risk === "medium") return "supervisor";
  return "agent";
}

export async function seed(): Promise<void> {
  await migrate();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      TRUNCATE
        eval_case_results, eval_runs, tool_actions, module_tool_actions, tool_catalog,
        traces, drafts, ticket_messages, tickets, demo_messages, mailboxes, channels,
        related_records, accounts, policies, rule_settings, modules, users, teams, organizations
      RESTART IDENTITY CASCADE
    `);

    const orgId = "org_acme";
    const teamId = "team_acme_support";
    await client.query(
      `INSERT INTO organizations (id, name, slug, branding_json, business_hours_json, confidence_threshold_default, auto_send_enabled)
       VALUES ($1, 'Acme Retail', 'acme-retail', $2::jsonb, $3::jsonb, $4, false)`,
      [
        orgId,
        JSON.stringify({ primary: "#0f766e", logoText: "Acme Retail" }),
        JSON.stringify({ timezone: "Asia/Kolkata", days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "18:00" }),
        SEEDED_CONFIDENCE_THRESHOLD,
      ],
    );
    await client.query(`INSERT INTO teams (id, org_id, name) VALUES ($1, $2, 'Support')`, [teamId, orgId]);
    await client.query(
      `INSERT INTO rule_settings (org_id, extra_patterns_json) VALUES ($1, '[]'::jsonb)`,
      [orgId],
    );

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 8);
    const users = [
      ["usr_admin", "admin@acme.example", "Amina Shah", "admin"],
      ["usr_supervisor", "supervisor@acme.example", "Rohan Iyer", "supervisor"],
      ["usr_agent", "agent@acme.example", "Leela Nair", "agent"],
    ];
    for (const [id, email, name, role] of users) {
      await client.query(
        `INSERT INTO users (id, org_id, email, name, password_hash, role, team_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, orgId, email, name, passwordHash, role, teamId],
      );
    }

    const moduleIds: Record<string, string> = {};
    for (const mod of MODULES) {
      const id = `mod_${mod.slug}`;
      moduleIds[mod.slug] = id;
      await client.query(
        `INSERT INTO modules (
           id, org_id, name, slug, description, keywords, status, sla_first_response_mins,
           sla_resolution_mins, default_priority, team_id
         ) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10)`,
        [id, orgId, mod.name, mod.slug, mod.description, mod.keywords, mod.sla, mod.sla * 8, mod.priority, teamId],
      );
    }

    const kbDir = path.join(config.dataDir, "knowledge_base");
    for (const entry of POLICY_FILES) {
      const markdown = fs.readFileSync(path.join(kbDir, entry.file), "utf8");
      const parsed = parsePolicy(markdown);
      await client.query(
        `INSERT INTO policies (
           id, org_id, module_id, doc_id, title, content_md, version, audience, status, source_path, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'published',$9,$10)`,
        [
          `pol_${parsed.docId}`,
          orgId,
          entry.module ? moduleIds[entry.module] : null,
          parsed.docId,
          parsed.title,
          markdown,
          parsed.version,
          parsed.audience,
          `data/knowledge_base/${entry.file}`,
          "usr_admin",
        ],
      );
    }

    const customers = readJson<Customer[]>("customers.json");
    for (const customer of customers) {
      await client.query(
        `INSERT INTO accounts (id, org_id, external_ref, name, email, metadata_json, created_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [
          customer.customer_id,
          orgId,
          customer.customer_id,
          customer.name,
          customer.email,
          JSON.stringify({
            tier: customer.tier,
            country: customer.country,
            verified: customer.verified,
            tags: customer.tags,
          }),
          customer.created_at,
        ],
      );
    }

    const orders = readJson<Order[]>("orders.json");
    for (const order of orders) {
      await client.query(
        `INSERT INTO related_records (id, org_id, account_id, record_type, record_ref, payload_json, created_at)
         VALUES ($1,$2,$3,'order',$4,$5::jsonb,$6)`,
        [
          order.order_id,
          orgId,
          order.customer_id,
          order.order_id,
          JSON.stringify({ ...order, id: order.order_id, refund_status: (order as { refund_status?: string }).refund_status ?? "none" }),
          order.delivered_at ?? order.placed_at ?? new Date().toISOString(),
        ],
      );
    }

    type Txn = {
      txn_id: string;
      customer_id: string;
      order_id?: string;
      amount: number;
      currency: string;
      status: string;
      captured_at: string;
      last_four: string;
      method?: string;
      duplicate_of?: string;
    };
    for (const txn of readJson<Txn[]>("transactions.json")) {
      await client.query(
        `INSERT INTO related_records (id, org_id, account_id, record_type, record_ref, payload_json, created_at)
         VALUES ($1,$2,$3,'transaction',$4,$5::jsonb,$6)`,
        [txn.txn_id, orgId, txn.customer_id, txn.txn_id, JSON.stringify(txn), txn.captured_at],
      );
    }

    type AuthEvent = {
      event_id: string;
      customer_id: string;
      event_type: string;
      at: string;
      ip?: string;
      success: boolean;
    };
    for (const event of readJson<AuthEvent[]>("auth_events.json")) {
      await client.query(
        `INSERT INTO related_records (id, org_id, account_id, record_type, record_ref, payload_json, created_at)
         VALUES ($1,$2,$3,'auth_event',$4,$5::jsonb,$6)`,
        [event.event_id, orgId, event.customer_id, event.event_id, JSON.stringify(event), event.at],
      );
    }

    await client.query(
      `INSERT INTO channels (id, org_id, type, config_json, status) VALUES
       ('ch_acme_email', $1, 'email', '{}'::jsonb, 'active'),
       ('ch_acme_chat', $1, 'chat', '{}'::jsonb, 'active')`,
      [orgId],
    );
    await client.query(
      `INSERT INTO mailboxes (id, org_id, provider, address, module_default_id, signature, tone, status)
       VALUES ('mbx_acme_demo', $1, 'demo', 'support@acme.example', $2, 'Acme Retail Support', 'warm and concise', 'active')`,
      [orgId, moduleIds.general],
    );

    const tickets = readJson<Ticket[]>("tickets.json");
    for (const ticket of tickets) {
      const channelId = ticket.channel === "chat" ? "ch_acme_chat" : "ch_acme_email";
      await client.query(
        `INSERT INTO tickets (
           id, org_id, channel_id, mailbox_id, account_id, related_record_id, subject, body_raw, status, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'new',$9)`,
        [
          ticket.ticket_id,
          orgId,
          channelId,
          ticket.channel === "email" ? "mbx_acme_demo" : null,
          ticket.customer_id,
          ticket.order_id || null,
          ticket.subject,
          ticket.body,
          ticket.created_at,
        ],
      );
      await client.query(
        `INSERT INTO ticket_messages (id, org_id, ticket_id, direction, author_type, body, created_at)
         VALUES ($1,$2,$3,'inbound','customer',$4,$5)`,
        [`msg_${ticket.ticket_id}`, orgId, ticket.ticket_id, ticket.body, ticket.created_at],
      );
    }

    await client.query(
      `INSERT INTO tickets (
         id, org_id, channel_id, mailbox_id, account_id, subject, body_raw, status, created_at
       ) VALUES (
         'tkt_demo_low_retrieval', $1, 'ch_acme_email', 'mbx_acme_demo', 'cus_1002',
         'Cafeteria menu question',
         'What is the cafeteria menu on the fourth floor this Friday? I am asking about lunch options only.',
         'new', '2026-07-03T09:00:00+05:30'
       )`,
      [orgId],
    );
    await client.query(
      `INSERT INTO ticket_messages (id, org_id, ticket_id, direction, author_type, body, created_at)
       VALUES ('msg_tkt_demo_low_retrieval', $1, 'tkt_demo_low_retrieval', 'inbound', 'customer',
               'What is the cafeteria menu on the fourth floor this Friday? I am asking about lunch options only.',
               '2026-07-03T09:00:00+05:30')`,
      [orgId],
    );

    await client.query(
      `INSERT INTO demo_messages (id, org_id, mailbox_id, from_email, from_name, subject, body, ingested)
       VALUES (
         'eml_demo_1', $1, 'mbx_acme_demo', 'rahul.mehta@example.com', 'Rahul Mehta',
         'Where is my phone case?',
         'Hi, order ord_5002 still shows no movement. Can you check the carrier?',
         false
       )`,
      [orgId],
    );

    const tools = readJson<Tool[]>("tool_actions.json");
    for (const tool of tools) {
      await client.query(
        `INSERT INTO tool_catalog (key, name, description, risk_level, required_role, required_fields, max_amount_inr)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          tool.tool_name,
          tool.tool_name.replaceAll("_", " "),
          tool.description,
          tool.risk_level,
          roleForRisk(tool.risk_level),
          tool.required_fields,
          tool.max_amount_inr ?? null,
        ],
      );
      for (const slug of tool.allowed_categories) {
        const moduleId = moduleIds[slug];
        if (!moduleId) continue;
        await client.query(
          `INSERT INTO module_tool_actions (module_id, tool_key, enabled) VALUES ($1,$2,true)
           ON CONFLICT DO NOTHING`,
          [moduleId, tool.tool_name],
        );
      }
    }

    await client.query("COMMIT");
    console.log(`Seeded Acme Retail. Password: ${DEMO_PASSWORD}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]).includes("seed");
if (isDirect) {
  seed()
    .then(async () => {
      await pool.end();
    })
    .catch(async (err) => {
      console.error(err);
      await pool.end();
      process.exit(1);
    });
}
