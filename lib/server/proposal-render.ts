import "server-only";

import {
  formatMoney,
  formatProposalDate,
  kindLabel,
  lineTotal,
  proposalTotals,
  type Proposal,
} from "@/lib/proposals";

// Three renderers over one content model. All are pure JavaScript - no headless Chromium.
// That is a deliberate trade: Chromium would reproduce the HTML pixel for pixel, but it
// wants 300-500MB of RAM per render on a box that has roughly 2.3GB free with swap
// already in use. These libraries lay the document out programmatically instead, so the
// PDF is clean and correct but not identical to the web version.

export const STUDIO = {
  name: "Digital Characters",
  tagline: "Animation · Visual effects · Post production",
  address: ["The Media Mill", "7 Quince Street", "Mill Park", "Johannesburg, 2092"],
  email: "info@digitalcharacters.africa",
  phone: "076 320 0950",
  site: "digitalcharacters.africa",
};

const CORAL = "#E65F45";
const INK = "#1A1A1D";
const MUTED = "#6B6960";

function documentTitle(proposal: Proposal) {
  return `${kindLabel(proposal.kind)} ${proposal.number}`;
}

export function exportFilename(proposal: Proposal, extension: string) {
  const client = (proposal.clientName || "client").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
  return `${proposal.number}-${client || "client"}.${extension}`.toLowerCase();
}

// ---------------------------------------------------------------- PDF

