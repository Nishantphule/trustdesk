import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://trustdesk:trustdesk@localhost:5432/trustdesk",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-change-me",
  llmProvider: (process.env.LLM_PROVIDER ?? "mock").toLowerCase(),
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
  groqModel: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  openRouterModelClassify: process.env.OPENROUTER_MODEL_CLASSIFY ?? "openai/gpt-4o-mini",
  openRouterModelDraft: process.env.OPENROUTER_MODEL_DRAFT ?? "anthropic/claude-3.5-sonnet",
  openRouterHttpReferer: process.env.OPENROUTER_HTTP_REFERER ?? "http://localhost:5173",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  googleRedirectUri:
    process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:4000/api/v1/mailboxes/oauth/callback",
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? "",
  gmailPollMs: Number(process.env.GMAIL_POLL_MS ?? 60_000),
  appPublicUrl: process.env.APP_PUBLIC_URL ?? "http://localhost:5173",
  dataDir: process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(here, "../../data"),
  seedOnBoot: process.env.SEED_ON_BOOT === "true",
  autoSendEnabled: false,
};

export const DEMO_PASSWORD = "TrustDesk123!";
