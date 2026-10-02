import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "./http.js";
import { api } from "./routes/api.js";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/v1", api);
  app.use((err: Error & { status?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: { code: "VALIDATION", message: err.issues.map((issue) => issue.message).join("; ") },
      });
      return;
    }
    const status = err instanceof HttpError ? err.status : err.status ?? 500;
    const code = err instanceof HttpError ? err.code : err.code ?? "INTERNAL";
    if (status >= 500) console.error(err);
    res.status(status).json({ error: { code, message: err.message || "Unexpected error" } });
  });
  return app;
}
