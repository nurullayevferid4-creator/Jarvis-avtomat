// İnteqrasiya: Worker marşrutları + alət reyestri + təsdiq + ActionRunner + orkestrator "tools" rejimi.
// Real API yoxdur: fetch saxtadır. Shopify QOŞULMAYIB halı real davranışı yoxlayır (saxta uğur olmamalıdır).
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { _resetMemoryForTests } from "../src/state/store.js";
import { resetSharedCoordinatorForTests } from "../src/coord/coordinator.js";
import { installFetch, standardHandler, baseEnv, worker, talk, claudeText } from "./helpers.mjs";

beforeEach(() => { _resetMemoryForTests(); resetSharedCoordinatorForTests(); });

let ip = 0;
const call = (env, path, { method = "GET", body, pass = "pw" } = {}) =>
  worker.fetch(new Request("https://x.dev" + path, { method, headers: { "x-passcode": pass, "content-type": "application/json", "cf-connecting-ip": "8.8.8." + ++ip }, body: body === undefined ? undefined : JSON.stringify(body) }), { ...baseEnv(), ...env });

test("alət API: parolsuz 401; naməlum alət 404; səhv giriş 400", async () => {
  installFetch(() => new Response("x", { status: 500 }));
  assert.equal((await call(baseEnv(), "/api/tools/run", { method: "POST", body: { tool: "web.fetch", input: {} }, pass: "yox" })).status, 401);
  assert.equal((await call(baseEnv(), "/api/tools/run", { method: "POST", body: { tool: "yoxdur.alet", input: {} } })).status, 404);
  assert.equal((await call(baseEnv(), "/api/tools/run", { method: "POST", body: { tool: "shopify.product.prepare", input: { bad: 1 } } })).status, 400);
  assert.equal((await call(baseEnv(), "/api/tools/run", { method: "POST", body: {} })).status, 400);
});

test("alət API: product.prepare və marketinq planı model olmadan işləyir; şablon açıq işarələnir", async () => {
  installFetch(() => new Response("x", { status: 500 }));
  const p = await (await call({}, "/api/tools/run", { method: "POST", body: { tool: "shopify.product.prepare", input: { name: "Ətir Nümunə", price: 49 } } })).json();
  assert.equal(p.status, "done");
  assert.ok(p.output.title);
  const m = await call({}, "/api/tools/run", { method: "POST", body: { tool: "marketing.campaign.plan", input: { brand: "qr_menu", platforms: ["instagram"] } } });
  const mj = await m.json();
  assert.equal(m.status, 200, JSON.stringify(mj).slice(0, 300));
  assert.equal(mj.output.source, "template", "model açarı işləməyəndə şablon olduğu görünməlidir");
});

test("Shopify yazma aləti: icra olunmur, təsdiq qeydi açılır; təsdiqdən sonra qoşulmayıb olduğu üçün UĞURSUZ olur (saxta uğur yoxdur)", async () => {
  const calls = installFetch(() => new Response("x", { status: 500 }));
  const prep = await (await call({}, "/api/tools/run", { method: "POST", body: { tool: "shopify.product.prepare", input: { name: "Test Məhsul", price: 10, description: "Təsvir" } } })).json();
  const r = await call({}, "/api/tools/run", { method: "POST", body: { tool: "shopify.product.create", input: { draft: prep.output, status: "DRAFT" } } });
  const rj = await r.json();
  if (r.status !== 202) assert.fail("gözlənilən 202, gəldi " + r.status + " " + JSON.stringify(rj).slice(0, 400));
  assert.equal(rj.status, "pending_approval");
  assert.equal(calls.length, 0, "təsdiqdən əvvəl heç bir şəbəkə çağırışı olmamalıdır");
  const ap = await (await call({}, "/api/approvals/" + rj.approval_id, { method: "POST", body: { decision: "approve" } })).json();
  assert.notEqual(ap.status, "done");
  assert.ok(["failed", "unknown", "blocked"].includes(ap.status), JSON.stringify(ap).slice(0, 300));
  const again = await call({}, "/api/approvals/" + rj.approval_id, { method: "POST", body: { decision: "approve" } });
  assert.equal(again.status, 409, "ikinci təsdiq/icra qəbul edilmir");
});

