const fs = require("fs");
const f = "components/mail-view.tsx";
let src = fs.readFileSync(f, "utf8");
let n = 0;
function swap(find, replace, label) {
  if (src.includes(replace)) { console.log(`  = ${label}`); return; }
  if (!src.includes(find)) { console.error(`  !! ${label}: anchor not found`); process.exit(1); }
  src = src.replace(find, replace); console.log(`  + ${label}`); n++;
}

swap(`  return (\n    <>\n      <div className="page-heading reveal">`,
     `  return (\n    <div className="view">\n      <div className="page-heading reveal">`,
     "wrap in .view (page width + padding)");

swap(`      </section>\n    </>\n  );`,
     `      </section>\n    </div>\n  );`,
     "close .view wrapper");

swap(`className="primary-button"`, `className="button button-primary"`, "real button classes");

swap(`        <div className="source-grid reveal">
          {data.accounts.map((summary) => (
            <section className="panel" key={summary.id}>
              <b>
                <Mail size={14} /> {summary.label}
              </b>
              <p>
                <small>{summary.user}</small>
              </p>
              <p>
                {summary.ok ? \`\${summary.unread} unread of \${summary.count}\` : "Unavailable"}
              </p>
            </section>
          ))}
        </div>`,
`        <div className="source-status-grid reveal">
          {data.accounts.map((summary) => (
            <div
              className={\`source-status \${summary.ok ? "" : "status-changed"}\`}
              key={summary.id}
            >
              <span>
                <Mail size={13} />
                <b>{summary.label}</b>
              </span>
              <span>{summary.ok ? \`\${summary.unread} unread\` : "Unavailable"}</span>
              <p>
                {summary.user}
                {summary.ok ? \` · \${summary.count} recent\` : ""}
              </p>
            </div>
          ))}
        </div>`,
     "mailbox cards use the real grid");

swap(`        <div className="reveal" style={{ margin: "18px 0" }}>\n          <label htmlFor="mail-account-filter">Mailbox&nbsp;</label>`,
     `        <div className="feed-sort-bar reveal">\n          <label htmlFor="mail-account-filter">Mailbox</label>`,
     "filter bar matches other views");

fs.writeFileSync(f, src);
console.log(`\n${n} edits applied.`);
