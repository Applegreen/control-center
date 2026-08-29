import { configuredMailAccounts, fetchRecentMail, publicMailAccount } from "@/lib/server/mail";
import type { MailMessage } from "@/lib/server/mail";

export const runtime = "nodejs";

export async function GET() {
  const accounts = configuredMailAccounts();
  const checkedAt = new Date().toISOString();
  if (!accounts.length)
    return Response.json({ configured: false, checkedAt, accounts: [], items: [], errors: [] });

  const items: MailMessage[] = [];
  const errors: string[] = [];
  const summary = [];

  for (const account of accounts) {
    try {
      const messages = await fetchRecentMail(account, 25);
      items.push(...messages);
      summary.push({
        ...publicMailAccount(account),
        count: messages.length,
        unread: messages.filter((message) => message.unread).length,
        ok: true,
      });
    } catch (error) {
      errors.push(`${account.label}: ${error instanceof Error ? error.message : "unknown error"}`);
      summary.push({ ...publicMailAccount(account), count: 0, unread: 0, ok: false });
    }
  }

  items.sort((left, right) => right.date.localeCompare(left.date));
  return Response.json({ configured: true, checkedAt, accounts: summary, items: items.slice(0, 100), errors });
}
