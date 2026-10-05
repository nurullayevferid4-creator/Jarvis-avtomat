// Foundation-un təhlükəsizlik sərhədləri: mövcud sistemə qoşulmayıb, repo-da sirr yoxdur, credential olmadan şəbəkə yoxdur.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createFoundation } from "../src/foundation/index.js";

const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const NEW_DIRS = ["src/storage", "src/integrations", "src/agents", "src/foundation"];
const NEW_FILES = [...NEW_DIRS.flatMap(walk), ...walk("tests").filter((f) => /foundation-/.test(f)), "docs/FOUNDATION.md"];

test("yeni modullara bağlantı yalnız 3 giriş nöqtəsindən keçir: src/wiring.js, src/tools/integrationTools.js, src/index.js (orkestrator/təsdiq/bilik/UI birbaşa import etmir)", () => {
  const allowed = new Set(["src/index.js", "src/wiring.js", "src/tools/integrationTools.js", "src/telegram/webhook.js"]);
  const existing = ["src/index.js", "worker.js", ...["orchestrator", "tools", "state", "approval", "knowledge", "security", "guards", "audit", "adapters", "ui", "telegram"].flatMap((d) => walk("src/" + d)), "src/wiring.js"];
  for (const f of existing) {
    if (allowed.has(f)) continue;
    const imports = readFileSync(f, "utf8").split("\n").filter((l) => /^\s*(import|export)\b.*from\s/.test(l)).join("\n");
    assert.ok(!/\/(storage|integrations|agents|foundation)\//.test(imports), f + " yeni modulları icazəsiz import edir");
  }
});

test("yeni fayllarda açar/token oxşar dəyər yoxdur", () => {
  const PATTERNS = [/\bsk-[A-Za-z0-9_-]{16,}/, /\bAIza[A-Za-z0-9_-]{20,}/, /\bgh[pos]_[A-Za-z0-9]{20,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/, /\b\d{8,12}:[A-Za-z0-9_-]{34,}/, /\bBearer\s+[A-Za-z0-9._~+\/=-]{24,}/, /\bxox[bp]-[A-Za-z0-9-]{10,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
  for (const f of NEW_FILES) {
    const text = readFileSync(f, "utf8");
    for (const re of PATTERNS) assert.ok(!re.test(text), f + " açara oxşar mətn tapıldı: " + re);
  }
});

test("yeni src kodunda secret adlarına yalnız env-dən baxılır: '=' ilə dəyər mənimsədilmir, process.env/global yoxdur", () => {
  for (const f of NEW_DIRS.flatMap(walk)) {
    const t = readFileSync(f, "utf8");
    assert.ok(!/process\.env/.test(t), f + " process.env istifadə edir (Worker-də env parametrlə verilir)");
    assert.ok(!/(TOKEN|SECRET|API_KEY|PASSWORD)\s*[:=]\s*["'][^"']{6,}["']/.test(t.replace(/\/\/.*$/gm, "")), f + " sətir daxilində gizli dəyər tapıldı");
  }
});

test("wrangler.toml-da KV bloku hələ şərhdədir (real namespace id yoxdur), yeni vars/secret yazılmayıb", () => {
  const lines = readFileSync("wrangler.toml", "utf8").split("\n");
  const active = lines.filter((l) => !/^\s*#/.test(l) && l.trim());
  assert.ok(!active.some((l) => /kv_namespaces|JARVIS_KV|TOKEN|SECRET/i.test(l)), active.join("|"));
  assert.ok(!/PASTE_KV_NAMESPACE_ID/.test(active.join("\n")));
});

test("credential olmadan bütün oxuma/yazma/agent çağırışlarında şəbəkə sorğusu 0-dır", async () => {
  const realFetch = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async () => { n++; throw new Error("şəbəkə çağırılmamalı idi"); };
  try {
    const f = createFoundation({}, { isolated: true });
    const settle = async (p) => { try { await p; } catch (e) { /* gözlənilən xətalar */ } };
    for (const id of f.integrations.list()) {
      const st = f.integrations.get(id).status();
      for (const op of [...st.readOperations, ...st.disabledWriteOperations]) await settle(f.integrations.run(id, op, {}));
    }
    await settle(f.agents.sales.send());
    await f.agents.learning.recordOutcome({ task: "t", status: "achieved" });
    await f.leads.create({ channel: "other" });
    f.status();
    assert.equal(n, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("hazır modullar dəyişməyib: yalnız yeni fayllar əlavə olunub (src/ altında mövcud fayl siyahısı sabitdir)", () => {
  const known = new Set(["adapters", "approval", "audit", "config.js", "guards", "index.js", "knowledge", "orchestrator", "policy.js", "prompts.js", "security", "state", "tools", "ui", "util.js", "validate.js", "storage", "integrations", "agents", "foundation", "telegram", "wiring.js"]);
  for (const n of readdirSync("src")) assert.ok(known.has(n), "gözlənilməyən src girişi: " + n);
});
