const fs = require("fs");
let n = 0;
function swap(file, find, replace, label, all) {
  const src = fs.readFileSync(file, "utf8");
  if (src.includes(replace)) { console.log(`  = ${label}`); return; }
  if (!src.includes(find)) { console.error(`  !! ${label}: anchor not found in ${file}`); process.exit(1); }
  fs.writeFileSync(file, all ? src.split(find).join(replace) : src.replace(find, replace));
  console.log(`  + ${label}`); n++;
}

const view = "components/mail-view.tsx";

swap(view,
  `      <section className="panel reveal">\n        {loading && !data ? <p>Opening mailboxes…</p> : null}`,
  `      <section className="panel reveal mail-list">\n        {loading && !data ? <p>Opening mailboxes…</p> : null}`,
  "message list gets its own class");

swap(view, `className="panel reveal"`, `className="panel reveal mail-panel"`,
  "info panels get padding class", true);

const css = "app/globals.css";
if (!fs.readFileSync(css, "utf8").includes("DC-MAIL-POLISH")) {
  fs.appendFileSync(css, `
/* ---- DC-MAIL-POLISH ---- */
.mail-panel { padding: 17px 19px; }
.mail-panel p { margin: 0; }
.mail-panel p + p { margin-top: 7px; }
.mail-list { padding: 2px 0; }
.mail-composer { padding: 20px; }

.mail-row { padding: 15px 19px; gap: 18px; transition: background .15s ease; }
.mail-row:hover { background: var(--deep-hover); }
.mail-row > div { min-width: 0; }
.mail-row b { font-family: var(--serif); font-size: 15px; font-weight: 500; }
.mail-row small { color: var(--muted); font-size: 10px; }
.mail-row p { margin: 5px 0 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
.mail-row-actions { gap: 14px; padding-left: 6px; }
.mail-row-actions .text-button { opacity: .55; transition: opacity .15s ease; }
.mail-row:hover .mail-row-actions .text-button { opacity: 1; }
`);
  console.log("  + globals.css  spacing and hover polish"); n++;
}
console.log(`\n${n} edits applied.`);
