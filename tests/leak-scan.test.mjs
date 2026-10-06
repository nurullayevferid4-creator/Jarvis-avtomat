// Repo-da gizli açara oxşar mətn olmamalıdır (repo açıqdır). Sadə naxış axtarışıdır:
// tam zəmanət vermir, amma tipik sızmaları tutur.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SKIP = new Set(["node_modules", ".git", ".wrangler"]);
const PATTERNS = [
  ["Anthropic/OpenAI açarı", /sk-(ant-)?[A-Za-z0-9_-]{20,}/],
  ["Google API açarı", /AIza[0-9A-Za-z_-]{30,}/],
  ["Meta/Instagram token", /\bEAA[A-Za-z0-9]{40,}/],
  ["Telegram bot tokeni", /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/],
  ["Google OAuth sirri", /GOCSPX-[A-Za-z0-9_-]{20,}/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["Bearer tokeni", /Bearer\s+[A-Za-z0-9._-]{30,}/],
  ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.size < 400000 && !/\.(png|jpg|jpeg|gif|ico|woff2?|lock)$/i.test(n)) out.push(p);
  }
  return out;
}

test("repo-da gizli açara oxşar mətn yoxdur", () => {
  const hits = [];
  for (const f of walk(ROOT)) {
    const txt = readFileSync(f, "utf8");
    for (const [name, re] of PATTERNS) {
      const g = new RegExp(re.source, "g");
      for (const m of txt.matchAll(g)) {
        if (/test|example|fake|dummy|gizli|placeholder/i.test(m[0])) continue; // açıq-aydın saxta test dəyərləri
        hits.push(f.replace(ROOT, "") + " → " + name);
      }
    }
  }
  assert.deepEqual(hits, []);
});

test("sosial kod platforma tokenini log-a/cavaba yazmır (redact yoxlaması)", async () => {
  const { redact } = await import("../src/audit/log.js");
  const r = redact({ access_token: "abc", refresh_token: "def", client_secret: "x", ok: 1 });
  assert.equal(r.access_token, "[gizlədildi]");
  assert.equal(r.refresh_token, "[gizlədildi]");
  assert.equal(r.client_secret, "[gizlədildi]");
  assert.equal(r.ok, 1);
});
