import type { NextFunction, Request, Response } from "express";
import { verifyToken, type AuthUser } from "./auth/jwt.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "ERROR",
  ) {
    super(message);
  }
}

export type AuthedRequest = Request & { user: AuthUser };

export function asyncHandler(
  fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as AuthedRequest, res, next)).catch(next);
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    next(new HttpError(401, "Authentication required", "AUTH"));
    return;
  }
  try {
    (req as AuthedRequest).user = verifyToken(token);
    next();
  } catch {
    next(new HttpError(401, "Invalid token", "AUTH"));
  }
}

export function requireRole(...roles: AuthUser["role"][]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = (req as AuthedRequest).user;
    if (!user || !roles.includes(user.role)) {
      next(new HttpError(403, "You do not have access to this action", "FORBIDDEN"));
      return;
    }
    next();
  };
}
