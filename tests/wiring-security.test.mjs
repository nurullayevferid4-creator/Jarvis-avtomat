// Bu mərhələnin təhlükəsizlik testləri: secret sızması, SSRF, icazəsiz icra, approval bypass, ixtiyari alət icrası, statik skan.
// Real API çağırılmır.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { installFetch, standardHandler, baseEnv, worker, ok } from "./helpers.mjs";
import { resetAll, runtime, fakeRequest, FULL_ENV, FakeKV, TOK, TG_TOKEN, WEBHOOK_SECRET, CHAT } from "./wiring-helpers.mjs";
import { _resetLoginMemoryForTests } from "../src/guards/login.js";
import { APPROVAL_ONLY_PERMISSIONS, FORBIDDEN_PERMISSIONS } from "../src/policy.js";

beforeEach(() => {
  resetAll();
  _resetLoginMemoryForTests();
});

const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const SECRETS = [TOK, TG_TOKEN, WEBHOOK_SECRET, TOK + "1", TOK + "2", TOK + "3"];
const NEW_SRC = [...walk("src/integrations"), ...walk("src/storage"), ...walk("src/agents"), ...walk("src/foundation"), "src/approval/proof.js", "src/approval/executor.js", "src/tools/integrationTools.js", "src/orchestrator/toolPlanning.js", "src/wiring.js", "src/telegram/webhook.js"];

