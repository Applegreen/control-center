const fs = require("fs");
let applied = 0, skipped = 0;

function edit(file, find, replace, label) {
  const src = fs.readFileSync(file, "utf8");
  if (src.includes(replace)) { console.log(`  = ${label}`); skipped++; return; }
  if (!src.includes(find)) {
    console.error(`\n  !! ${label}: anchor not found in ${file}\n`);
    process.exit(1);
  }
  fs.writeFileSync(file, src.replace(find, replace));
  console.log(`  + ${label}`);
  applied++;
}

const OLD = `  const redirectUri = new URL("/api/auth/google/callback", request.url).toString();`;
const NEW = `  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const publicScheme = forwardedProto || request.nextUrl.protocol.replace(":", "");
  const publicHost = request.headers.get("host") || request.nextUrl.host;
  const redirectUri = new URL("/api/auth/google/callback", \`\${publicScheme}://\${publicHost}\`).toString();`;

console.log("Making the Google OAuth redirect URI proxy-aware...\n");

edit("app/api/auth/google/start/route.ts", OLD, NEW, "start/route.ts  redirect_uri");
edit("app/api/auth/google/callback/route.ts", OLD, NEW, "callback/route.ts  redirect_uri");

edit("app/api/auth/google/start/route.ts",
  `secure: request.nextUrl.protocol === "https:"`,
  `secure: publicScheme === "https"`,
  "start/route.ts  state cookie Secure flag");

console.log(`\n${applied} applied, ${skipped} already in place.`);
