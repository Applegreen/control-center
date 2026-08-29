const fs = require("fs");
const f = "lib/server/gmail.ts";
const OLD = `  if (!response.ok) throw new Error(\`Gmail API returned \${response.status}.\`);`;
const NEW = `  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.text();
      const parsed = JSON.parse(body) as { error?: { status?: string; message?: string } };
      detail = [parsed.error?.status, parsed.error?.message].filter(Boolean).join(": ")
        || body.slice(0, 300);
    } catch { /* non-JSON body */ }
    throw new Error(\`Gmail API returned \${response.status}.\${detail ? \` \${detail}\` : ""}\`);
  }`;
const src = fs.readFileSync(f, "utf8");
if (src.includes(NEW)) { console.log("= already applied"); process.exit(0); }
if (!src.includes(OLD)) { console.error("!! anchor not found in " + f); process.exit(1); }
fs.writeFileSync(f, src.replace(OLD, NEW));
console.log("+ gmail.ts now reports Google's error reason");
