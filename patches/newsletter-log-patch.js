const fs = require("fs");
const f = "lib/server/newsletter-collector.ts";
const OLD = `  const failedMessages = messageResults.filter((result) => result.status === "rejected").length;`;
const NEW = `  const failedMessages = messageResults.filter((result) => result.status === "rejected").length;
  for (const result of messageResults) {
    if (result.status === "rejected") {
      const reason = result.reason;
      console.error("[newsletter-deferred]", reason instanceof Error ? reason.message : String(reason));
    }
  }`;
const src = fs.readFileSync(f, "utf8");
if (src.includes(NEW)) { console.log("= already applied"); process.exit(0); }
if (!src.includes(OLD)) { console.error("!! anchor not found in " + f); process.exit(1); }
fs.writeFileSync(f, src.replace(OLD, NEW));
console.log("+ newsletter deferrals now logged");
