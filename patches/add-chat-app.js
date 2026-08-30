const fs = require("fs");
const f = "lib/apps.ts";
let s = fs.readFileSync(f, "utf8");
if (s.includes('id: "chat"')) { console.log("= already listed"); process.exit(0); }
const anchor = `    check: "http://127.0.0.1:8012",\n  },\n];`;
if (!s.includes(anchor)) { console.error("!! anchor not found in lib/apps.ts"); process.exit(1); }
s = s.replace(anchor, `    check: "http://127.0.0.1:8012",
  },
  {
    id: "chat",
    name: "Open WebUI",
    description: "Chat with the local model, with visible reasoning",
    href: "https://chat.digitalcharacters.africa",
    check: "http://127.0.0.1:8090",
  },
];`);
fs.writeFileSync(f, s);
console.log("+ Open WebUI added to the Apps panel");
