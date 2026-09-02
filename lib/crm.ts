// Shared types for leads and contacts. No server imports - used by the API
// routes and the browser UI alike.

export type LeadStage =
  | "new"
  | "qualifying"
  | "pitching"
  | "proposal"
  | "won"
  | "lost"
  | "parked";

export const LEAD_STAGES: LeadStage[] = [
  "new",
  "qualifying",
  "pitching",
  "proposal",
  "won",
  "lost",
  "parked",
];

/** Stages that still need attention. Won, lost and parked drop out of the pipeline. */
export const ACTIVE_STAGES: LeadStage[] = ["new", "qualifying", "pitching", "proposal"];

export type LeadKind =
  | "animation"
  | "graphic-design"
  | "motion-graphics"
  | "web-design"
  | "vfx"
  | "other";

export const LEAD_KINDS: LeadKind[] = [
  "animation",
  "graphic-design",
  "motion-graphics",
  "web-design",
  "vfx",
  "other",
];

export type LeadSource =
  | "tender"
  | "funding-call"
  | "industry-news"
  | "agency-brief"
  | "referral"
  | "event"
  | "inbound"
  | "manual";

export const LEAD_SOURCES: LeadSource[] = [
  "tender",
  "funding-call",
  "industry-news",
  "agency-brief",
  "referral",
  "event",
  "inbound",
  "manual",
];

export type Contact = {
  id: string;
  name: string;
  role: string;
  company: string;
  email: string;
  phone: string;
  linkedin: string;
  /** Where this person came from - a conference, a referral, a public listing. */
  origin: string;
  notes: string;
  /** POPIA: recorded so outreach can be justified. See consentNote below. */
  consent: ContactConsent;
  createdAt: string;
  updatedAt: string;
};

/**
 * POPIA section 69 restricts unsolicited direct marketing. Recording how a
 * contact came to be on the list is what makes later outreach defensible, so
 * it is a required field rather than an optional note.
 */
export type ContactConsent =
  | "unknown"
  | "public-listing"
  | "met-in-person"
  | "referred"
  | "opted-in"
  | "existing-client"
  | "do-not-contact";

export const CONTACT_CONSENT: ContactConsent[] = [
  "unknown",
  "public-listing",
  "met-in-person",
  "referred",
  "opted-in",
  "existing-client",
  "do-not-contact",
];

export type Lead = {
  id: string;
  title: string;
  company: string;
  kind: LeadKind;
  stage: LeadStage;
  source: LeadSource;
  /** Where it came from, if it was promoted from a collected item. */
  sourceUrl: string;
  description: string;
  /** Integer cents, same convention as proposals. Zero when unknown. */
  estimatedValue: number;
  currency: string;
  /** ISO date. The submission or response deadline, when there is one. */
  dueDate: string;
  nextAction: string;
  nextActionDate: string;
  notes: string;
  contactIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type LeadSummaryRow = Omit<Lead, "notes" | "description"> & {
  contactCount: number;
};

// ---------- labels ----------

export function stageLabel(stage: LeadStage) {
  return {
    new: "New",
    qualifying: "Qualifying",
    pitching: "Pitching",
    proposal: "Proposal out",
    won: "Won",
    lost: "Lost",
    parked: "Parked",
  }[stage];
}

export function kindLabel(kind: LeadKind) {
  return {
    animation: "Animation",
    "graphic-design": "Graphic design",
    "motion-graphics": "Motion graphics",
    "web-design": "Web design",
    vfx: "Visual effects",
    other: "Other",
  }[kind];
}

export function sourceLabel(source: LeadSource) {
  return {
    tender: "Tender",
    "funding-call": "Funding call",
    "industry-news": "Industry news",
    "agency-brief": "Agency brief",
    referral: "Referral",
    event: "Event",
    inbound: "Inbound enquiry",
    manual: "Added by hand",
  }[source];
}

export function consentLabel(consent: ContactConsent) {
  return {
    unknown: "Not recorded",
    "public-listing": "Public business listing",
    "met-in-person": "Met in person",
    referred: "Referred by someone",
    "opted-in": "Opted in",
    "existing-client": "Existing client",
    "do-not-contact": "Do not contact",
  }[consent];
}

/** Plain-language explanation shown in the UI next to the consent field. */
export const consentNote =
  "POPIA restricts unsolicited direct marketing to people who have not consented and are " +
  "not existing customers. Recording how someone came onto this list is what makes later " +
  "contact defensible. 'Do not contact' hides them from outreach views entirely.";

// ---------- maths and sorting ----------

export function isActive(stage: LeadStage) {
  return (ACTIVE_STAGES as string[]).includes(stage);
}

export function pipelineValue(leads: { stage: LeadStage; estimatedValue: number }[]) {
  return leads
    .filter((lead) => isActive(lead.stage))
    .reduce((sum, lead) => sum + (Number(lead.estimatedValue) || 0), 0);
}

export function wonValue(leads: { stage: LeadStage; estimatedValue: number }[]) {
  return leads
    .filter((lead) => lead.stage === "won")
    .reduce((sum, lead) => sum + (Number(lead.estimatedValue) || 0), 0);
}

/** Group leads by stage, in pipeline order, skipping empty closed stages. */
export function groupByStage<T extends { stage: LeadStage }>(leads: T[]) {
  return LEAD_STAGES.map((stage) => ({
    stage,
    leads: leads.filter((lead) => lead.stage === stage),
  })).filter((group) => group.leads.length > 0 || isActive(group.stage));
}

/** Soonest deadline first; undated last. Mirrors the Minutes tab's behaviour. */
export function byDeadline<T extends { dueDate: string }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });
}
