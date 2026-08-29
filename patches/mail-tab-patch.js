const fs = require("fs");
let applied = 0, skipped = 0;
function edit(file, find, replace, label) {
  const src = fs.readFileSync(file, "utf8");
  if (src.includes(replace)) { console.log(`  = ${label}`); skipped++; return; }
  if (!src.includes(find)) { console.error(`\n  !! ${label}: anchor not found in ${file}\n`); process.exit(1); }
  fs.writeFileSync(file, src.replace(find, replace));
  console.log(`  + ${label}`); applied++;
}

edit("components/control-center.tsx",
  `import { useRouter } from "next/navigation";`,
  `import { useRouter } from "next/navigation";\nimport { MailView } from "@/components/mail-view";`,
  "import MailView");

edit("components/control-center.tsx",
  `  | "newsletters"\n  | "tasks"`,
  `  | "newsletters"\n  | "mail"\n  | "tasks"`,
  "Tab union");

edit("components/control-center.tsx",
  `  { id: "newsletters", label: "Newsletters", icon: Newspaper },`,
  `  { id: "newsletters", label: "Newsletters", icon: Newspaper },\n  { id: "mail", label: "Email", icon: Mail },`,
  "nav entry");

edit("components/control-center.tsx",
  `        {activeTab === "tasks" && (`,
  `        {activeTab === "mail" && <MailView />}{" "}\n        {activeTab === "tasks" && (`,
  "view block");

const css = "app/globals.css";
if (!fs.readFileSync(css, "utf8").includes("DC-MAIL")) {
  fs.appendFileSync(css, `
/* ---- DC-MAIL ---- */
.mail-row {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 14px;
  padding: 12px 0; border-bottom: 1px solid var(--line);
}
.mail-row:last-child { border-bottom: 0; }
.mail-row p { margin: 4px 0 0; }
.mail-unread {
  flex: none; font-family: var(--mono); font-size: 9px; letter-spacing: .12em;
  padding: 3px 7px; border-radius: 999px; background: var(--coral); color: #fff;
}
`);
  console.log("  + globals.css mail styles"); applied++;
}

console.log(`\n${applied} applied, ${skipped} already in place.`);
