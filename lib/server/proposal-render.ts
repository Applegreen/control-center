import "server-only";

import {
  formatMoney,
  formatProposalDate,
  kindLabel,
  lineTotal,
  proposalTotals,
  visibleItems,
  type Proposal,
} from "@/lib/proposals";

// Three renderers over one content model. All are pure JavaScript - no headless Chromium.
// That is a deliberate trade: Chromium would reproduce the HTML pixel for pixel, but it
// wants 300-500MB of RAM per render on a box that has roughly 2.3GB free with swap
// already in use. These libraries lay the document out programmatically instead, so the
// PDF is clean and correct but not identical to the web version.

import path from "node:path";
import { readFileSync } from "node:fs";

export const STUDIO = {
  name: "Digital Characters",
  tagline: "Animation · Visual effects · Post production",
  // Kept in step with the address published on digitalcharacters.africa and in
  // the site's Organization schema. One address everywhere.
  address: ["The Media Mill", "7 Quince Street", "Mill Park", "Johannesburg, 2092"],
  email: "info@digitalcharacters.africa",
  phone: "071 595 4780",
  whatsapp: "076 320 0950",
  site: "digitalcharacters.africa",
  registration: "2014/164830/07",
  // Set DC_VAT_NUMBER in /etc/control-center.env. Left blank, the VAT line is
  // simply omitted rather than printing an empty label on a client document.
  vat: (process.env.DC_VAT_NUMBER || "").trim(),
};

const LOGO_PATH = path.join(process.cwd(), "public", "dc-letterhead-logo.png");

let logoCache: Buffer | null | undefined;

/** Reads the letterhead logo once. Returns null if it is missing, so a document
 *  still renders (without the mark) rather than failing outright. */
export function letterheadLogo(): Buffer | null {
  if (logoCache === undefined) {
    try {
      logoCache = readFileSync(LOGO_PATH);
    } catch {
      logoCache = null;
    }
  }
  return logoCache;
}

export function studioAddressLines() {
  return [...STUDIO.address];
}

