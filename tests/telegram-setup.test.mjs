// /api/telegram/setup və /api/telegram/webhook: dəqiq xəta səbəbləri, idempotentlik, köhnə webhook-dan keçid,
// uğurun təsdiqi və gizli məlumatın sızmaması. Telegram Bot API saxta (vəziyyətli) serverlə əvəz olunur;
// real Telegram testi tests/live.test.mjs-dədir (ayrıca işarələnib, açar tələb edir).
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";
import { json, installSocialFetch, bodyJson, world } from "./social-helpers.mjs";
import { verifyWebhook, allowedIds } from "../src/telegram/handler.js";
import { inspectConfig } from "../src/telegram/setup.js";
import { cleanEnvValue, inspectPublicBase } from "../src/security/envvalue.js";

const BASE = "https://jarvis.example.dev";
const WANT = BASE + "/telegram/webhook";
const TOKEN = "123:TESTTOKEN";
const SECRET = "whsec_test-1";

// Vəziyyətli saxta Telegram: token URL-də yoxlanır, setWebhook qaydaları rəsmi sənədə uyğundur.
function fakeTelegram(init = {}, fail = {}) {
  const st = { url: "", allowed_updates: undefined, pending: 0, last_error_message: undefined, last_error_date: undefined, secret_token: null, ...init };
  const routes = [
    [
      /api\.telegram\.org\/bot([^/]+)\/(\w+)/,
      async (call) => {
        const [, tok, method] = call.url.match(/bot([^/]+)\/(\w+)/);
        const body = call.body ? JSON.parse(String(call.body)) : {};
        if (fail[method]) {
          const f = fail[method];
          if (f.throw) throw new TypeError("fetch failed");
          return json(f.body || { ok: false, error_code: f.status, description: f.description || "err" }, f.status || 400);
        }
        if (tok !== TOKEN) return json({ ok: false, error_code: 401, description: "Unauthorized" }, 401);
        if (method === "getMe") return json({ ok: true, result: { id: 123, is_bot: true, username: "jarvis_test_bot" } });
        if (method === "getWebhookInfo") {
          const r = { url: st.url, has_custom_certificate: false, pending_update_count: st.pending };
          if (st.allowed_updates) r.allowed_updates = st.allowed_updates;
          if (st.last_error_message) { r.last_error_message = st.last_error_message; r.last_error_date = st.last_error_date || 1_800_000_000; }
          return json({ ok: true, result: r });
        }
        if (method === "setWebhook") {
          if (!/^https:\/\//.test(body.url || "")) return json({ ok: false, error_code: 400, description: "Bad Request: bad webhook: HTTPS url must be provided for webhook" }, 400);
          if (body.secret_token !== undefined && !/^[A-Za-z0-9_-]{1,256}$/.test(body.secret_token)) return json({ ok: false, error_code: 400, description: "Bad Request: secret token contains unallowed characters" }, 400);
          st.url = body.url;
          st.allowed_updates = body.allowed_updates;
          st.secret_token = body.secret_token;
          if (body.drop_pending_updates) st.pending = 0;
          st.last_error_message = undefined;
          return json({ ok: true, result: true, description: "Webhook was set" });
        }
        if (method === "deleteWebhook") { st.url = ""; if (body.drop_pending_updates) st.pending = 0; return json({ ok: true, result: true }); }
        return json({ ok: false, error_code: 404, description: "Not Found" }, 404);
      },
    ],
  ];
  const calls = installSocialFetch(routes);
  const count = (m) => calls.filter((c) => c.url.endsWith("/" + m)).length;
  const last = (m) => bodyJson(calls.filter((c) => c.url.endsWith("/" + m)).pop());
  return { st, calls, count, last };
}

const H = { "x-passcode": "pw" };
const setup = (env, { origin = BASE, body, headers = H } = {}) => worker.fetch(new Request(origin + "/api/telegram/setup", { method: "POST", headers: body ? { ...headers, "content-type": "application/json" } : headers, body: body ? JSON.stringify(body) : undefined }), env);
const status = (env, { origin = BASE, headers = H } = {}) => worker.fetch(new Request(origin + "/api/telegram/webhook", { headers }), env);
const leaks = (text) => [TOKEN, "TESTTOKEN", SECRET, "whsec_"].filter((x) => String(text).includes(x));

test("yeni qurulum: getWebhookInfo → setWebhook (secret_token, allowed_updates, drop) → təsdiq; cavabda token/secret yoxdur", async () => {
  const w = world();
  const tg = fakeTelegram({ pending: 3 });
  const r = await setup(w.env);
  const text = await r.clone().text();
  const b = await r.json();
  assert.equal(r.status, 200);
  assert.equal(b.ok, true);
  assert.equal(b.status, "created");
  assert.equal(b.webhook, WANT);
  assert.equal(b.bot, "@jarvis_test_bot");
  assert.deepEqual(tg.calls.filter((c) => /\/(getWebhookInfo|setWebhook)$/.test(c.url)).map((c) => c.url.split("/").pop()), ["getWebhookInfo", "setWebhook", "getWebhookInfo"], "qurulumdan sonra real vəziyyət yoxlanmalıdır");
  const set = tg.last("setWebhook");
  assert.equal(set.url, WANT);
  assert.equal(set.secret_token, SECRET);
  assert.deepEqual(set.allowed_updates, ["message", "callback_query"]);
  assert.equal(set.drop_pending_updates, true);
  assert.equal(b.dropped_pending, 3);
  assert.deepEqual(leaks(text), []);
  const audit = JSON.stringify(await w.audit.list(10));
  assert.match(audit, /telegram\.webhook_set/);
  assert.deepEqual(leaks(audit), []);
});

test("idempotent: eyni ünvan artıq qurulubsa heç bir dəyişiklik yoxdur və 409 yoxdur", async () => {
  const w = world();
  const tg = fakeTelegram();
  assert.equal((await (await setup(w.env)).json()).status, "created");
  const before = tg.count("setWebhook");
  const r = await setup(w.env);
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.status, "already_set");
  assert.equal(tg.count("setWebhook"), before, "artıq düzgün qurulubsa setWebhook çağırılmamalıdır");
  assert.equal(b.dropped_pending, 0);
  const r3 = await setup(w.env);
  assert.equal(r3.status, 200);
});

