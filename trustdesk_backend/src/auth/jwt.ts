import jwt from "jsonwebtoken";
import { config } from "../config.js";

export type Role = "admin" | "supervisor" | "agent";

export type AuthUser = {
  userId: string;
  orgId: string;
  role: Role;
  email: string;
  name: string;
};

const rank: Record<Role, number> = { agent: 1, supervisor: 2, admin: 3 };

export function signToken(user: AuthUser): string {
  return jwt.sign(user, config.jwtSecret, { expiresIn: "12h" });
}

export function verifyToken(token: string): AuthUser {
  return jwt.verify(token, config.jwtSecret) as AuthUser;
}

export function roleAtLeast(actual: Role, required: Role): boolean {
  return rank[actual] >= rank[required];
}