export function studioIdentityLines() {
  return [
    `Reg: ${STUDIO.registration}`,
    ...(STUDIO.vat ? [`VAT: ${STUDIO.vat}`] : []),
  ];
}

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

    // ---- Letterhead: logo | studio + document | client ----
    const TOP = 46;
    const logoW = 118;
    const colStudioX = left + logoW + 34;
    const colStudioW = 150;
    const colClientX = colStudioX + colStudioW + 26;
    const colClientW = right - colClientX;

    const logo = letterheadLogo();
    let leftBottom = TOP;
    if (logo) {
      doc.image(logo, left, TOP, { width: logoW });
      leftBottom = TOP + logoW * (307 / 400) + 8;
    } else {
      doc.fillColor(CORAL).font("Helvetica-Bold").fontSize(11)
        .text(STUDIO.name.toUpperCase(), left, TOP, { width: logoW, characterSpacing: 1.5 });
      leftBottom = doc.y + 6;
    }
    doc.font("Helvetica-Bold").fontSize(7).fillColor(INK);
    studioIdentityLines().forEach((line) => {
      doc.text(line, left, leftBottom, { width: logoW });
      leftBottom = doc.y;
    });

    // middle column
    doc.font("Helvetica").fontSize(9).fillColor(MUTED);
    let studioY = TOP;
    studioAddressLines().forEach((line) => {
      doc.text(line, colStudioX, studioY, { width: colStudioW });
      studioY = doc.y;
    });
    studioY += 10;
    const docLines: [string, string][] = [
      [`${kindLabel(proposal.kind)}:`, proposal.number],
      ["ISSUE DATE:", formatProposalDate(proposal.createdAt)],
    ];
    if (proposal.validUntil) docLines.push(["VALID UNTIL:", formatProposalDate(proposal.validUntil)]);
    docLines.forEach(([label, value]) => {
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(INK)
        .text(label, colStudioX, studioY, { width: colStudioW, continued: true });
      doc.font("Helvetica").fillColor(MUTED).text(` ${value}`);
      studioY = doc.y + 1;
    });

    // right column
    let clientY = TOP;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK)
      .text("To:", colClientX, clientY, { width: colClientW });
    clientY = doc.y + 1;
    if (proposal.clientName) {
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK)
        .text(proposal.clientName, colClientX, clientY, { width: colClientW });
      clientY = doc.y;
    }
    doc.font("Helvetica").fontSize(9).fillColor(MUTED);
    if (proposal.clientContact) {
      doc.text(proposal.clientContact, colClientX, clientY, { width: colClientW });
      clientY = doc.y;
    }
    (proposal.clientAddress || "").split("\n").filter((l) => l.trim()).forEach((line) => {
      doc.text(line.trim(), colClientX, clientY, { width: colClientW });
      clientY = doc.y;
    });

    // rule beneath the tallest column
    const ruleY = Math.max(leftBottom, studioY, clientY) + 16;
    doc.moveTo(left, ruleY).lineTo(right, ruleY).lineWidth(1).strokeColor(CORAL).stroke();
    doc.lineWidth(1);
    doc.y = ruleY + 26;

    doc.fillColor(INK).font("Helvetica-Bold").fontSize(22)
      .text(proposal.projectTitle || documentTitle(proposal), left, doc.y, { width });

    if (proposal.summary) {
      doc.moveDown(0.7);
      doc.fillColor(INK).font("Helvetica").fontSize(11)
        .text(proposal.summary, left, doc.y, { width, lineGap: 3 });
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
    const printableItems = visibleItems(proposal.items);
  if (printableItems.length) {
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

      for (const item of printableItems) {
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
        `${STUDIO.name} (Reg ${STUDIO.registration}${STUDIO.vat ? ` · VAT ${STUDIO.vat}` : ""}) · ` +
          `${STUDIO.email} · ${STUDIO.phone} · WhatsApp ${STUDIO.whatsapp} · ${STUDIO.site}`,
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
    WidthType, AlignmentType, BorderStyle, ImageRun,
  } = await import("docx");
  const totals = proposalTotals(proposal);

  const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const allOpen = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
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
  const small = (text: string, opts: { bold?: boolean; color?: string; size?: number } = {}) =>
    new Paragraph({
      children: [
        new TextRun({ text, bold: opts.bold, color: opts.color ?? "6B6960", size: opts.size ?? 17 }),
      ],
    });

  // Letterhead: logo | studio + document details | client. Borderless table so
  // Word keeps the three columns side by side the way the printed version does.
  const logo = letterheadLogo();
  const logoCell: InstanceType<typeof Paragraph>[] = logo
    ? [
        new Paragraph({
          children: [
            new ImageRun({
              type: "png",
              data: logo,
              transformation: { width: 118, height: 91 },
            }),
          ],
        }),
      ]
    : [small(STUDIO.name.toUpperCase(), { bold: true, color: "E65F45", size: 20 })];
  for (const line of studioIdentityLines()) {
    logoCell.push(small(line, { bold: true, color: "1A1A1D", size: 13 }));
  }

  const middleCell = [
    ...studioAddressLines().map((line) => small(line)),
    small(""),
    small(`${kindLabel(proposal.kind)}: ${proposal.number}`, { bold: true, color: "1A1A1D" }),
    small(`ISSUE DATE: ${formatProposalDate(proposal.createdAt)}`, { color: "1A1A1D" }),
    ...(proposal.validUntil
      ? [small(`VALID UNTIL: ${formatProposalDate(proposal.validUntil)}`, { color: "1A1A1D" })]
      : []),
  ];

  const clientCell = [
    small("To:", { bold: true, color: "1A1A1D" }),
    ...(proposal.clientName ? [small(proposal.clientName, { bold: true, color: "1A1A1D", size: 19 })] : []),
    ...(proposal.clientContact ? [small(proposal.clientContact)] : []),
    ...(proposal.clientAddress || "")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => small(line.trim())),
  ];

  const openCell = (paragraphs: InstanceType<typeof Paragraph>[], width: number) =>
    new TableCell({ borders: allOpen, width: { size: width, type: WidthType.PERCENTAGE }, children: paragraphs });

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { ...allOpen, insideHorizontal: noBorder, insideVertical: noBorder },
      rows: [
        new TableRow({
          children: [openCell(logoCell, 26), openCell(middleCell, 37), openCell(clientCell, 37)],
        }),
      ],
    }),
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: "E65F45" } },
      children: [new TextRun({ text: "" })],
    }),
    new Paragraph({ text: "" }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: proposal.projectTitle || documentTitle(proposal), bold: true, size: 40 })],
    }),
  ];

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

  const printableItems = visibleItems(proposal.items);
  if (printableItems.length) {
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
      ...printableItems.map(
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
          text:
            `${STUDIO.name} (Reg ${STUDIO.registration}${STUDIO.vat ? ` · VAT ${STUDIO.vat}` : ""}) · ` +
            `${STUDIO.email} · ${STUDIO.phone} · WhatsApp ${STUDIO.whatsapp} · ${STUDIO.site}`,
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
  const logo = letterheadLogo();
  const logoData = logo ? `image/png;base64,${logo.toString("base64")}` : null;

  const title = deck.addSlide();
  title.background = { color: dark };
  if (logoData) {
    title.addImage({ data: logoData, x: 0.6, y: 0.45, w: 1.5, h: 1.15 });
  } else {
    title.addText(STUDIO.name.toUpperCase(), {
      x: 0.6, y: 0.5, w: 8.8, h: 0.3, color: coral, fontSize: 11, bold: true, charSpacing: 2,
    });
  }
  title.addText(proposal.projectTitle || documentTitle(proposal), {
    x: 0.6, y: 1.9, w: 8.8, h: 1.4, color: cream, fontSize: 38, bold: true,
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
  const printableItems = visibleItems(proposal.items);
  if (printableItems.length) {
    const slide = deck.addSlide();
    slide.addText("Investment", { x: 0.6, y: 0.4, w: 8.8, h: 0.4, color: coral, fontSize: 12, bold: true, charSpacing: 1.5 });
    const header = ["Description", "Qty", "Unit", "Rate", "Amount"].map((text) => ({
      text,
      options: { bold: true, color: "6B6960", fontSize: 10 },
    }));
    const body = printableItems.map((item) => [
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
    [
      STUDIO.email,
      STUDIO.phone,
      `WhatsApp ${STUDIO.whatsapp}`,
      STUDIO.site,
      "",
      ...studioAddressLines(),
      "",
      ...studioIdentityLines(),
    ].join("\n"),
    { x: 0.6, y: 2.9, w: 8.8, h: 2.2, color: "8A8880", fontSize: 11, lineSpacingMultiple: 1.25 },
  );

  const output = (await deck.write({ outputType: "nodebuffer" })) as Buffer;
  return output;
}