test("force=true: düzgün qurulu webhook-u gözləyən yeniləmələri atmadan yenidən tətbiq edir", async () => {
  const w = world();
  const tg = fakeTelegram({ url: WANT, allowed_updates: ["message", "callback_query"], pending: 2 });
  const b = await (await setup(w.env, { body: { force: true } })).json();
  assert.equal(b.status, "refreshed");
  assert.equal(tg.last("setWebhook").drop_pending_updates, false);
  assert.equal(b.pending_updates, 2);
});

test("başqa ünvanda köhnə webhook (n8n): təhlükəsiz keçid, köhnə ünvandan yalnız host göstərilir", async () => {
  const w = world();
  const old = "https://n8n.example.com/webhook/0a1b2c3d-secret-path-9999/webhook";
  const tg = fakeTelegram({ url: old, pending: 5, allowed_updates: ["message"] });
  const r = await setup(w.env);
  const text = await r.clone().text();
  const b = await r.json();
  assert.equal(r.status, 200);
  assert.equal(b.status, "switched");
  assert.equal(b.previous_host, "n8n.example.com");
  assert.ok(!text.includes("secret-path-9999"), "köhnə ünvanın yolu (gizli hissə ola bilər) göstərilməməlidir");
  assert.equal(tg.st.url, WANT);
  assert.equal(tg.last("setWebhook").drop_pending_updates, true, "köhnə istehlakçının gözləyən əmrləri JARVIS-ə düşməməlidir");
  assert.equal(b.dropped_pending, 5);
  assert.equal(tg.count("deleteWebhook"), 0, "setWebhook özü əvəz edir");
  const audit = JSON.stringify(await w.audit.list(10));
  assert.ok(!audit.includes("secret-path-9999"));
  assert.match(audit, /n8n\.example\.com/);
});

