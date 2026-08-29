import { ImapFlow } from "imapflow";
import { configuredMailAccounts } from "./mail";

// Messages are moved to the account's Trash folder, never expunged. Recovery
// stays possible from any mail client. Operator-initiated only.
export async function moveMessageToTrash(accountId: string, uid: number) {
  const account = configuredMailAccounts().find((item) => item.id === accountId);
  if (!account) throw new Error("That mailbox is not configured on this server.");
  if (!Number.isSafeInteger(uid) || uid <= 0) throw new Error("Invalid message reference.");

  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: true,
    auth: { user: account.user, pass: account.pass },
    logger: false,
  });

  await client.connect();
  try {
    const boxes = await client.list();
    const trash =
      boxes.find((box) => box.specialUse === "\\Trash") ||
      boxes.find((box) => /^(inbox[./])?trash$/i.test(box.path)) ||
      boxes.find((box) => /trash|deleted/i.test(box.path));
    if (!trash) throw new Error("No Trash folder was found on this mailbox.");

    const lock = await client.getMailboxLock("INBOX");
    try {
      const moved = await client.messageMove(String(uid), trash.path, { uid: true });
      if (!moved) throw new Error("The server refused to move that message.");
      return { movedTo: trash.path };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}
