import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Contract } from "@hr/types";

const BRAND_DEEP = "#a8126d";
const INK = "#141414";
const MUTED = "#6e6a6c";
const LINE = "#f5e1ec";
const SOFT = "#ffd9f0";
const GREEN = "#047857";

const LOGO = path.resolve(__dirname, "../assets/logo.png");
const TIME_ZONE = process.env.TIME_ZONE ?? "Africa/Lagos";
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  });

/** A contract as an A4 PDF, with how it was accepted at the end. */
export function contractPdf(c: Contract, company: string, employeeName: string): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 56, bottom: 60, left: 56, right: 56 },
    info: { Title: `${c.title} - ${employeeName}`, Author: company },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(BRAND_DEEP)
    .text(company.toUpperCase(), left, 56, { characterSpacing: 2 });
  doc.font("Helvetica-Bold").fontSize(20).fillColor(INK).text(c.title, left, 72, { width: width - 60 });
  if (existsSync(LOGO)) doc.image(LOGO, left + width - 44, 50, { width: 44 });
  doc.font("Helvetica").fontSize(9.5).fillColor(MUTED)
    .text(`For ${employeeName} · sent ${when(c.sentAt)}`, left, doc.y + 4);
  const ruleY = doc.y + 10;
  doc.moveTo(left, ruleY).lineTo(left + width, ruleY).lineWidth(1).strokeColor(LINE).stroke();

  // The wording as HR wrote it: blank lines start new paragraphs, and short
  // lines in capitals or starting with a number read as headings.
  doc.y = ruleY + 16;
  // The PDF's built-in fonts have no naira sign, so amounts read "NGN 120,000.00".
  const body = c.body.replace(/₦\s?/g, "NGN ");
  for (const block of body.split(/\n\s*\n/)) {
    const text = block.trim();
    if (!text) continue;
    const firstLine = text.split("\n")[0];
    const heading =
      firstLine.length < 60 && (/^\d+[.)]\s/.test(firstLine) || firstLine === firstLine.toUpperCase());
    if (heading) {
      doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(firstLine, left, doc.y, { width });
      const rest = text.split("\n").slice(1).join("\n").trim();
      if (rest) doc.font("Helvetica").fontSize(10.5).text(rest, left, doc.y + 2, { width, lineGap: 2 });
    } else {
      doc.font("Helvetica").fontSize(10.5).fillColor(INK).text(text, left, doc.y, { width, lineGap: 2 });
    }
    doc.moveDown(0.8);
  }

  // How it was accepted.
  if (doc.y > doc.page.height - 160) doc.addPage();
  const boxY = doc.y + 8;
  const accepted = c.status === "accepted" && c.acceptedAt;
  doc.roundedRect(left, boxY, width, 70, 8).fillColor(accepted ? "#ecfdf5" : SOFT).fill();
  doc.font("Helvetica-Bold").fontSize(11).fillColor(accepted ? GREEN : BRAND_DEEP)
    .text(accepted ? "ACCEPTED ELECTRONICALLY" : "NOT ACCEPTED YET", left + 16, boxY + 14, {
      characterSpacing: 1.5,
    });
  doc.font("Helvetica").fontSize(10).fillColor(INK).text(
    accepted
      ? `By ${c.acceptedName}, typing their full name and agreeing to these terms, on ${when(c.acceptedAt!)}` +
          (c.acceptedIp ? ` (from ${c.acceptedIp}).` : ".")
      : "This contract has not been accepted.",
    left + 16,
    boxY + 32,
    { width: width - 32 },
  );

  doc.end();
  return done;
}