test("eyni ünvan, lakin Telegram çatdırma xətası göstərir: təzələnir, gözləyənlər saxlanır, xəbərdarlıq verilir", async () => {
  const w = world();
  const tg = fakeTelegram({ url: WANT, allowed_updates: ["message", "callback_query"], pending: 4, last_error_message: "Wrong response from the webhook: 403 Forbidden" });
  const b = await (await setup(w.env)).json();
  assert.equal(b.status, "refreshed");
  assert.equal(tg.last("setWebhook").drop_pending_updates, false);
  assert.equal(b.pending_updates, 4);
  assert.equal(b.dropped_pending, 0);
});

test("allowed_updates fərqlidirsə düzəldilir", async () => {
  const w = world();
  const tg = fakeTelegram({ url: WANT, allowed_updates: ["message"] });
  assert.equal((await (await setup(w.env)).json()).status, "refreshed");
  assert.deepEqual(tg.st.allowed_updates, ["message", "callback_query"]);
});

test("Telegram 401 (token səhvdir) → 424 bot_token_rejected, 409 DEYİL; token cavabda yoxdur", async () => {
  const w = world({ TELEGRAM_BOT_TOKEN: "123:WRONGTOKENVALUE" });
  const tg = fakeTelegram();
  const r = await setup(w.env);
  const text = await r.clone().text();
  const b = await r.json();
  assert.equal(r.status, 424);
  assert.equal(b.reason, "bot_token_rejected");
  assert.equal(b.step, "getWebhookInfo");
  assert.match(b.message, /tokenini qəbul etmir/);
  assert.equal(tg.count("setWebhook"), 0);
  assert.deepEqual(leaks(text), []);
  assert.ok(!text.includes("WRONGTOKENVALUE"));
  const audit = JSON.stringify(await w.audit.list(10));
  assert.match(audit, /telegram\.webhook_failed/);
  assert.match(audit, /bot_token_rejected/);
  assert.ok(!audit.includes("WRONGTOKENVALUE"));
});

test("Telegram 404 (token formatı Telegram-a yaddır) → 424 bot_token_rejected", async () => {
  const w = world();
  fakeTelegram({}, { getWebhookInfo: { status: 404, description: "Not Found" } });
  const r = await setup(w.env);
  assert.equal(r.status, 424);
  assert.equal((await r.json()).reason, "bot_token_rejected");
});

test("Telegram özü 409 qaytararsa: səbəb Telegram-ın real mətni ilə, reason=telegram_conflict", async () => {
  const w = world();
  fakeTelegram({}, { setWebhook: { status: 409, description: "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running" } });
  const r = await setup(w.env);
  const b = await r.json();
  assert.equal(r.status, 409);
  assert.equal(b.reason, "telegram_conflict");
  assert.equal(b.step, "setWebhook");
  assert.match(b.message, /terminated by other getUpdates request/);
});

test("Telegram 429 → 429 + retry_after; 400 bad webhook → 424 Telegram mətni ilə; 5xx və şəbəkə xətası → 502", async () => {
  let w = world();
  fakeTelegram({}, { setWebhook: { status: 429, body: { ok: false, error_code: 429, description: "Too Many Requests: retry after 7", parameters: { retry_after: 7 } } } });
  let r = await setup(w.env);
  let b = await r.json();
  assert.equal(r.status, 429);
  assert.equal(b.reason, "telegram_rate_limited");
  assert.equal(b.retry_after, 7);
  assert.equal(b.retryable, true);

  w = world();
  fakeTelegram({}, { setWebhook: { status: 400, description: "Bad Request: bad webhook: Failed to resolve host: Name or service not known" } });
  r = await setup(w.env);
  b = await r.json();
  assert.equal(r.status, 424);
  assert.equal(b.reason, "telegram_rejected");
  assert.match(b.message, /Failed to resolve host/);

  w = world();
  fakeTelegram({}, { getWebhookInfo: { status: 502, description: "Bad Gateway" } });
  r = await setup(w.env);
  assert.equal(r.status, 502);
  assert.equal((await r.json()).reason, "telegram_unavailable");

  w = world();
  fakeTelegram({}, { getWebhookInfo: { throw: true } });
  r = await setup(w.env);
  b = await r.json();
  assert.equal(r.status, 502);
  assert.equal(b.reason, "telegram_unreachable");
  assert.equal(b.retryable, true);
});

