import { ImapFlow } from "imapflow";

export type MailAccount = {
  id: string;
  label: string;
  user: string;
  host: string;
  port: number;
};

type MailAccountWithSecret = MailAccount & { pass: string };

export type MailMessage = {
  accountId: string;
  accountLabel: string;
  uid: number;
  from: string;
  fromName: string;
  subject: string;
  date: string;
  unread: boolean;
  flagged: boolean;
};

const MAX_ACCOUNTS = 5;
const DEFAULT_PORT = 993;

// Mailbox credentials come from /etc/control-center.env (root-only), never the
// settings database. Nothing here is ever returned to the browser.
export function configuredMailAccounts(): MailAccountWithSecret[] {
  const host = (process.env.MAIL_HOST || "").trim();
  if (!host) return [];
  const parsedPort = Number(process.env.MAIL_PORT || DEFAULT_PORT);
  const port = Number.isSafeInteger(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT;
  const accounts: MailAccountWithSecret[] = [];
  for (let index = 1; index <= MAX_ACCOUNTS; index += 1) {
    const user = (process.env[`MAIL_USER_${index}`] || "").trim();
    const pass = process.env[`MAIL_PASS_${index}`] || "";
    if (!user || !pass) continue;
    const label = (process.env[`MAIL_LABEL_${index}`] || user.split("@")[0] || user).trim();
    accounts.push({ id: `mail-${index}`, label, user, pass, host, port });
  }
  return accounts;
}

export function publicMailAccount(account: MailAccountWithSecret): MailAccount {
  return { id: account.id, label: account.label, user: account.user, host: account.host, port: account.port };
}

export async function fetchRecentMail(
  account: MailAccountWithSecret,
  limit = 25,
): Promise<MailMessage[]> {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: true,
    auth: { user: account.user, pass: account.pass },
    logger: false,
  });
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox;
      const total = mailbox && typeof mailbox !== "boolean" ? mailbox.exists : 0;
      if (!total) return [];
      const first = Math.max(1, total - limit + 1);
      const messages: MailMessage[] = [];
      for await (const message of client.fetch(
        `${first}:*`,
        { envelope: true, flags: true, uid: true },
      )) {
        const envelope = message.envelope;
        const sender = envelope?.from?.[0];
        const flags = message.flags instanceof Set ? message.flags : new Set<string>();
        messages.push({
          accountId: account.id,
          accountLabel: account.label,
          uid: message.uid,
          from: sender?.address || "",
          fromName: sender?.name || sender?.address || "Unknown sender",
          subject: envelope?.subject || "(no subject)",
          date: (envelope?.date || new Date()).toISOString(),
          unread: !flags.has("\\Seen"),
          flagged: flags.has("\\Flagged"),
        });
      }
      return messages.reverse();
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}
