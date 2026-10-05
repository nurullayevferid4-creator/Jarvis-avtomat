// Telefon təsdiq paneli: səhifə mövcud autentifikasiyadan (parol) istifadə edir, məlumat textContent ilə yazılır, təsdiq/rədd API-ya gedir.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installFetch, standardHandler, baseEnv, worker } from "./helpers.mjs";
import { resetAll, FULL_ENV, FakeKV, CHAT, TG_TOKEN, WEBHOOK_SECRET } from "./wiring-helpers.mjs";
import { _resetLoginMemoryForTests } from "../src/guards/login.js";

beforeEach(() => {
  resetAll();
  _resetLoginMemoryForTests();
});

const env = (extra = {}) => ({ ...baseEnv(), ...FULL_ENV, JARVIS_KV: new FakeKV(), ...extra });
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const api = (path, e, { method = "GET", body, pass = "pw" } = {}) =>
  worker.fetch(new Request("https://x.dev" + path, { method, headers: { ...(pass === null ? {} : { "x-passcode-b64": b64(pass) }), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), e);

async function page() {
  const r = await worker.fetch(new Request("https://x.dev/"), env());
  return await r.text();
}

test("səhifədə Təsdiqlər paneli var: siyahı, təsdiq et / rədd et düymələri, risk və icazə məlumatı, təfərrüat", async () => {
  const html = await page();
  assert.ok(html.includes('id="aprs"') && html.includes('id="al"'));
  for (const s of ["Təsdiq et", "Rədd et", "risk: ", "İcazələr: ", "Təfərrüat", "/api/approvals"]) assert.ok(html.includes(s), s);
});

test("panel mövcud autentifikasiyadan istifadə edir: bütün /api/approvals sorğuları authHeaders() ilə gedir, parol səhifəyə yazılmır", async () => {
  const html = await page();
  const calls = html.match(/fetch\("\/api\/approvals[^)]*\)?/g) || [];
  assert.ok(calls.length >= 2, "oxuma və qərar sorğuları olmalıdır");
  const script = html.slice(html.indexOf("<script"));
  assert.ok(/fetch\("\/api\/approvals\?status=pending",\{headers:authHeaders\(\)/.test(script));
  assert.ok(/h=authHeaders\(\);h\["content-type"\]/.test(script));
  assert.ok(!html.includes("pw"), "test parolu səhifədə olmamalıdır");
});

test("approvals paneli innerHTML istifadə etmir: etibarsız mətn (alət girişi, təsviri) yalnız textContent ilə yazılır", async () => {
  const html = await page();
  const a = html.indexOf("function decide(");
  const b = html.indexOf("$(\"aprs\").addEventListener");
  assert.ok(a > 0 && b > a);
  const block = html.slice(a, b);
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(block));
  assert.ok(/el\("pre","in"/.test(block));
});

test("səhifənin skripti sintaksis baxımından düzgündür", async () => {
  const html = await page();
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, "skript yoxdur");
  assert.doesNotThrow(() => new Function(m[1]));
});

test("təsdiq paneli API-sı parolsuz işləmir (401), səhv parolla da", async () => {
  installFetch(standardHandler({ plan: { mode: "chat", reply: "ok" } }));
  const e = env();
  for (const [path, method] of [["/api/approvals", "GET"], ["/api/approvals/abc", "POST"], ["/api/integrations", "GET"], ["/api/integrations/telegram/probe", "POST"]]) {
    // 401; təkrarlanan səhv cəhdlərdən sonra mövcud brute-force qoruması 429 verir. İkisi də "icazə yoxdur" deməkdir.
    for (const pass of [null, "yanlis"]) {
      const st = (await api(path, e, { method, pass, body: method === "POST" ? { decision: "approve" } : undefined })).status;
      assert.ok(st === 401 || st === 429, path + " -> " + st);
    }
  }
});

test("API axını (UI-nın etdiyi): gözləyən siyahı -> təsdiq -> icra nəticəsi -> siyahıdan çıxır; rədd -> icra yoxdur", async () => {
  const sent = [];
  installFetch((u, body) => {
    if (u.startsWith("https://api.telegram.org/")) { sent.push({ u, body }); return new Response(JSON.stringify({ ok: true, result: { message_id: 3 } }), { status: 200 }); }
    return new Response("unexpected", { status: 500 });
  });
  const e = env();
  const { createRuntime } = await import("../src/wiring.js");
  const rt = createRuntime(e, {});
  const a = await rt.tools.run("telegram.message.send", { chat_id: CHAT, text: "birinci" }, rt.toolCtx());
  const b = await rt.tools.run("telegram.message.send", { chat_id: CHAT, text: "ikinci" }, rt.toolCtx());
  const list = await (await api("/api/approvals?status=pending", e)).json();
  assert.equal(list.approvals.length, 2);
  const view = list.approvals.find((x) => x.id === a.approval_id);
  assert.equal(view.risk, "high");
  assert.deepEqual(view.input, { chat_id: CHAT, text: "birinci" });
  assert.ok(view.tool_info && view.tool_info.permissions.includes("send.message"));
  assert.equal(sent.length, 0, "siyahı göstərmək heç nə göndərmir");

  const rej = await (await api("/api/approvals/" + b.approval_id, e, { method: "POST", body: { decision: "reject" } })).json();
  assert.equal(rej.record.status, "rejected");
  assert.equal(sent.length, 0, "rədd edilən göndərilmir");

  const res = await api("/api/approvals/" + a.approval_id, e, { method: "POST", body: { decision: "approve" } });
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.execution.ok, true, JSON.stringify(d));
  assert.equal(d.execution.status, "done");
  assert.equal(sent.length, 1);
  assert.equal(String(sent[0].body.chat_id), CHAT);
  assert.equal(sent[0].body.text, "birinci");
  assert.equal((await (await api("/api/approvals?status=pending", e)).json()).approvals.length, 0);
  // təkrar təsdiq olunmur, təkrar icra olmur
  assert.equal((await api("/api/approvals/" + a.approval_id, e, { method: "POST", body: { decision: "approve" } })).status, 409);
  assert.equal(sent.length, 1);
  const raw = JSON.stringify(d) + JSON.stringify(list);
  for (const s of [TG_TOKEN, WEBHOOK_SECRET]) assert.ok(!raw.includes(s));
});

test("API: yanlış qərar dəyəri və naməlum id rədd olunur, icra olmur", async () => {
  const sent = [];
  installFetch((u) => { sent.push(u); return new Response("{}", { status: 200 }); });
  const e = env();
  const { createRuntime } = await import("../src/wiring.js");
  const rt = createRuntime(e, {});
  const a = await rt.tools.run("telegram.message.send", { chat_id: CHAT, text: "x" }, rt.toolCtx());
  const bad = await api("/api/approvals/" + a.approval_id, e, { method: "POST", body: { decision: "evet" } });
  assert.ok(bad.status >= 400);
  assert.equal((await api("/api/approvals/yoxdur", e, { method: "POST", body: { decision: "approve" } })).status, 404);
  assert.equal(sent.length, 0);
});