test("Telegram cavabı JSON deyilsə (proxy/firewall 403 və ya 404 HTML): bot xətası kimi yox, çatmama kimi göstərilir", async () => {
  for (const status of [403, 404, 502]) {
    const w = world();
    installSocialFetch([[/api\.telegram\.org/, () => new Response("<html>blocked</html>", { status })]]);
    const r = await setup(w.env);
    const b = await r.json();
    assert.equal(r.status, 502, "HTTP " + status);
    assert.notEqual(b.reason, "bot_token_rejected");
    assert.notEqual(b.reason, "telegram_forbidden");
    assert.match(b.reason, /^telegram_(unreachable|unavailable)$/);
    assert.match(b.message, /Telegram cavabı gəlmədi/);
    assert.ok(!b.message.includes("blocked"), "xam cavab gövdəsi çıxmamalıdır");
  }
});

test("uğur saxtalaşdırılmır: setWebhook ok desə də getWebhookInfo fərqli ünvan göstərirsə 502 webhook_not_applied", async () => {
  const w = world();
  let n = 0;
  installSocialFetch([[/api\.telegram\.org/, (c) => {
    if (c.url.endsWith("/getWebhookInfo")) { n++; return json({ ok: true, result: { url: "https://old.example.org/x", pending_update_count: 0 } }); }
    if (c.url.endsWith("/setWebhook")) return json({ ok: true, result: true });
    return json({ ok: true, result: { username: "b" } });
  }]]);
  const r = await setup(w.env);
  const b = await r.json();
  assert.equal(r.status, 502);
  assert.equal(b.reason, "webhook_not_applied");
  assert.equal(b.step, "verify");
  assert.ok(n >= 2);
});

test("konfiqurasiya: hər çatışmazlıq ayrıca səbəb və 412 verir, Telegram çağırılmır", async () => {
  const cases = [
    [{ TELEGRAM_BOT_TOKEN: "" }, "bot_token_missing"],
    [{ TELEGRAM_BOT_TOKEN: "bot123:TESTTOKEN!" }, "bot_token_malformed"],
    [{ TELEGRAM_WEBHOOK_SECRET: "" }, "webhook_secret_missing"],
    [{ TELEGRAM_WEBHOOK_SECRET: "bad secret.with%chars" }, "webhook_secret_invalid"],
  ];
  for (const [extra, reason] of cases) {
    const w = world(extra);
    const tg = fakeTelegram();
    const r = await setup(w.env);
    const text = await r.clone().text();
    const b = await r.json();
    assert.equal(r.status, 412, reason);
    assert.equal(b.reason, reason);
    assert.equal(b.error, "CONFIG_ERROR");
    assert.equal(b.step, "config");
    assert.equal(tg.calls.length, 0, "konfiqurasiya səhvdirsə Telegram-a sorğu getməməlidir");
    assert.ok(!text.includes("bad secret"), "secret dəyəri cavaba çıxmamalıdır");
    assert.ok(!text.includes("TESTTOKEN!"));
  }
});