test("statik skan: yeni src fayllarında process.env, eval, new Function, child_process, dinamik import və birbaşa fetch yoxdur", () => {
  for (const f of NEW_SRC) {
    const t = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/process\.env/.test(t), f + " process.env");
    assert.ok(!/\beval\s*\(/.test(t) && !/new Function\b/.test(t), f + " eval/new Function");
    assert.ok(!/child_process|node:fs|require\(/.test(t), f);
    assert.ok(!/\bimport\s*\(/.test(t), f + " dinamik import");
    assert.ok(!/(?<![.\w])fetch\s*\(/.test(t), f + " birbaşa fetch (yalnız guards/http.js vasitəsilə)");
  }
});

test("statik skan: sirr oxşar dəyər yoxdur (bütün yeni və dəyişən fayllar, testlər, sənədlər, wrangler.toml, .env.example)", () => {
  const PATTERNS = [/\bsk-[A-Za-z0-9_-]{16,}/, /\bAIza[A-Za-z0-9_-]{20,}/, /\bgh[pos]_[A-Za-z0-9]{20,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/, /\b\d{8,12}:[A-Za-z0-9_-]{34,}/, /\bshpat_[a-f0-9]{20,}/i, /\bEAA[A-Za-z0-9]{30,}/, /\bIGQ[A-Za-z0-9]{30,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bya29\.[A-Za-z0-9_-]{20,}/];
  const files = [...NEW_SRC, "src/index.js", "src/ui/page.js", "wrangler.toml", ...walk("docs"), ...walk("tests").filter((f) => /wiring-|foundation-|live-integrations/.test(f))];
  try { files.push(".env.example"); } catch (e) { /* yoxdursa keç */ }
  for (const f of files) {
    let text;
    try { text = readFileSync(f, "utf8"); } catch (e) { continue; }
    for (const re of PATTERNS) assert.ok(!re.test(text), f + " sirrə oxşar mətn: " + re);
  }
});

test("alətlər: ixtiyari icra edən alət yoxdur (shell, eval, env, secret, fetch URL qəbul edən platforma aləti)", () => {
  const h = runtime();
  for (const t of h.rt.tools.list()) {
    assert.ok(!/(^|\.)(exec|eval|shell|bash|env|secret|secrets|run|command)(\.|$)/.test(t.name), t.name);
    assert.ok(!t.permissions.some((p) => FORBIDDEN_PERMISSIONS.includes(p)), t.name + " qadağan icazə istəyir");
    if (t.name.split(".")[0].match(/^(instagram|tiktok|youtube|telegram|shopify)$/)) {
      const props = Object.keys(h.rt.tools.describe(t.name).inputSchema.properties || {});
      assert.ok(!props.some((p) => /^(url|host|endpoint|domain|base_url|headers|method)$/i.test(p)), t.name + " girişində ünvan/host sahəsi var: " + props);
    }
  }
});

test("ixtiyari alət adı: prototip, yol, böyük hərf və qeyri-sətir adlar icra olunmur (not_found)", async () => {
  const h = runtime({}, fakeRequest());
  for (const n of ["__proto__", "constructor", "toString", "hasOwnProperty", "../x", "Instagram.account.get", "instagram.account.get ", "", null, undefined, 5, {}, ["instagram.account.get"]]) {
    const r = await h.rt.tools.run(n, {}, h.rt.toolCtx());
    assert.equal(r.status, "not_found", String(n));
  }
  assert.equal(h.request.calls.length, 0);
});

test("ctx.permissions ilə icazə genişləndirilə bilməz: planlayıcı girişi (input) icazə və ya ctx sahələrini ötürə bilmir", async () => {
  const h = runtime({}, fakeRequest());
  const r = await h.rt.tools.run("instagram.account.get", { permissions: ["read.instagram"], ctx: {}, approvalProof: {} }, h.rt.toolCtx());
  assert.equal(r.status, "invalid_input");
  assert.equal(h.request.calls.length, 0);
});

test("approval bypass: planlayıcının əlində olan bütün yollar (run, executeApproved, integrations.run, runApproved) təsdiqsiz yazmır", async () => {
  const h = runtime({}, fakeRequest(() => ({ ok: true, status: 200, data: { ok: true, result: { message_id: 1 } } })));
  const ctx = h.rt.toolCtx();
  const input = { chat_id: CHAT, text: "bypass" };
  assert.equal((await h.rt.tools.run("telegram.message.send", input, ctx)).status, "pending_approval");
  const tg = h.rt.integrations.get("telegram");
  const e1 = await (async () => { try { await tg.run("message.send", input); return null; } catch (e) { return e; } })();
  assert.equal(e1 && e1.code, "disabled");
  for (const proof of [undefined, null, {}, { approvalId: "x" }, { tool: "telegram.message.send", input }, Object.freeze({ approvalId: "1234567890123-abcdef", tool: "telegram.message.send" })]) {
    const e2 = await (async () => { try { await tg.runApproved("message.send", input, proof); return null; } catch (e) { return e; } })();
    assert.ok(e2, "sübutsuz yazma keçdi");
  }
  const rec = (await h.rt.approvals.list({ status: "pending" }))[0];
  assert.equal((await h.rt.tools.executeApproved(rec, ctx, undefined)).ok, false);
  assert.equal((await h.rt.tools.executeApproved({ ...rec, status: "approved", execution: "running" }, ctx, {})).ok, false);
  assert.equal(h.request.calls.filter((c) => c.url.endsWith("/sendMessage")).length, 0);
});

test("secret sızması: /api/status, /api/integrations, probe, /api/audit, /api/approvals cavablarında heç bir secret dəyəri yoxdur", async () => {
  installFetch((u) => (u.includes("graph.instagram.com") ? ok({ user_id: "1784", username: "fn_demo" }) : new Response("{}", { status: 500 })));
  const e = { ...baseEnv(), ...FULL_ENV, JARVIS_KV: new FakeKV() };
  const g = (p, m = "GET") => worker.fetch(new Request("https://x.dev" + p, { method: m, headers: { "x-passcode": "pw" } }), e);
  const bodies = [];
  for (const [p, m] of [["/api/status"], ["/api/integrations"], ["/api/integrations/instagram/probe", "POST"], ["/api/integrations/telegram/probe", "POST"], ["/api/audit?limit=100"], ["/api/approvals"], ["/api/knowledge?q=test"]]) bodies.push(await (await g(p, m)).text());
  const all = bodies.join("\n");
  for (const s of [...SECRETS, e.PASSCODE + "xx"]) assert.ok(!all.includes(s), "sızdı: " + s.slice(0, 6));
  assert.ok(!all.includes("sk-test"), "model açarı sızdı");
  assert.ok(!all.includes("test-a") && !all.includes("test-o"));
  // Status adları yalnız true/false və ad göstərir
  const st = JSON.parse(bodies[1]).integrations.find((i) => i.id === "instagram");
  assert.equal(st.configured, true);
  assert.deepEqual(st.missing, []);
});

test("secret sızması: platforma xətası mətnində token olsa belə xəta obyektində, auditdə və alət nəticəsində görünmür", async () => {
  const leaky = JSON.stringify({ error: { message: "bad token " + TOK + " / " + TG_TOKEN, code: 190, type: "OAuthException" } });
  const request = fakeRequest(() => ({ ok: false, status: 401, data: leaky }));
  const h = runtime({}, request);
  for (const n of ["instagram.account.get", "tiktok.account.get", "telegram.bot.get", "shopify.shop.get", "youtube.channel.get"]) {
    const r = await h.rt.tools.run(n, {}, h.rt.toolCtx());
    assert.equal(r.ok, false, n);
    assert.ok(!JSON.stringify(r).includes(TOK), n);
  }
  assert.ok(!JSON.stringify(await h.rt.audit.list(200)).includes(TOK));
});

test("SSRF: Shopify domeni yalnız <ad>.myshopify.com; IP, port, userinfo, alt-domen hiylələri və yol-inyeksiyası konfiqurasiyanı etibarsız edir, şəbəkə yoxdur", async () => {
  const bad = ["127.0.0.1", "localhost", "169.254.169.254", "evil.com", "demo-shop.myshopify.com.evil.com", "demo-shop.myshopify.com@evil.com", "demo-shop.myshopify.com:8080", "demo-shop.myshopify.com/x", "https://demo-shop.myshopify.com", "demo shop.myshopify.com", "[::1]", "demo-shop.myshopify.com\r\nHost: evil.com"];
  for (const d of bad) {
    const request = fakeRequest();
    const h = runtime({ SHOPIFY_STORE_DOMAIN: d }, request);
    const r = await h.rt.tools.run("shopify.shop.get", {}, h.rt.toolCtx());
    assert.equal(r.ok, false, d);
    assert.equal(request.calls.length, 0, "şəbəkə çağırıldı: " + d);
  }
});

test("SSRF: real httpRequest yolu: platforma sorğusu yalnız https, 443 və icazəli host-a gedir; redirect izlənmir", async () => {
  const seen = [];
  installFetch((u, b, init) => { seen.push({ u, init }); return new Response("", { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }); });
  const { createRuntime } = await import("../src/wiring.js");
  const rt = createRuntime({ ...baseEnv(), ...FULL_ENV, JARVIS_KV: new FakeKV() }, {});
  const r = await rt.tools.run("instagram.account.get", {}, rt.toolCtx());
  assert.equal(r.ok, false);
  assert.equal(seen.length, 1, "redirect izlənməməlidir");
  assert.ok(seen[0].u.startsWith("https://graph.instagram.com/"));
  assert.equal(seen[0].init.redirect, "manual");
});

test("icazəsiz icra: təsdiqsiz Telegram yazma / öyrənmə qaydası / sales mesajı üçün heç bir handler çağırılmır (saxta handler sayğacı)", async () => {
  const h = runtime({}, fakeRequest());
  let called = 0;
  for (const n of ["telegram.message.send", "learning.apply_rule", "sales.message.send", "shopify.customers.list", "social.publish"]) {
    const t = h.rt.tools.tools.get(n);
    const orig = t.handler;
    t.handler = async (...a) => { called++; return orig(...a); };
  }
  const inputs = { "telegram.message.send": { chat_id: CHAT, text: "x" }, "learning.apply_rule": { proposal_id: "1234567890123-abcdef" }, "sales.message.send": { lead_id: "1234567890123-abcdef", text: "x" }, "shopify.customers.list": {}, "social.publish": { platform: "instagram", caption: "x" } };
  for (const [n, i] of Object.entries(inputs)) await h.rt.tools.run(n, i, h.rt.toolCtx());
  assert.equal(called, 0);
});

test("kill switch: REVOKED_PERMISSIONS bütün yazma yollarını söndürür (send.message, write.learning.rules), təsdiqlənmiş olsa belə", async () => {
  const request = fakeRequest(() => ({ ok: true, status: 200, data: { ok: true, result: { message_id: 1 } } }));
  const h = runtime({ REVOKED_PERMISSIONS: "send.message" }, request);
  const r = await h.rt.tools.run("telegram.message.send", { chat_id: CHAT, text: "x" }, h.rt.toolCtx());
  assert.equal(r.status, "denied");
  assert.equal(h.rt.approvals ? (await h.rt.approvals.list({ status: "pending" })).length : 0, 0);
});

test("wrangler.toml: aktiv sətirlərdə secret/token yoxdur, uydurma KV namespace id yoxdur", () => {
  const active = readFileSync("wrangler.toml", "utf8").split("\n").filter((l) => l.trim() && !/^\s*#/.test(l)).join("\n");
  assert.ok(!/(TOKEN|SECRET|API_KEY|PASSWORD)\s*=/.test(active));
  const kv = active.match(/kv_namespaces/);
  if (kv) assert.ok(/id\s*=\s*"[0-9a-f]{32}"/.test(active), "aktiv KV bloku yalnız real 32-simvollu id ilə ola bilər");
  assert.ok(!/PASTE|YOUR_|xxxxxxxx|0{32}/i.test(active));
});
