const fs = require("fs");
const f = "components/apps-panel.tsx";
let s = fs.readFileSync(f, "utf8");
const broken = /\(\(app\) => \(\n[ \t]*\n(\s*)key=\{app\.id\}/;
if (s.includes("=> (\n          <a\n")) { console.log("= already fixed"); process.exit(0); }
if (!broken.test(s)) { console.error("!! pattern not found - the file differs from expected"); process.exit(1); }
s = s.replace(broken, "((app) => (\n          <a\n$1key={app.id}");
fs.writeFileSync(f, s);
console.log("+ restored the missing <a opening tag");