test("PUBLIC_BASE_URL: boşluq/dırnaq/sondakı '/' təmizlənir; çatmırsa sorğunun https ünvanı ehtiyat olur və bu bildirilir; http-də 412", async () => {
  let w = world({ PUBLIC_BASE_URL: ' "https://jarvis.example.dev/" \n' });
  let tg = fakeTelegram();
  let b = await (await setup(w.env)).json();
  assert.equal(b.status, "created");
  assert.equal(b.webhook, WANT);
  assert.equal(b.base_source, "env");
  assert.equal(tg.last("setWebhook").url, WANT);

  w = world({ PUBLIC_BASE_URL: "" });
  tg = fakeTelegram();
  b = await (await setup(w.env)).json();
  assert.equal(b.status, "created");
  assert.equal(b.base_source, "request_origin");
  assert.ok(b.warnings.some((x) => /PUBLIC_BASE_URL/.test(x)));

  w = world({ PUBLIC_BASE_URL: "https://jarvis.example.dev/some/path?x=1" });
  tg = fakeTelegram();
  b = await (await setup(w.env)).json();
  assert.equal(b.base_source, "request_origin");
  assert.ok(b.warnings.some((x) => /düzgün deyil/.test(x)));
  assert.equal(tg.last("setWebhook").url, WANT);

  w = world({ PUBLIC_BASE_URL: "" });
  tg = fakeTelegram();
  const r = await setup(w.env, { origin: "http://localhost:8787" });
  b = await r.json();
  assert.equal(r.status, 412);
  assert.equal(b.reason, "public_base_url_missing");
  assert.match(b.hint, /keep_vars/);
  assert.equal(tg.calls.length, 0);

  w = world({ PUBLIC_BASE_URL: "ftp://x" });
  fakeTelegram();
  b = await (await setup(w.env, { origin: "http://localhost:8787" })).json();
  assert.equal(b.reason, "public_base_url_invalid");
});

test("token/secret/ID-lərdə ətraf dırnaq və sətir sonu: qurulum və webhook doğrulaması eyni dəyərlə işləyir", async () => {
  const w = world({ TELEGRAM_BOT_TOKEN: ' "' + TOKEN + '"\n', TELEGRAM_WEBHOOK_SECRET: SECRET + "\n", TELEGRAM_ALLOWED_CHAT_IDS: ' "1001, 1002" ' });
  const tg = fakeTelegram();
  const b = await (await setup(w.env)).json();
  assert.equal(b.status, "created");
  assert.equal(tg.last("setWebhook").secret_token, SECRET);
  assert.ok(verifyWebhook(new Request("https://x.dev", { headers: { "x-telegram-bot-api-secret-token": SECRET } }), w.env));
  assert.ok(!verifyWebhook(new Request("https://x.dev", { headers: { "x-telegram-bot-api-secret-token": SECRET + "x" } }), w.env));
  assert.ok(!verifyWebhook(new Request("https://x.dev"), w.env));
  assert.deepEqual([...allowedIds(w.env)].sort(), ["1001", "1002"]);
});

test("icazə modeli toxunulmazdır: ID siyahısı boşdursa webhook qurulur, lakin xəbərdarlıq var və heç kim idarə edə bilməz", async () => {
  const w = world({ TELEGRAM_ALLOWED_CHAT_IDS: "" });
  fakeTelegram();
  const b = await (await setup(w.env)).json();
  assert.equal(b.status, "created");
  assert.equal(b.allowed_chats, 0);
  assert.ok(b.warnings.some((x) => /TELEGRAM_ALLOWED_CHAT_IDS boşdur/.test(x)));
  assert.equal(allowedIds(w.env).size, 0);
  const w2 = world({ TELEGRAM_ALLOWED_CHAT_IDS: "abc, 1001" });
  fakeTelegram();
  const b2 = await (await setup(w2.env)).json();
  assert.ok(b2.warnings.some((x) => /rəqəm olmayan/.test(x)));
  assert.deepEqual([...allowedIds(w2.env)], ["1001"]);
});

test("parolsuz sorğu 401 alır və Telegram-a heç nə getmir (həm qurulum, həm yoxlama)", async () => {
  const w = world();
  const tg = fakeTelegram();
  assert.equal((await setup(w.env, { headers: {} })).status, 401);
  assert.equal((await status(w.env, { headers: {} })).status, 401);
  assert.equal((await setup(w.env, { headers: { "x-passcode": "yanlis" } })).status, 401);
  assert.equal(tg.calls.length, 0);
});