test("Shopify webhook: imzasız/səhv imzalı sorğu rədd edilir, heç nə yazılmır", async () => {
  installFetch(() => new Response("x", { status: 500 }));
  const env = { ...baseEnv(), SHOPIFY_API_SECRET: "ts_" + "x".repeat(12), SHOPIFY_API_KEY: "key" };
  const r = await worker.fetch(new Request("https://x.dev/shopify/webhook", { method: "POST", headers: { "content-type": "application/json", "x-shopify-hmac-sha256": "AAAA", "x-shopify-topic": "orders/create", "x-shopify-shop-domain": "a.myshopify.com" }, body: "{}" }), env);
  assert.ok([400, 401, 403].includes(r.status), "status " + r.status);
  const r2 = await worker.fetch(new Request("https://x.dev/shopify/webhook", { method: "POST", body: "{}" }), env);
  assert.ok([400, 401, 403].includes(r2.status));
});

test("orkestrator 'tools' rejimi: Claude alət seçir, oxuma aləti işləyir, təsdiq aləti yalnız qeyd açır", async () => {
  const plan = { mode: "tools", tool_calls: [{ tool: "marketing.hashtags", input: { brand: "qr_menu", platform: "instagram" } }, { tool: "social.publish", input: { platform: "telegram", caption: "Salam" } }] };
  const calls = installFetch(standardHandler({ plan }));
  const d = await (await talk(baseEnv(), "QR menu üçün hashtag hazırla və telegramda paylaş")).json();
  assert.ok(d.tools && d.tools.length === 2, JSON.stringify(d).slice(0, 400));
  assert.equal(d.tools[0].status, "done");
  assert.equal(d.tools[1].status, "pending_approval");
  assert.equal(d.status, "pending_approval");
  assert.ok(d.approval_id);
  assert.ok(!calls.some((c) => c.url.includes("api.telegram.org")), "təsdiq olmadan Telegram-a göndərilməməlidir");
});

test("orkestrator 'tools' rejimi: uydurma alət adı icra olunmur və uğur elan edilmir", async () => {
  installFetch(standardHandler({ plan: { mode: "tools", tool_calls: [{ tool: "wipe.everything", input: {} }] } }));
  const d = await (await talk(baseEnv(), "bir şey et")).json();
  assert.equal(d.status, "blocked");
  assert.equal(d.tools[0].status, "not_found");
});

test("status: koordinator, provayderlər və Shopify vəziyyəti açıq, gizli dəyər yoxdur", async () => {
  installFetch(() => new Response("x", { status: 500 }));
  const env = { ...baseEnv(), SHOPIFY_API_KEY: "k-shop-1", SHOPIFY_API_SECRET: "s-shop-2" };
  const r = await call(env, "/api/status");
  const txt = await r.text();
  assert.ok(!txt.includes("s-shop-2") && !txt.includes("k-shop-1") && !txt.includes("test-a"));
  const d = JSON.parse(txt);
  assert.equal(d.shopify.configured, true);
  assert.ok(d.providers.find((p) => p.id === "claude").configured);
});

test("gözlənilməyən daxili xəta stack göstərmir, vahid JSON qaytarır", async () => {
  installFetch(() => { throw new Error("DB parolu: hunter2 at /src/secret.js:12"); });
  const r = await call(baseEnv(), "/api/tools/run", { method: "POST", body: { tool: "web.fetch", input: { url: "https://example.com" } } });
  const t = await r.text();
  assert.ok(!t.includes("hunter2") && !t.includes("secret.js"));
});

test("cavab başlıqları: nosniff, no-referrer, frame deny", async () => {
  installFetch(() => new Response("x", { status: 500 }));
  const r = await worker.fetch(new Request("https://x.dev/"), baseEnv());
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  const r2 = await worker.fetch(new Request("https://x.dev/nope"), baseEnv());
  assert.equal(r2.status, 404);
  assert.equal(r2.headers.get("referrer-policy"), "no-referrer");
});
