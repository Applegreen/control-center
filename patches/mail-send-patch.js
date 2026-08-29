const fs = require("fs");
let n = 0;
function swap(file, find, replace, label) {
  const src = fs.readFileSync(file, "utf8");
  if (src.includes(replace)) { console.log(`  = ${label}`); return; }
  if (!src.includes(find)) { console.error(`  !! ${label}: anchor not found in ${file}`); process.exit(1); }
  fs.writeFileSync(file, src.replace(find, replace));
  console.log(`  + ${label}`); n++;
}

swap("lib/server/mail.ts",
  "  subject: string;\n  date: string;",
  "  subject: string;\n  messageId: string;\n  date: string;",
  "mail.ts  MailMessage.messageId");

swap("lib/server/mail.ts",
  `          subject: envelope?.subject || "(no subject)",`,
  `          subject: envelope?.subject || "(no subject)",\n          messageId: envelope?.messageId || "",`,
  "mail.ts  populate messageId (reply threading)");

const css = "app/globals.css";
if (!fs.readFileSync(css, "utf8").includes("DC-MAIL-SEND")) {
  fs.appendFileSync(css, `
/* ---- DC-MAIL-SEND ---- */
.mail-actions { display: flex; align-items: center; gap: 9px; }
.mail-row-actions { flex: none; display: flex; align-items: center; gap: 12px; }
.mail-composer { display: flex; flex-direction: column; gap: 7px; margin-bottom: 16px; }
.mail-composer-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.mail-composer label { color: var(--muted); font-family: var(--mono); font-size: 9px; letter-spacing: .12em; text-transform: uppercase; }
.mail-composer input, .mail-composer select, .mail-composer textarea {
  width: 100%; padding: 10px 11px; border: 1px solid var(--line-dark); border-radius: 7px;
  color: var(--ink); background: var(--card); font-family: inherit; font-size: 13px;
}
.mail-composer textarea { resize: vertical; line-height: 1.55; }
.mail-composer .button { align-self: flex-start; margin-top: 8px; }
`);
  console.log("  + globals.css  composer styles"); n++;
}
console.log(`\n${n} edits applied.`);
