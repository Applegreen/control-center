import {
  createContact,
  createLead,
  listCompanies,
  listContacts,
  listLeads,
} from "@/lib/server/crm-db";
import type { ContactInput, LeadInput } from "@/lib/server/crm-db";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json({
      leads: listLeads(),
      contacts: listContacts(),
      companies: listCompanies(),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not read the pipeline." },
      { status: 500 },
    );
  }
}

/**
 * Creates either a lead or a contact, depending on `type`.
 *
 * Leads carrying a sourceUrl are deduplicated in the store, so promoting the
 * same collected item twice returns the existing lead rather than a duplicate.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    // `type` selects the record; the rest of the body is the record's own fields.
    // Both create functions validate and coerce every field they read, so an
    // unchecked cast here cannot put bad data in the database.
    const { type, ...fields } = body;

    if (type === "contact") {
      return Response.json(
        { contact: createContact(fields as ContactInput) },
        { status: 201 },
      );
    }

    return Response.json({ lead: createLead(fields as LeadInput) }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not create." },
      { status: 400 },
    );
  }
}
