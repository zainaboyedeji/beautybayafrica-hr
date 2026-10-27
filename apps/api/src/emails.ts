// The emails sent to new starters, each as a branded HTML version and a
// plain-text one (for mail apps without HTML, and for HR's outbox view).
// Email apps ignore stylesheets, so the HTML is tables with inline styles.

const BRAND = "#f847b4";
const BRAND_SOFT = "#ffd9f0";
const BRAND_DEEP = "#a8126d";
const INK = "#141414";
const MUTED = "#6e6a6c";
const LINE = "#f5e1ec";
const SURFACE = "#fff7fb";
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

export type Email = { text: string; html: string };

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const firstName = (name: string) => name.trim().split(/\s+/)[0];

const paragraph = (html: string) =>
  `<p style="margin:0 0 16px;font:16px/1.6 ${SANS};color:${INK};">${html}</p>`;

const button = (label: string, link: string) => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
    <tr><td style="border-radius:999px;background:${BRAND};">
      <a href="${escape(link)}" style="display:inline-block;padding:14px 28px;font:600 16px ${SANS};color:${INK};text-decoration:none;border-radius:999px;">${label}</a>
    </td></tr>
  </table>`;

/** A soft pink box with a small heading, holding rows of content. */
const box = (title: string, rows: string) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:${SURFACE};border:1px solid ${LINE};border-radius:16px;">
    <tr><td style="padding:20px 22px 8px;">
      <p style="margin:0 0 12px;font:600 12px ${SANS};letter-spacing:2px;text-transform:uppercase;color:${BRAND_DEEP};">${title}</p>
      ${rows}
    </td></tr>
  </table>`;

/** A numbered step: a pink circle, a bold title and a line under it. */
const step = (n: number, title: string, detail: string) => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">
    <tr>
      <td valign="top" width="38" style="width:38px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td width="26" height="26" align="center" valign="middle" style="width:26px;height:26px;border-radius:13px;background:${BRAND};font:700 13px/1 ${SANS};color:${INK};">${n}</td>
        </tr></table>
      </td>
      <td valign="top" style="font:15px/1.5 ${SANS};color:${INK};">
        <strong>${title}</strong><br><span style="color:${MUTED};">${detail}</span>
      </td>
    </tr>
  </table>`;

const tick = (html: string) =>
  `<p style="margin:0 0 10px;font:15px/1.5 ${SANS};color:${INK};"><span style="color:${BRAND_DEEP};font-weight:700;">&#10003;</span>&nbsp; ${html}</p>`;

function layout(o: { company: string; siteUrl: string; preview: string; heading: string; body: string; link: string }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(o.heading)}</title></head>
<body style="margin:0;padding:0;background:${SURFACE};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escape(o.preview)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SURFACE};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:24px;overflow:hidden;">
        <tr><td align="center" style="padding:28px 24px 22px;background:${BRAND_SOFT};">
          <img src="${escape(o.siteUrl)}/logo.png" width="64" height="64" alt="" style="display:block;border:0;margin:0 auto 10px;">
          <p style="margin:0;font:600 22px ${SERIF};color:${INK};">${escape(o.company)}</p>
          <p style="margin:4px 0 0;font:600 11px ${SANS};letter-spacing:3px;text-transform:uppercase;color:${BRAND_DEEP};">People &amp; pay</p>
        </td></tr>
        <tr><td style="padding:32px 32px 8px;">
          <h1 style="margin:0 0 16px;font:600 26px/1.3 ${SERIF};color:${INK};">${o.heading}</h1>
          ${o.body}
          <p style="margin:8px 0 28px;font:16px/1.6 ${SANS};color:${INK};">Warm regards,<br><strong>The ${escape(o.company)} HR team</strong></p>
        </td></tr>
        <tr><td style="padding:20px 32px 28px;border-top:1px solid ${LINE};">
          <p style="margin:0 0 8px;font:13px/1.5 ${SANS};color:${MUTED};">Button not working? Copy this link into your browser:<br>
            <a href="${escape(o.link)}" style="color:${BRAND_DEEP};word-break:break-all;">${escape(o.link)}</a></p>
          <p style="margin:0;font:13px/1.5 ${SANS};color:${MUTED};">This link is personal to you, so please don't forward this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function contractEmail(o: {
  company: string;
  siteUrl: string;
  name: string;
  jobTitle: string;
  department: string | null;
  startDate: string;
  link: string;
  linkDays: number;
  expires: string;
}): Email {
  const first = firstName(o.name);
  const role = `${o.jobTitle}${o.department ? ` in ${o.department}` : ""}`;
  const text = [
    `Dear ${first},`,
    "",
    `Welcome to ${o.company}! We're delighted you're joining us as ${role}, starting on ${o.startDate}.`,
    "",
    "Your employment contract is ready. Read and accept it here:",
    o.link,
    "",
    "What happens next:",
    "1. Read your contract: your role, pay and terms.",
    "2. Accept it by typing your full name. You can then download a signed copy as a PDF.",
    `3. Set up your HR account. We'll email you a link straight after you accept.`,
    "",
    `The link works for ${o.linkDays} days, until ${o.expires}. If it runs out, ask HR to send it again.`,
    "Questions about your contract? Just reply to this email.",
    "",
    "Warm regards,",
    `The ${o.company} HR team`,
  ].join("\n");
  const html = layout({
    company: o.company,
    siteUrl: o.siteUrl,
    link: o.link,
    preview: `Your employment contract is ready to read and accept.`,
    heading: `Welcome to ${escape(o.company)}, ${escape(first)}!`,
    body:
      paragraph(
        `We're delighted you're joining us as <strong>${escape(role)}</strong>, starting on <strong>${escape(o.startDate)}</strong>. Your employment contract is ready for you to read and accept.`,
      ) +
      button("Read and accept my contract", o.link) +
      box(
        "What happens next",
        step(1, "Read your contract", "Your role, pay and terms, all in one place.") +
          step(2, "Accept it online", "Type your full name to sign. You can download a signed PDF copy.") +
          step(3, "Set up your HR account", "We'll email you a link straight after you accept."),
      ) +
      paragraph(
        `<span style="color:${MUTED};font-size:14px;">The link works for ${o.linkDays} days, until ${escape(o.expires)}. If it runs out, ask HR to send it again. Questions about your contract? Just reply to this email.</span>`,
      ),
  });
  return { text, html };
}

