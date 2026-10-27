import nodemailer from "nodemailer";
import { db } from "./db";

// Any email account that can send by SMTP works: Google Workspace, Zoho,
// Brevo, Resend and the like. Without SMTP_HOST nothing is sent, but every
// email is still kept in the outbox, so HR can see what would have gone and
// copy a link by hand.
const transport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_PORT === "465",
      // Give up on a slow mail server in seconds, not the default 10 minutes,
      // so nobody is left waiting and the outbox records why.
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      ...(process.env.SMTP_USER
        ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } }
        : {}),
    })
  : null;
const FROM = process.env.MAIL_FROM ?? process.env.SMTP_USER ?? "";

if (!transport || !FROM)
  console.log("Email is not set up (SMTP_HOST, MAIL_FROM): emails are kept in the outbox only.");

export type EmailStatus = "sent" | "failed" | "not_sent";

// Minutes to wait before each further try of a failed email: six tries in
// all, over about two hours.
const RETRY_MINUTES = [1, 5, 15, 30, 60];

async function deliver(to: string, subject: string, text: string) {
  if (!transport || !FROM) return { status: "not_sent" as EmailStatus, error: null };
  try {
    await transport.sendMail({ from: FROM, to, subject, text });
    return { status: "sent" as EmailStatus, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`Email to ${to} failed:`, error);
    return { status: "failed" as EmailStatus, error };
  }
}

/** When to try again after this many tries, or null to stop. */
const nextTry = (status: EmailStatus, attempts: number) =>
  status === "failed" && attempts <= RETRY_MINUTES.length
    ? new Date(Date.now() + RETRY_MINUTES[attempts - 1] * 60_000)
    : null;

/**
 * Sends an email (or keeps it in the outbox when email isn't set up). One
 * that fails is tried again later by retryFailedEmails.
 */
export async function sendEmail(email: {
  to: string;
  subject: string;
  text: string;
  employeeId?: string;
}): Promise<EmailStatus> {
  const { status, error } = await deliver(email.to, email.subject, email.text);
  // A newer copy replaces any older one still waiting to be retried, so
  // nobody is sent a link that no longer works.
  await db.query(
    `UPDATE email_outbox SET next_attempt_at = NULL
     WHERE to_address = $1 AND subject = $2 AND next_attempt_at IS NOT NULL`,
    [email.to, email.subject],
  );
  await db.query(
    `INSERT INTO email_outbox (to_address, subject, body, status, error, employee_id, next_attempt_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [email.to, email.subject, email.text, status, error, email.employeeId ?? null, nextTry(status, 1)],
  );
  return status;
}

/** Tries again every failed email that's due. */
export async function retryFailedEmails() {
  const { rows } = await db.query<{ id: string; to_address: string; subject: string; body: string; attempts: number }>(
    `SELECT id, to_address, subject, body, attempts FROM email_outbox
     WHERE next_attempt_at <= now() ORDER BY next_attempt_at LIMIT 20`,
  );
  for (const row of rows) {
    const { status, error } = await deliver(row.to_address, row.subject, row.body);
    const attempts = row.attempts + 1;
    await db.query(
      `UPDATE email_outbox SET status = $2, error = $3, attempts = $4, next_attempt_at = $5
       WHERE id = $1 AND next_attempt_at IS NOT NULL`,
      [row.id, status, error, attempts, nextTry(status, attempts)],
    );
  }
}

/** Checks for failed emails to retry once a minute while the server runs. */
export function startRetryingEmails() {
  let busy = false;
  setInterval(() => {
    if (busy) return;
    busy = true;
    retryFailedEmails()
      .catch((err) => console.error("Retrying emails failed:", err))
      .finally(() => (busy = false));
  }, 60_000).unref();
}
