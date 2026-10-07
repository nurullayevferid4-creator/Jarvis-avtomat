// Statik audit: istehsal kodunda (src/, worker.js) yarımçıq iş izləri və saxta uğur nümunələri axtarır.
// Testlər, sənədlər və bu skript yoxlanmır. Tapıntı olarsa çıxış kodu 1.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MARKERS = [
  [/\b(TODO|FIXME|XXX|HACK)\b/, "yarımçıq iş izi"],
  [/\b(STUB|PLACEHOLDER)\b/, "stub/placeholder"],
  [/not[ _]implemented/i, "həyata keçirilməyib izi"],
  [/\b(mock|fake)[A-Za-z]*\s*[:=(]/i, "mock/fake istifadəsi"],
  [/Math\.random\(\)\s*[<>]\s*0?\.\d+\s*\?\s*["']?(ok|success|done)/i, "təsadüfi uğur"],
  [/(sk-ant-|sk-proj-)[A-Za-z0-9_-]{20,}|shpat_[a-f0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/, "sirr nümunəsi"],
  [/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//, "hardcoded lokal ünvan"],
  [/\bchat_id\s*[:=]\s*-?\d{5,}/, "hardcoded chat_id"],
];
const allow = [/src\/security\/ssrf\.js$/]; // SSRF qoruması localhost sözünü qadağan siyahısında saxlayır
const files = [];
function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(m?js)$/.test(n)) files.push(p);
  }
}
walk(join(ROOT, "src"));
files.push(join(ROOT, "worker.js"));
let found = 0;
for (const f of files) {
  const rel = relative(ROOT, f);
  if (allow.some((a) => a.test(rel))) continue;
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    for (const [re, why] of MARKERS) {
      if (re.test(line)) { found++; console.error(rel + ":" + (i + 1) + " [" + why + "] " + line.trim().slice(0, 120)); }
    }
  });
}
console.log(files.length + " fayl yoxlandı, " + found + " tapıntı.");
process.exit(found ? 1 : 0);
