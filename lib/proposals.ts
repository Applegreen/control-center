// Shared proposal types and money maths. No server imports here - this file is used by
// the API routes, the export renderers and the browser UI alike.
//
// Money is stored as integer cents throughout. Animation quotes run to six figures and
// get multiplied by fractional quantities (2.5 days, 7.5 minutes); floating point rands
// would accumulate rounding errors that show up as a total that does not match the sum
// of its own line items. Integers make that impossible.

export type ProposalKind = "proposal" | "quote";

export type ProposalStatus = "draft" | "sent" | "accepted" | "declined";

export const PROPOSAL_KINDS: ProposalKind[] = ["proposal", "quote"];

export const PROPOSAL_STATUSES: ProposalStatus[] = [
  "draft",
  "sent",
  "accepted",
  "declined",
];

export const PROPOSAL_UNITS = [
  "minute",
  "second",
  "episode",
  "day",
  "week",
  "month",
  "shot",
  "asset",
  "item",
  "lump sum",
] as const;

export type ProposalItem = {
  id: string;
  position: number;
  description: string;
  detail: string;
  /** May be fractional, e.g. 2.5 days or 7.5 finished minutes. */
  quantity: number;
  unit: string;
  /** Integer cents. */
  unitRate: number;
};

export type ProposalSection = {
  id: string;
  position: number;
  heading: string;
  body: string;
};

export type Proposal = {
  id: string;
  /** Random, unguessable; used for the shareable link. */
  token: string;
  kind: ProposalKind;
  number: string;
  status: ProposalStatus;
  clientName: string;
  clientContact: string;
  clientEmail: string;
  /** Multi-line postal address, shown in the "To:" block of the letterhead. */
  clientAddress: string;
  projectTitle: string;
  summary: string;
  currency: string;
  /** Percent, e.g. 15 for South African VAT. */
  vatRate: number;
  /** Percent. */
  discountRate: number;
  validUntil: string;
  terms: string;
  createdAt: string;
  updatedAt: string;
  sentAt: string;
  sections: ProposalSection[];
  items: ProposalItem[];
};

export type RateCardEntry = {
  id: string;
  category: string;
  description: string;
  unit: string;
  /** Integer cents. */
  defaultRate: number;
};

export type ProposalTotals = {
  subtotal: number;
  discount: number;
  net: number;
  vat: number;
  total: number;
};

export type ProposalSummary = Pick<
  Proposal,
  | "id"
  | "token"
  | "kind"
  | "number"
  | "status"
  | "clientName"
  | "projectTitle"
  | "currency"
  | "validUntil"
  | "createdAt"
  | "updatedAt"
  | "sentAt"
> & { total: number; itemCount: number };

// ---------- maths ----------

export function lineTotal(item: Pick<ProposalItem, "quantity" | "unitRate">) {
  return Math.round((Number(item.quantity) || 0) * (Number(item.unitRate) || 0));
}

export function proposalTotals(
  proposal: Pick<Proposal, "items" | "vatRate" | "discountRate">,
): ProposalTotals {
  const subtotal = (proposal.items || []).reduce(
    (sum, item) => sum + lineTotal(item),
    0,
  );
  const discount = Math.round((subtotal * (Number(proposal.discountRate) || 0)) / 100);
  const net = subtotal - discount;
  const vat = Math.round((net * (Number(proposal.vatRate) || 0)) / 100);
  return { subtotal, discount, net, vat, total: net + vat };
}

// ---------- formatting ----------

export function formatMoney(cents: number, currency = "ZAR") {
  const amount = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** "R 12 500.00" -> 1250000. Tolerant of spaces, commas and currency symbols. */
export function parseMoneyToCents(value: string | number) {
  if (typeof value === "number") return Math.round(value * 100);
  const cleaned = String(value ?? "")
    .replace(/[^\d.,-]/g, "")
    .replace(/\s/g, "");
  if (!cleaned) return 0;
  // Treat the last separator as the decimal point, whichever it is.
  const normalized = cleaned.replace(/,(\d{1,2})$/, ".$1").replace(/,/g, "");
  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

export function formatProposalDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function proposalIsExpired(proposal: Pick<Proposal, "validUntil">, now = new Date()) {
  if (!proposal.validUntil) return false;
  const date = new Date(proposal.validUntil);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() < now.getTime();
}

export function statusLabel(status: ProposalStatus) {
  return { draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Declined" }[status];
}

export function kindLabel(kind: ProposalKind) {
  return kind === "quote" ? "Quotation" : "Proposal";
}

// ---------- defaults ----------

export const DEFAULT_TERMS = [
  "50% deposit is payable on acceptance of this quotation, with the balance due on delivery of the final approved materials.",
  "Quoted amounts exclude third-party licensing, stock footage, music licensing and talent fees unless itemised above.",
  "Two rounds of revisions are included per deliverable. Further revisions are billed at the applicable hourly rate.",
  "Digital Characters retains the right to feature completed work in its showreel and marketing materials unless otherwise agreed in writing.",
  "Payment terms are 30 days from invoice date.",
].join("\n");

/** Narrative sections a new proposal starts with. The operator edits or deletes them. */
export const DEFAULT_SECTIONS: { heading: string; body: string }[] = [
  {
    heading: "Introduction",
    body:
      "Founded in 2014, Digital Characters is one of South Africa's few black-owned animation studios. " +
      "Our service offering spans 2D and 3D animation production, visual effects and graphic sequences, " +
      "post production, audio production and final mixing, editing, graphic design, directing and concept design.",
  },
  {
    heading: "Understanding of the brief",
    body: "",
  },
  {
    heading: "Our approach",
    body: "",
  },
  {
    heading: "Deliverables and schedule",
    body: "",
  },
  {
    heading: "Why Digital Characters",
    body:
      "Digital Characters was awarded an NFVF Animation Slate in conjunction with the DTI, IDC and the " +
      "Gauteng Film Commission, covering a number of television series and a feature film. The studio has " +
      "delivered visual effects for Muvhango (SABC 2) and Ingozi (SABC 1), and produced the Kronikles of " +
      "Hip Hop web series broadcast on MTV Base and e.tv.",
  },
];
