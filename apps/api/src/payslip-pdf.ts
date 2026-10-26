import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import path from "node:path";
import type { PayLine, Payslip } from "@hr/types";

// The app's colours, so the PDF looks like the payslip on screen.
const BRAND_DEEP = "#a8126d";
const INK = "#141414";
const MUTED = "#6e6a6c";
const LINE = "#f5e1ec";
const LINE_STRONG = "#ebcfdf";
const SOFT = "#ffd9f0";
const GREEN = "#047857";
const AMBER = "#b45309";

const LOGO = path.resolve(__dirname, "../assets/logo.png");
const TIME_ZONE = process.env.TIME_ZONE ?? "Africa/Lagos";

// The PDF's built-in fonts have no naira sign, so amounts read "NGN 70,000.00"
// as on bank documents.
const amount = (n: number) =>
  `NGN ${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthOf = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const dateOf = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: TIME_ZONE,
  });

/** A payslip as an A4 PDF. */
export function payslipPdf(p: Payslip, company: string): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: 48,
    info: { Title: `Payslip ${monthOf(p.period)} - ${p.employeeName}`, Author: company },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const left = 48;
  const right = doc.page.width - 48;
  const width = right - left;

  // --- Header: company, title, PAID stamp and logo ---
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(BRAND_DEEP)
    .text(company.toUpperCase(), left, 50, { characterSpacing: 2 });
  doc.font("Helvetica-Bold").fontSize(22).fillColor(INK)
    .text(`Payslip · ${monthOf(p.period)}`, left, 66);

  const logoSize = 46;
  if (existsSync(LOGO)) doc.image(LOGO, right - logoSize, 46, { width: logoSize });
  const stampW = 92;
  const stampX = right - logoSize - 14 - stampW;
  const stampColor = p.paidAt ? GREEN : AMBER;
  doc.save().rotate(-5, { origin: [stampX + stampW / 2, 69] });
  doc.roundedRect(stampX, 51, stampW, 36, 6).lineWidth(1.8).strokeColor(stampColor);
  if (!p.paidAt) doc.dash(3, { space: 2 });
  doc.stroke().undash();
  doc.font("Helvetica-Bold").fontSize(p.paidAt ? 13 : 9).fillColor(stampColor)
    .text(p.paidAt ? "PAID" : "NOT PAID YET", stampX, p.paidAt ? 57 : 64, {
      width: stampW,
      align: "center",
      characterSpacing: 2,
    });
  if (p.paidAt)
    doc.font("Helvetica-Bold").fontSize(7.5)
      .text(dateOf(p.paidAt), stampX, 73, { width: stampW, align: "center" });
  doc.restore();

  let y = 112;
  doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor(LINE).stroke();

  // --- Who and how they were paid, in two columns ---
  const details: [string, string][] = [
    ["Name", p.employeeName],
    ["Staff number", p.employeeNo],
    ["Job title", p.jobTitle],
    ["Department", p.departmentName ?? "-"],
    ["Days paid", `${p.daysPaid} of ${p.workingDays} working days`],
    [
      "Paid to",
      p.bankAccountNumber ? `${p.bankName ?? ""} ${p.bankAccountNumber}`.trim() : "-",
    ],
    ...(p.taxId ? [["Tax ID", p.taxId] as [string, string]] : []),
    ...(p.pensionPin
      ? [["Pension", [p.pensionProvider, p.pensionPin].filter(Boolean).join(" · ")] as [string, string]]
      : []),
  ];
  y += 16;
  const half = width / 2;
  for (let i = 0; i < details.length; i += 2) {
    for (const [col, [label, value]] of details.slice(i, i + 2).entries()) {
      const x = left + col * half;
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(label, x, y);
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK)
        .text(value, x, y + 11, { width: half - 16, lineBreak: false, ellipsis: true });
    }
    y += 34;
  }

  // --- Earnings and deductions, side by side ---
  y += 8;
  const colW = (width - 28) / 2;
  const lines = (title: string, items: PayLine[], total: number, totalLabel: string, x: number) => {
    let row = y;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED)
      .text(title.toUpperCase(), x, row, { characterSpacing: 1 });
    row += 18;
    const shown = items.length ? items : [{ name: "None", amount: Number.NaN }];
    for (const [i, item] of shown.entries()) {
      doc.font("Helvetica").fontSize(10.5).fillColor(Number.isNaN(item.amount) ? MUTED : INK)
        .text(item.name, x, row, { width: colW - 110, lineBreak: false, ellipsis: true });
      if (!Number.isNaN(item.amount))
        doc.text(amount(item.amount), x, row, { width: colW, align: "right" });
      row += 20;
      if (i < shown.length - 1)
        doc.moveTo(x, row - 6).lineTo(x + colW, row - 6).lineWidth(0.75).strokeColor(LINE).stroke();
    }
    doc.moveTo(x, row - 4).lineTo(x + colW, row - 4).lineWidth(1).strokeColor(LINE_STRONG).stroke();
    row += 4;
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK)
      .text(totalLabel, x, row)
      .text(amount(total), x, row, { width: colW, align: "right" });
    return row + 20;
  };
  y = Math.max(
    lines("Earnings", p.earnings, p.gross, "Gross pay", left),
    lines("Deductions", p.deductions, p.totalDeductions, "Total deductions", left + colW + 28),
  );

  // --- Net pay ---
  y += 12;
  doc.roundedRect(left, y, width, 44, 8).fillColor(SOFT).fill();
  doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text("Net pay", left + 16, y + 15);
  doc.font("Helvetica-Bold").fontSize(18)
    .text(amount(p.net), left, y + 12, { width: width - 16, align: "right" });
  y += 62;

  const extra = (text: string) => {
    doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(text, left, y, { width });
    y = doc.y + 6;
  };
  if (p.employerPension > 0)
    extra(`The company also paid ${amount(p.employerPension)} into your pension.`);
  if (p.paymentReference) extra(`Payment reference: ${p.paymentReference}`);
  if (p.note) extra(`Note: ${p.note}`);

  // --- Footer ---
  const footerY = doc.page.height - 48 - 24;
  doc.moveTo(left, footerY).lineTo(right, footerY).lineWidth(1).strokeColor(LINE).stroke();
  doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(
    `Issued by ${company} HR. This payslip was produced electronically and needs no signature. ` +
      `Downloaded ${dateOf(new Date())}.`,
    left,
    footerY + 8,
    { width, lineBreak: true },
  );

  doc.end();
  return done;
}