test("GET /api/telegram/webhook: yalnız oxuma; hökm: not_set, ok, other_url, delivery_error, config_problem", async () => {
  let w = world();
  let tg = fakeTelegram();
  let b = await (await status(w.env)).json();
  assert.equal(b.verdict, "not_set");
  assert.equal(b.expected, WANT);
  assert.equal(b.bot, "@jarvis_test_bot");

  tg = fakeTelegram({ url: WANT, allowed_updates: ["message", "callback_query"], pending: 1 });
  b = await (await status(w.env)).json();
  assert.equal(b.verdict, "ok");
  assert.equal(b.webhook.matches_expected, true);
  assert.equal(b.webhook.pending_updates, 1);

  tg = fakeTelegram({ url: "https://n8n.example.com/webhook/abc-secret/webhook" });
  const r = await status(w.env);
  const text = await r.clone().text();
  b = await r.json();
  assert.equal(b.verdict, "other_url");
  assert.equal(b.webhook.host, "n8n.example.com");
  assert.ok(!text.includes("abc-secret"));

  tg = fakeTelegram({ url: WANT, last_error_message: "Connection timed out" });
  b = await (await status(w.env)).json();
  assert.equal(b.verdict, "delivery_error");
  assert.equal(b.webhook.last_error.message, "Connection timed out");
  assert.equal(tg.count("setWebhook"), 0, "yoxlama heç nəyi dəyişməməlidir");

  w = world({ TELEGRAM_WEBHOOK_SECRET: "" });
  fakeTelegram();
  b = await (await status(w.env)).json();
  assert.equal(b.verdict, "config_problem");
  assert.equal(b.problems[0].reason, "webhook_secret_missing");
  assert.deepEqual(leaks(JSON.stringify(b)), []);

  w = world({ TELEGRAM_BOT_TOKEN: "" });
  tg = fakeTelegram();
  b = await (await status(w.env)).json();
  assert.equal(b.verdict, "config_problem");
  assert.equal(tg.calls.length, 0);
});

test("GET yoxlama: token səhvdirsə 424 bot_token_rejected (409 yox)", async () => {
  const w = world({ TELEGRAM_BOT_TOKEN: "123:OTHERTOKENVALUE" });
  fakeTelegram();
  const r = await status(w.env);
  assert.equal(r.status, 424);
  assert.equal((await r.json()).reason, "bot_token_rejected");
});

test("köhnə davranışın səbəbi: xəta modeli artıq token/secret çatışmazlığını 409-a çevirmir", async () => {
  // Əvvəl: PUBLIC_BASE_URL boş, TELEGRAM_BOT_TOKEN etibarsız və s. hamısı HTTP 409 idi. İndi hər biri ayrıdır.
  const seen = new Set();
  for (const [extra, origin] of [[{ PUBLIC_BASE_URL: "" }, "http://localhost:1"], [{ TELEGRAM_BOT_TOKEN: "123:BADTOKENVALUE" }, BASE], [{ TELEGRAM_WEBHOOK_SECRET: "" }, BASE]]) {
    const w = world(extra);
    fakeTelegram();
    const r = await setup(w.env, { origin });
    assert.notEqual(r.status, 409);
    seen.add((await r.json()).reason);
  }
  assert.equal(seen.size, 3);
});

test("yardımçılar: cleanEnvValue və inspectPublicBase; inspectConfig sirləri qaytarmır", () => {
  assert.equal(cleanEnvValue(" 'a b' "), "a b");
  assert.equal(cleanEnvValue('"x'), '"x');
  assert.equal(cleanEnvValue(undefined), "");
  assert.deepEqual(inspectPublicBase("https://a.b/"), { ok: true, url: "https://a.b", reason: null });
  assert.equal(inspectPublicBase("").reason, "missing");
  assert.equal(inspectPublicBase("http://a.b").reason, "invalid");
  assert.equal(inspectPublicBase("https://a.b/x").reason, "invalid");
  assert.equal(inspectPublicBase("https://user@a.b").reason, "invalid");
  const cfg = inspectConfig(world().env, BASE);
  assert.deepEqual(leaks(JSON.stringify(cfg)), []);
  assert.equal(cfg.problems.length, 0);
});
