const fs = require("fs");
let n = 0;
function swap(file, find, replace, label) {
  const src = fs.readFileSync(file, "utf8");
  if (src.includes(replace)) { console.log(`  = ${label}`); return; }
  if (!src.includes(find)) { console.error(`  !! ${label}: anchor not found in ${file}`); process.exit(1); }
  fs.writeFileSync(file, src.replace(find, replace));
  console.log(`  + ${label}`); n++;
}

swap("components/control-center.tsx",
  `import { MailView } from "@/components/mail-view";`,
  `import { MailView } from "@/components/mail-view";\nimport { AppsPanel } from "@/components/apps-panel";`,
  "import AppsPanel");

swap("components/control-center.tsx",
  `      <div className="brief-banner reveal delay-1">`,
  `      <AppsPanel />\n      <div className="brief-banner reveal delay-1">`,
  "render AppsPanel on Today");

const css = "app/globals.css";
if (!fs.readFileSync(css, "utf8").includes("DC-APPS")) {
  fs.appendFileSync(css, `
/* ---- DC-APPS ---- */
.apps-panel { padding: 19px 20px; margin-bottom: 16px; }
.apps-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; margin-top: 15px; }
.app-card {
  display: flex; flex-direction: column; gap: 5px; padding: 15px 16px;
  border: 1px solid var(--line); border-radius: 9px; background: var(--card);
  color: inherit; text-decoration: none;
  transition: transform .15s ease, border-color .15s ease;
}
.app-card:hover { transform: translateY(-2px); border-color: var(--coral); }
.app-card b { font-family: var(--serif); font-size: 16px; font-weight: 500; }
.app-card small { color: var(--muted); font-size: 11px; line-height: 1.5; }
.app-state { display: flex; align-items: center; gap: 6px; color: var(--muted); font-family: var(--mono); font-size: 8px; letter-spacing: .14em; text-transform: uppercase; }
.app-state i { width: 6px; height: 6px; border-radius: 50%; background: var(--line-dark); }
.app-state.state-live i { background: var(--teal); }
.app-state.state-down i { background: var(--coral); }
.app-open { display: inline-flex; align-items: center; gap: 5px; margin-top: 6px; color: var(--coral-dark); font-size: 10px; font-weight: 700; }
`);
  console.log("  + globals.css  apps panel styles"); n++;
}
console.log(`\n${n} edits applied.`);
