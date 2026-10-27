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
      ...(process.env.SMTP_USER
        ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } }
        : {}),
    })
  : null;
const FROM = process.env.MAIL_FROM ?? process.env.SMTP_USER ?? "";

if (!transport || !FROM)
  console.log("Email is not set up (SMTP_HOST, MAIL_FROM): emails are kept in the outbox only.");

export type EmailStatus = "sent" | "failed" | "not_sent";

/** Sends an email (or keeps it in the outbox when email isn't set up). */
export async function sendEmail(email: {
  to: string;
  subject: string;
  text: string;
  employeeId?: string;
}): Promise<EmailStatus> {
  let status: EmailStatus = "not_sent";
  let error: string | null = null;
  if (transport && FROM) {
    try {
      await transport.sendMail({ from: FROM, to: email.to, subject: email.subject, text: email.text });
      status = "sent";
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message : String(err);
      console.error(`Email to ${email.to} failed:`, error);
    }
  }
  await db.query(
    `INSERT INTO email_outbox (to_address, subject, body, status, error, employee_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [email.to, email.subject, email.text, status, error, email.employeeId ?? null],
  );
  return status;
}