export async function renderProposalPdf(proposal: Proposal): Promise<Buffer> {
  const { default: PDFDocument } = await import("pdfkit");
  const totals = proposalTotals(proposal);

  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56, info: { Title: documentTitle(proposal) } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    // Header
    doc.fillColor(CORAL).font("Helvetica-Bold").fontSize(9)
      .text(STUDIO.name.toUpperCase(), left, 48, { characterSpacing: 2 });
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(STUDIO.tagline, { characterSpacing: 0.4 });

    doc.moveDown(1.6);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(24)
      .text(proposal.projectTitle || documentTitle(proposal), { width });
    doc.fillColor(MUTED).font("Helvetica").fontSize(9)
      .text(`${kindLabel(proposal.kind)} ${proposal.number}`);

    const meta = [
      proposal.clientName ? `Prepared for: ${proposal.clientName}` : "",
      proposal.clientContact ? `Attention: ${proposal.clientContact}` : "",
      `Date: ${formatProposalDate(proposal.createdAt)}`,
      proposal.validUntil ? `Valid until: ${formatProposalDate(proposal.validUntil)}` : "",
    ].filter(Boolean);
    doc.moveDown(0.5);
    meta.forEach((line) => doc.fillColor(MUTED).fontSize(9).text(line));

    if (proposal.summary) {
      doc.moveDown(1);
      doc.fillColor(INK).font("Helvetica").fontSize(11).text(proposal.summary, { width, lineGap: 3 });
    }

    // Narrative
    for (const section of proposal.sections) {
      if (!section.heading && !section.body) continue;
      doc.moveDown(1.4);
      if (doc.y > doc.page.height - 160) doc.addPage();
      if (section.heading) {
        doc.fillColor(CORAL).font("Helvetica-Bold").fontSize(8)
          .text(section.heading.toUpperCase(), { characterSpacing: 1.4 });
        doc.moveDown(0.4);
      }
      if (section.body) {
        doc.fillColor(INK).font("Helvetica").fontSize(10).text(section.body, { width, lineGap: 3 });
      }
    }

    // Line items
    if (proposal.items.length) {
      doc.moveDown(1.6);
      if (doc.y > doc.page.height - 220) doc.addPage();
      doc.fillColor(CORAL).font("Helvetica-Bold").fontSize(8)
        .text("INVESTMENT", { characterSpacing: 1.4 });
      doc.moveDown(0.6);

      // Explicit, non-overlapping column geometry. pdfkit does not clip text to a
      // column, so any overlap in these numbers prints one value on top of another -
      // every column's x + width must be <= the next column's x.
      const AMOUNT_W = 84;
      const RATE_W = 74;
      const UNIT_W = 48;
      const QTY_W = 34;
      const GAP = 7;
      const amountX = right - AMOUNT_W;
      const rateX = amountX - GAP - RATE_W;
      const unitX = rateX - GAP - UNIT_W;
      const qtyX = unitX - GAP - QTY_W;
      const descW = qtyX - GAP - left;
      const cols = { desc: left, qty: qtyX, unit: unitX, rate: rateX, amount: amountX };

      const headerY = doc.y;
      doc.fontSize(8).fillColor(MUTED);
      doc.text("Description", cols.desc, headerY, { width: descW });
      doc.text("Qty", cols.qty, headerY, { width: QTY_W, align: "right" });
      doc.text("Unit", cols.unit, headerY, { width: UNIT_W });
      doc.text("Rate", cols.rate, headerY, { width: RATE_W, align: "right" });
      doc.text("Amount", cols.amount, headerY, { width: AMOUNT_W, align: "right" });

      doc.y = headerY + 12;
      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor("#DDD8CE").stroke();
      doc.y += 8;

      for (const item of proposal.items) {
        if (doc.y > doc.page.height - 150) doc.addPage();
        const rowY = doc.y;
        doc.fillColor(INK).font("Helvetica-Bold").fontSize(9)
          .text(item.description || "—", cols.desc, rowY, { width: descW });
        const afterDescription = doc.y;

        doc.font("Helvetica").fontSize(9);
        doc.fillColor(INK).text(String(item.quantity), cols.qty, rowY, { width: QTY_W, align: "right" });
        doc.fillColor(MUTED).text(item.unit, cols.unit, rowY, { width: UNIT_W });
        doc.fillColor(INK).text(formatMoney(item.unitRate, proposal.currency), cols.rate, rowY, { width: RATE_W, align: "right" });
        doc.font("Helvetica-Bold")
          .text(formatMoney(lineTotal(item), proposal.currency), cols.amount, rowY, { width: AMOUNT_W, align: "right" });

        // Put the cursor back below the description before writing the detail line,
        // otherwise the right-hand columns dictate where the next row starts.
        doc.y = afterDescription;
        if (item.detail) {
          doc.font("Helvetica").fontSize(8).fillColor(MUTED)
            .text(item.detail, cols.desc, doc.y + 1, { width: descW });
        }
        doc.y += 8;
      }

      // Totals
      doc.moveTo(cols.qty, doc.y).lineTo(right, doc.y).strokeColor("#DDD8CE").stroke();
      doc.y += 8;
      const labelX = cols.desc;
      const labelW = rateX + RATE_W - labelX;
      const totalRow = (label: string, value: string, bold = false) => {
        const y = doc.y;
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9)
          .fillColor(bold ? INK : MUTED)
          .text(label, labelX, y, { width: labelW, align: "right" });
        doc.fillColor(bold ? CORAL : INK)
          .text(value, cols.amount, y, { width: AMOUNT_W, align: "right" });
        doc.y = y + (bold ? 18 : 14);
      };
      totalRow("Subtotal", formatMoney(totals.subtotal, proposal.currency));
      if (totals.discount > 0) totalRow("Discount", `-${formatMoney(totals.discount, proposal.currency)}`);
      totalRow(`VAT (${proposal.vatRate}%)`, formatMoney(totals.vat, proposal.currency));
      totalRow("Total", formatMoney(totals.total, proposal.currency), true);
    }

    // Terms
    if (proposal.terms) {
      doc.moveDown(1.4);
      if (doc.y > doc.page.height - 180) doc.addPage();
      doc.fillColor(CORAL).font("Helvetica-Bold").fontSize(8)
        .text("TERMS", left, doc.y, { characterSpacing: 1.4 });
      doc.moveDown(0.4);
      doc.fillColor(MUTED).font("Helvetica").fontSize(8.5)
        .text(proposal.terms, { width, lineGap: 2.5 });
    }

    // Footer on every page
    const range = doc.bufferedPageRange();
    for (let index = 0; index < range.count; index += 1) {
      doc.switchToPage(range.start + index);
      doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(
        `${STUDIO.name} · ${STUDIO.email} · ${STUDIO.phone} · ${STUDIO.site}`,
        left,
        doc.page.height - 46,
        { width, align: "center" },
      );
    }

    doc.end();
  });
}

// ---------------------------------------------------------------- Word

