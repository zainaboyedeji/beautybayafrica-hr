import { db } from "./db";
import { today } from "./payroll";
import type express from "express";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Admins log in with their email and password, and the owner with
// ADMIN_PASSWORD alone; employees log in to the staff portal with their work
// email and a password the admin gives them.
export type Role = "admin" | "employee";
export type Session = {
  role: Role;
  name: string;
  employeeId?: string;
  /** Absent for the owner, who logs in with ADMIN_PASSWORD. */
  adminId?: string;
  /** When the login was made, so a password reset can end older ones. */
  iat: number;
  exp: number;
  /** Checked on each request, not stored in the token: still on HR's temporary password. */
  mustChangePassword?: boolean;
};

/** Who did something, for the activity log. */
export const actorOf = (session: Session) =>
  session.role === "employee"
    ? `${session.name} (staff portal)`
    : session.adminId
      ? `${session.name} (admin)`
      : "Owner";

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

export const createToken = (session: Omit<Session, "iat" | "exp">) => {
  const now = Date.now();
  const payload = Buffer.from(
    JSON.stringify({ ...session, iat: now, exp: now + SESSION_HOURS * 3600_000 }),
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
  // Logins from before the last password reset no longer count. (Logins made
  // before this check existed have no `iat`.)
  const issued = new Date(session.iat ?? 0);
  // Someone who has been deactivated, has left (after their last day, in
  // company time), or whose portal access was removed, is logged out straight
  // away: this is checked on every request. The same goes for admins.
  if (session.role === "employee") {
    const { rows } = await db.query<{ must_change_password: boolean }>(
      `SELECT must_change_password FROM employees WHERE id = $1
         AND password_hash IS NOT NULL
         AND deactivated_at IS NULL AND (end_date IS NULL OR end_date >= $2)
         AND sessions_valid_after <= $3`,
      [session.employeeId, today(), issued],
    );
    if (!rows[0]) return null;
    session.mustChangePassword = rows[0].must_change_password;
  } else if (session.adminId) {
    const { rowCount } = await db.query(
      `SELECT 1 FROM admins WHERE id = $1 AND deactivated_at IS NULL
         AND sessions_valid_after <= $2`,
      [session.adminId, issued],
    );
    if (!rowCount) return null;
  }
  return session;
};

const requireRole =
  (roles: Role[], { whileMustChange = false } = {}): express.RequestHandler =>
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
    // Someone on HR's temporary password must choose their own before
    // anything else.
    if (session.mustChangePassword && !whileMustChange) {
      res.status(403).json({
        error: "Choose your own password first",
        code: "must_change_password",
      });
      return;
    }
    res.locals.session = session;
    next();
  };

/** The logged-in user, for handlers behind requireRole. */
export const sessionOf = (res: express.Response) => res.locals.session as Session;

export const anyone = requireRole(["admin", "employee"]);
export const adminOnly = requireRole(["admin"]);
export const employeeOnly = requireRole(["employee"]);
/** For the few staff routes that still work on a temporary password. */
export const employeeOnTemporaryPassword = requireRole(["employee"], { whileMustChange: true });

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
