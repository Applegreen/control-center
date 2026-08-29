import nodemailer from "nodemailer";
import { configuredMailAccounts } from "./mail";

export type SendRequest = {
  accountId: string;
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
};

const DEFAULT_SMTP_PORT = 465;

// Sending is always operator-initiated. Nothing in this module is reachable
// without an authenticated request carrying an explicit message body.
export async function sendMail(request: SendRequest) {
  const account = configuredMailAccounts().find((item) => item.id === request.accountId);
  if (!account) throw new Error("That mailbox is not configured on this server.");

  const parsedPort = Number(process.env.MAIL_SMTP_PORT || DEFAULT_SMTP_PORT);
  const port = Number.isSafeInteger(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_SMTP_PORT;

  const transport = nodemailer.createTransport({
    host: account.host,
    port,
    secure: port === 465,
    auth: { user: account.user, pass: account.pass },
  });

  const info = await transport.sendMail({
    from: account.user,
    to: request.to,
    subject: request.subject,
    text: request.text,
    ...(request.inReplyTo
      ? { inReplyTo: request.inReplyTo, references: request.inReplyTo }
      : {}),
  });

  return {
    messageId: info.messageId,
    accepted: Array.isArray(info.accepted) ? info.accepted.length : 0,
  };
}