export async function renderProposalDocx(proposal: Proposal): Promise<Buffer> {
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
    WidthType, AlignmentType, BorderStyle,
  } = await import("docx");
  const totals = proposalTotals(proposal);

  const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const cell = (text: string, opts: { bold?: boolean; align?: "left" | "right" } = {}) =>
    new TableCell({
      borders: { top: noBorder, bottom: { style: BorderStyle.SINGLE, size: 1, color: "DDD8CE" }, left: noBorder, right: noBorder },
      children: [
        new Paragraph({
          alignment: opts.align === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [new TextRun({ text, bold: opts.bold, size: 19 })],
        }),
      ],
    });

  // Body blocks are a mix of paragraphs and one table, so the array holds both.
  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Paragraph({
      children: [new TextRun({ text: STUDIO.name.toUpperCase(), bold: true, color: "E65F45", size: 18 })],
    }),
    new Paragraph({ children: [new TextRun({ text: STUDIO.tagline, color: "6B6960", size: 16 })] }),
    new Paragraph({ text: "" }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: proposal.projectTitle || documentTitle(proposal), bold: true, size: 44 })],
    }),
    new Paragraph({
      children: [new TextRun({ text: `${kindLabel(proposal.kind)} ${proposal.number}`, color: "6B6960", size: 18 })],
    }),
  ];

  const meta = [
    proposal.clientName ? `Prepared for: ${proposal.clientName}` : "",
    proposal.clientContact ? `Attention: ${proposal.clientContact}` : "",
    `Date: ${formatProposalDate(proposal.createdAt)}`,
    proposal.validUntil ? `Valid until: ${formatProposalDate(proposal.validUntil)}` : "",
  ].filter(Boolean);
  for (const line of meta) {
    children.push(new Paragraph({ children: [new TextRun({ text: line, color: "6B6960", size: 18 })] }));
  }

  if (proposal.summary) {
    children.push(new Paragraph({ text: "" }));
    children.push(new Paragraph({ children: [new TextRun({ text: proposal.summary, size: 22 })] }));
  }

  for (const section of proposal.sections) {
    if (!section.heading && !section.body) continue;
    children.push(new Paragraph({ text: "" }));
    if (section.heading) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: section.heading, bold: true, color: "E65F45", size: 24 })],
        }),
      );
    }
    for (const line of (section.body || "").split("\n").filter(Boolean)) {
      children.push(new Paragraph({ children: [new TextRun({ text: line, size: 21 })] }));
    }
  }

  if (proposal.items.length) {
    children.push(new Paragraph({ text: "" }));
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: "Investment", bold: true, color: "E65F45", size: 24 })],
      }),
    );
    const rows = [
      new TableRow({
        children: [
          cell("Description", { bold: true }),
          cell("Qty", { bold: true, align: "right" }),
          cell("Unit", { bold: true }),
          cell("Rate", { bold: true, align: "right" }),
          cell("Amount", { bold: true, align: "right" }),
        ],
      }),
      ...proposal.items.map(
        (item) =>
          new TableRow({
            children: [
              cell(item.detail ? `${item.description}\n${item.detail}` : item.description || "—"),
              cell(String(item.quantity), { align: "right" }),
              cell(item.unit),
              cell(formatMoney(item.unitRate, proposal.currency), { align: "right" }),
              cell(formatMoney(lineTotal(item), proposal.currency), { align: "right", bold: true }),
            ],
          }),
      ),
    ];
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));

    const totalLine = (label: string, value: string, bold = false) =>
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: `${label}   ${value}`, bold, size: bold ? 24 : 20 })],
      });
    children.push(new Paragraph({ text: "" }));
    children.push(totalLine("Subtotal", formatMoney(totals.subtotal, proposal.currency)));
    if (totals.discount > 0) children.push(totalLine("Discount", `-${formatMoney(totals.discount, proposal.currency)}`));
    children.push(totalLine(`VAT (${proposal.vatRate}%)`, formatMoney(totals.vat, proposal.currency)));
    children.push(totalLine("Total", formatMoney(totals.total, proposal.currency), true));
  }

  if (proposal.terms) {
    children.push(new Paragraph({ text: "" }));
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: "Terms", bold: true, color: "E65F45", size: 24 })],
      }),
    );
    for (const line of proposal.terms.split("\n").filter(Boolean)) {
      children.push(new Paragraph({ children: [new TextRun({ text: line, size: 18, color: "6B6960" })] }));
    }
  }

  children.push(new Paragraph({ text: "" }));
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `${STUDIO.name} · ${STUDIO.email} · ${STUDIO.phone} · ${STUDIO.site}`,
          color: "6B6960",
          size: 15,
        }),
      ],
    }),
  );

  const document = new Document({ sections: [{ children: children as never[] }] });
  return await Packer.toBuffer(document);
}

// ---------------------------------------------------------------- PowerPoint

