import { db } from "./db";
import { today } from "./payroll";
import type express from "express";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// The admin logs in with ADMIN_PASSWORD; employees log in to the staff portal
// with their work email and a password the admin gives them.
export type Role = "admin" | "employee";
export type Session = { role: Role; name: string; employeeId?: string; exp: number };

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
if (!ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD is not set, so the admin cannot log in.");
}
// Without a fixed SESSION_SECRET everyone is logged out when the server restarts.
const SESSION_SECRET =
  process.env.SESSION_SECRET ?? randomBytes(32).toString("hex");
const SESSION_HOURS = 12;

export const MIN_PASSWORD_LENGTH = 8;

export const hashPassword = (password: string) => {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: scryptSync(password, salt, 32).toString("hex") };
};

export const passwordMatchesHash = (password: string, salt: string, hash: string) =>
  timingSafeEqual(
    scryptSync(password, salt, 32),
    Buffer.from(hash, "hex"),
  );

// Compares hashes so the check takes the same time whatever was typed.
export const isAdminPassword = (password: string) =>
  ADMIN_PASSWORD !== "" &&
  timingSafeEqual(
    createHmac("sha256", SESSION_SECRET).update(password).digest(),
    createHmac("sha256", SESSION_SECRET).update(ADMIN_PASSWORD).digest(),
  );

const sign = (payload: string) =>
  createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");

export const createToken = (session: Omit<Session, "exp">) => {
  const payload = Buffer.from(
    JSON.stringify({ ...session, exp: Date.now() + SESSION_HOURS * 3600_000 }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
};

const readToken = async (header: string | undefined): Promise<Session | null> => {
  const [payload, signature] = (header ?? "").replace(/^Bearer /, "").split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  const session: Session = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  );
  if (session.exp < Date.now()) return null;
  // Someone who has been deactivated, has left (after their last day, in
  // company time), or whose portal access was removed, is logged out straight
  // away: this is checked on every request.
  if (session.role === "employee") {
    const { rowCount } = await db.query(
      `SELECT 1 FROM employees WHERE id = $1 AND password_hash IS NOT NULL
         AND deactivated_at IS NULL AND (end_date IS NULL OR end_date >= $2)`,
      [session.employeeId, today()],
    );
    if (!rowCount) return null;
  }
  return session;
};

const requireRole =
  (...roles: Role[]): express.RequestHandler =>
  async (req, res, next) => {
    const session = await readToken(req.header("authorization"));
    if (!session) {
      res.status(401).json({ error: "Please log in" });
      return;
    }
    if (!roles.includes(session.role)) {
      res.status(403).json({ error: "Only the admin can do this" });
      return;
    }
    res.locals.session = session;
    next();
  };

/** The logged-in user, for handlers behind requireRole. */
export const sessionOf = (res: express.Response) => res.locals.session as Session;

export const anyone = requireRole("admin", "employee");
export const adminOnly = requireRole("admin");
export const employeeOnly = requireRole("employee");

// Lock a device out after too many wrong attempts.
const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
const failedLogins = new Map<string, { count: number; until: number }>();

export const isLockedOut = (key: string) => {
  const failed = failedLogins.get(key);
  return !!failed && failed.count >= MAX_FAILED_LOGINS && failed.until > Date.now();
};

export const recordFailedLogin = (key: string) => {
  const failed = failedLogins.get(key);
  const count = failed && failed.until > Date.now() ? failed.count + 1 : 1;
  failedLogins.set(key, { count, until: Date.now() + LOCKOUT_MINUTES * 60_000 });
};

export const clearFailedLogins = (key: string) => failedLogins.delete(key);
