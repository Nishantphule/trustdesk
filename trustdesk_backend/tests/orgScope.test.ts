import { afterAll, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { signToken } from "../src/auth/jwt.js";
import { pool } from "../src/db/pool.js";

const app = createApp();
const server = app.listen(0);
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;

async function asOrg(orgId: string, path: string) {
  const token = signToken({
    userId: "usr_test",
    orgId,
    role: "admin",
    email: "tester@example.com",
    name: "Tester",
  });
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: await response.json() };
}

it("keeps org A from reading org B tickets", async () => {
  await pool.query(
    `INSERT INTO organizations (id, name, slug) VALUES ('org_b_test', 'Other Org', 'other-org-test')
     ON CONFLICT (id) DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO tickets (id, org_id, subject, body_raw, status, created_at)
     VALUES ('tkt_org_b', 'org_b_test', 'Secret', 'belongs to org B', 'new', now())
     ON CONFLICT (id) DO NOTHING`,
  );

  const acmeList = await asOrg("org_acme", "/api/v1/tickets");
  const ids = (acmeList.body as { id: string }[]).map((row) => row.id);
  expect(ids).not.toContain("tkt_org_b");

  const foreign = await asOrg("org_acme", "/api/v1/tickets/tkt_org_b");
  expect(foreign.status).toBe(404);

  const owner = await asOrg("org_b_test", "/api/v1/tickets/tkt_org_b");
  expect(owner.status).toBe(200);
  expect(owner.body.id).toBe("tkt_org_b");
});

afterAll(async () => {
  await pool.query("DELETE FROM tickets WHERE id = 'tkt_org_b'");
  await pool.query("DELETE FROM organizations WHERE id = 'org_b_test'");
  server.close();
  await pool.end();
});