export function setupEmail(o: {
  company: string;
  siteUrl: string;
  name: string;
  workEmail: string;
  link: string;
  linkDays: number;
  expires: string;
}): Email {
  const first = firstName(o.name);
  const login = `${o.siteUrl}/login`;
  const text = [
    `Dear ${first},`,
    "",
    `Thank you for accepting your contract. One last step: set up your ${o.company} HR account.`,
    "",
    "1. Choose your own password here:",
    o.link,
    `2. Then log in at ${login} on the Employee tab with your work email: ${o.workEmail}`,
    "",
    "In your HR account you can:",
    "- see and download your payslips",
    "- check your leave balance and ask for time off",
    "- keep your details, photo and emergency contact up to date",
    "- send HR requests",
    "",
    `The link works for ${o.linkDays} days, until ${o.expires}. Keep your password to yourself; if you forget it, use "Forgotten your password?" on the login page.`,
    "",
    "Warm regards,",
    `The ${o.company} HR team`,
  ].join("\n");
  const html = layout({
    company: o.company,
    siteUrl: o.siteUrl,
    link: o.link,
    preview: `One last step: choose your password and log in.`,
    heading: `You're nearly in, ${escape(first)}!`,
    body:
      paragraph(
        `Thank you for accepting your contract. One last step: choose your password for your <strong>${escape(o.company)} HR account</strong>.`,
      ) +
      button("Set up my account", o.link) +
      box(
        "Your login",
        `<p style="margin:0 0 6px;font:15px/1.5 ${SANS};color:${MUTED};">Work email</p>
         <p style="margin:0 0 14px;font:600 16px ${SANS};color:${INK};word-break:break-all;">${escape(o.workEmail)}</p>
         <p style="margin:0 0 6px;font:15px/1.5 ${SANS};color:${MUTED};">Log in at (Employee tab)</p>
         <p style="margin:0 0 14px;font:600 16px ${SANS};"><a href="${escape(login)}" style="color:${BRAND_DEEP};">${escape(login.replace(/^https?:\/\//, ""))}</a></p>`,
      ) +
      box(
        "In your account you can",
        tick("See and download your payslips") +
          tick("Check your leave balance and ask for time off") +
          tick("Keep your details, photo and emergency contact up to date") +
          tick("Send HR requests"),
      ) +
      paragraph(
        `<span style="color:${MUTED};font-size:14px;">The link works for ${o.linkDays} days, until ${escape(o.expires)}. Keep your password to yourself. If you ever forget it, use &ldquo;Forgotten your password?&rdquo; on the login page.</span>`,
      ),
  });
  return { text, html };
}
