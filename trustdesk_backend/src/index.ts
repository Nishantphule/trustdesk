import { createApp } from "./app.js";
import { config } from "./config.js";
import { pollConnectedMailboxes } from "./channels/gmailIngest.js";
import { migrate } from "./db/migrate.js";
import { pool } from "./db/pool.js";
import { seed } from "./db/seed.js";

const app = createApp();

async function main() {
  await migrate();
  if (config.seedOnBoot) await seed();
  app.listen(config.port, () => {
    console.log(`TrustDesk API listening on ${config.port}`);
    if (config.gmailPollMs > 0 && config.googleClientId) {
      const poll = () => {
        void pollConnectedMailboxes();
      };
      poll();
      setInterval(poll, config.gmailPollMs);
    }
  });
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