export async function renderProposalPptx(proposal: Proposal): Promise<Buffer> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const totals = proposalTotals(proposal);
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_16x9";
  deck.author = STUDIO.name;
  deck.title = documentTitle(proposal);

  const dark = "141417";
  const coral = "E65F45";
  const cream = "F6F4EF";

  // Title slide
  const title = deck.addSlide();
  title.background = { color: dark };
  title.addText(STUDIO.name.toUpperCase(), {
    x: 0.6, y: 0.5, w: 8.8, h: 0.3, color: coral, fontSize: 11, bold: true, charSpacing: 2,
  });
  title.addText(proposal.projectTitle || documentTitle(proposal), {
    x: 0.6, y: 1.6, w: 8.8, h: 1.6, color: cream, fontSize: 40, bold: true,
  });
  title.addText(
    [
      `${kindLabel(proposal.kind)} ${proposal.number}`,
      proposal.clientName ? `Prepared for ${proposal.clientName}` : "",
      formatProposalDate(proposal.createdAt),
    ].filter(Boolean).join("   ·   "),
    { x: 0.6, y: 3.4, w: 8.8, h: 0.4, color: "8A8880", fontSize: 13 },
  );

  if (proposal.summary) {
    const overview = deck.addSlide();
    overview.addText("Overview", { x: 0.6, y: 0.5, w: 8.8, h: 0.4, color: coral, fontSize: 12, bold: true, charSpacing: 1.5 });
    overview.addText(proposal.summary, { x: 0.6, y: 1.1, w: 8.8, h: 3.5, fontSize: 18, color: "1A1A1D", valign: "top" });
  }

  // One slide per narrative section that has content
  for (const section of proposal.sections) {
    if (!section.body?.trim()) continue;
    const slide = deck.addSlide();
    slide.addText(section.heading || "", {
      x: 0.6, y: 0.5, w: 8.8, h: 0.4, color: coral, fontSize: 12, bold: true, charSpacing: 1.5,
    });
    const bullets = section.body.split("\n").filter((line) => line.trim());
    slide.addText(
      bullets.map((line) => ({ text: line, options: { bullet: bullets.length > 1, breakLine: true } })),
      { x: 0.6, y: 1.1, w: 8.8, h: 3.9, fontSize: 15, color: "1A1A1D", valign: "top", lineSpacingMultiple: 1.3 },
    );
  }

  // Investment slide
  if (proposal.items.length) {
    const slide = deck.addSlide();
    slide.addText("Investment", { x: 0.6, y: 0.4, w: 8.8, h: 0.4, color: coral, fontSize: 12, bold: true, charSpacing: 1.5 });
    const header = ["Description", "Qty", "Unit", "Rate", "Amount"].map((text) => ({
      text,
      options: { bold: true, color: "6B6960", fontSize: 10 },
    }));
    const body = proposal.items.map((item) => [
      { text: item.description || "—", options: { fontSize: 10 } },
      { text: String(item.quantity), options: { fontSize: 10, align: "right" as const } },
      { text: item.unit, options: { fontSize: 10 } },
      { text: formatMoney(item.unitRate, proposal.currency), options: { fontSize: 10, align: "right" as const } },
      { text: formatMoney(lineTotal(item), proposal.currency), options: { fontSize: 10, bold: true, align: "right" as const } },
    ]);
    slide.addTable([header, ...body], {
      x: 0.6, y: 1.0, w: 8.8, colW: [4.0, 0.9, 1.1, 1.4, 1.4],
      border: { type: "solid", color: "DDD8CE", pt: 0.5 },
      autoPage: true,
    });
    slide.addText(`Total   ${formatMoney(totals.total, proposal.currency)}`, {
      x: 0.6, y: 4.7, w: 8.8, h: 0.4, align: "right", fontSize: 16, bold: true, color: coral,
    });
  }

  // Closing
  const closing = deck.addSlide();
  closing.background = { color: dark };
  closing.addText("Thank you", { x: 0.6, y: 1.8, w: 8.8, h: 0.9, color: cream, fontSize: 34, bold: true });
  closing.addText(
    [STUDIO.email, STUDIO.phone, STUDIO.site, ...STUDIO.address].join("\n"),
    { x: 0.6, y: 2.9, w: 8.8, h: 1.8, color: "8A8880", fontSize: 12, lineSpacingMultiple: 1.3 },
  );

  const output = (await deck.write({ outputType: "nodebuffer" })) as Buffer;
  return output;
}
