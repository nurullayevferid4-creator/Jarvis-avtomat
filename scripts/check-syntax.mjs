// Asılılıqsız "lint": bütün .js/.mjs fayllarının sintaksisini `node --check` ilə yoxlayır.
// (Layihədə TypeScript və ya ESLint yoxdur; tip yoxlaması tətbiq olunmur.)
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const SKIP = new Set(["node_modules", ".git", ".wrangler"]);
const files = [];
(function walk(dir) {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(m?js)$/.test(n)) files.push(p);
  }
})(ROOT);

let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
  if (r.status !== 0) {
    bad++;
    console.error("SINTAKSİS XƏTASI: " + f.replace(ROOT, "") + "\n" + r.stderr);
  }
}
console.log(files.length + " fayl yoxlandı, " + bad + " xəta.");
process.exit(bad ? 1 : 0);
