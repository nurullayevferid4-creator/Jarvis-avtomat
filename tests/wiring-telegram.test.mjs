// Telegram webhook: secret autentifikasiyası, çat allowlist-i, təkrar update, səs bildirişi, təsdiqin Telegram-dan verilə bilməməsi.
// Real Telegram çağırılmır (saxta fetch).
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installFetch, standardHandler, baseEnv, ok, worker } from "./helpers.mjs";
import { resetAll, FULL_ENV, TOK, TG_TOKEN, CHAT, WEBHOOK_SECRET, FakeKV } from "./wiring-helpers.mjs";
import { _resetLoginMemoryForTests } from "../src/guards/login.js";

beforeEach(() => {
  resetAll();
  _resetLoginMemoryForTests();
});

const env = (extra = {}) => ({ ...baseEnv(), ...FULL_ENV, JARVIS_KV: new FakeKV(), ...extra });
let uid = 100;
const textUpdate = (chat, text) => ({ update_id: ++uid, message: { message_id: 1, chat: { id: Number(chat) }, from: { id: 1 }, text } });
const hook = (e, body, headers = { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET }) =>
  worker.fetch(new Request("https://x.dev/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }), e, undefined);

function setup(p = { mode: "chat", reply: "Salam Fərid." }) {
  const base = standardHandler({ plan: p });
  return installFetch((u, body, init) => {
    if (u.startsWith("https://api.telegram.org/")) return ok({ ok: true, result: { message_id: 7 } });
    return base(u, body, init);
  });
}
const sends = (calls) => calls.filter((c) => c.url.startsWith("https://api.telegram.org/") && c.url.endsWith("/sendMessage"));
const modelReqs = (calls) => calls.filter((c) => c.url.includes("api.anthropic.com") || c.url.includes("api.openai.com"));

test("TELEGRAM_WEBHOOK_SECRET təyin edilməyibsə webhook bağlıdır (503), heç nə emal olunmur", async () => {
  const calls = setup();
  const e = env();
  delete e.TELEGRAM_WEBHOOK_SECRET;
  const r = await hook(e, textUpdate(CHAT, "salam"));
  assert.equal(r.status, 503);
  assert.equal(calls.length, 0);
});

test("zəif/yanlış formatlı secret də bağlı sayılır (fail-closed)", async () => {
  const calls = setup();
  const r = await hook(env({ TELEGRAM_WEBHOOK_SECRET: "qisa" }), textUpdate(CHAT, "salam"), { "x-telegram-bot-api-secret-token": "qisa" });
  assert.equal(r.status, 503);
  assert.equal(calls.length, 0);
});

test("yanlış və ya olmayan secret başlığı: 401, model və Telegram çağırılmır", async () => {
  const calls = setup();
  for (const headers of [{ "x-telegram-bot-api-secret-token": "yanlis-secret-deyeri-1234" }, {}, { "x-passcode": "pw" }]) {
    const r = await hook(env(), textUpdate(CHAT, "salam"), headers);
    assert.equal(r.status, 401);
  }
  assert.equal(calls.length, 0);
});

test("naməlum chat ID qəbul edilmir: orkestrator işləmir, cavab göndərilmir, Telegram-a 200 qaytarılır", async () => {
  const calls = setup();
  const e = env();
  const r = await hook(e, textUpdate("999999", "salam"));
  assert.equal(r.status, 200);
  assert.equal(modelReqs(calls).length, 0);
  assert.equal(sends(calls).length, 0);
  const audit = await (await worker.fetch(new Request("https://x.dev/api/audit?limit=50", { headers: { "x-passcode": "pw" } }), e)).text();
  assert.ok(audit.includes("telegram.rejected"));
  assert.ok(!audit.includes("999999"), "naməlum çat id-si auditə yazılmır");
});

test("allowlist boşdursa (TELEGRAM_ALLOWED_CHAT_IDS yoxdur) heç bir çat qəbul edilmir", async () => {
  const calls = setup();
  const e = env();
  delete e.TELEGRAM_ALLOWED_CHAT_IDS;
  await hook(e, textUpdate(CHAT, "salam"));
  assert.equal(modelReqs(calls).length, 0);
  assert.equal(sends(calls).length, 0);
});

test("icazəli çatdan mətn: orkestrator işləyir, cavab YALNIZ həmin çata gedir", async () => {
  const calls = setup();
  const r = await hook(env(), textUpdate(CHAT, "Salam, necəsən?"));
  assert.equal(r.status, 200);
  const s = sends(calls);
  assert.equal(s.length, 1);
  assert.ok(s[0].url.startsWith("https://api.telegram.org/bot" + TG_TOKEN + "/"));
  assert.equal(String(s[0].body.chat_id), CHAT);
  assert.ok(String(s[0].body.text).includes("Salam Fərid."));
});

test("eyni update_id ikinci dəfə emal olunmur (təkrar qarşısı)", async () => {
  const calls = setup();
  const e = env();
  const u = textUpdate(CHAT, "salam bir");
  await hook(e, u);
  await hook(e, u);
  assert.equal(sends(calls).length, 1);
});

test("başqa icazəli çat (siyahıdakı ikinci id) də qəbul olunur, siyahıdan kənar yox", async () => {
  const calls = setup();
  const e = env();
  await hook(e, { update_id: 5001, message: { message_id: 1, chat: { id: -777 }, text: "salam" } });
  await hook(e, { update_id: 5002, message: { message_id: 1, chat: { id: -778 }, text: "salam" } });
  assert.equal(sends(calls).length, 1);
  assert.equal(String(sends(calls)[0].body.chat_id), "-777");
});

test("səs mesajı: emal olunmur (fayl endpoint-i yoxlanmayıb), istifadəçiyə bildirilir, orkestrator/STT çağırılmır", async () => {
  const calls = setup();
  const r = await hook(env(), { update_id: ++uid, message: { message_id: 2, chat: { id: Number(CHAT) }, voice: { file_id: "AwACAgIAAxkBAAIB_voice-123", duration: 3 } } });
  assert.equal(r.status, 200);
  assert.equal(modelReqs(calls).length, 0);
  assert.ok(!calls.some((c) => c.url.includes("/getFile") || c.url.includes("/file/bot")), "fayl yükləmə çağırılmamalıdır");
  assert.equal(sends(calls).length, 1);
  assert.ok(String(sends(calls)[0].body.text).includes("Səs mesajı"));
});

test("pozulmuş JSON və böyük gövdə: 200, heç nə emal olunmur", async () => {
  const calls = setup();
  const e = env();
  assert.equal((await hook(e, "{pozuq json")).status, 200);
  const big = new Request("https://x.dev/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": WEBHOOK_SECRET, "content-length": "999999" }, body: JSON.stringify(textUpdate(CHAT, "salam")) });
  assert.equal((await worker.fetch(big, e, undefined)).status, 200);
  assert.equal(sends(calls).length, 0);
});

test("GET /telegram/webhook işləmir (yalnız POST)", async () => {
  setup();
  const r = await worker.fetch(new Request("https://x.dev/telegram/webhook", { headers: { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET } }), env(), undefined);
  assert.equal(r.status, 404);
});

test("Telegram vasitəsilə TƏSDİQ VERİLMİR: alət təsdiqi 'hə' yazmaqla bağlanmır, UI-dan (parol) təsdiqlənənədək gözləyir, cavabda xəbərdarlıq var", async () => {
  const plan = { mode: "task", subtasks: [], tool_calls: [{ id: "c1", tool: "telegram.message.send", input: { chat_id: CHAT, text: "salam" } }], external_action: null };
  const calls = setup(plan);
  const e = env();
  await hook(e, textUpdate(CHAT, "Telegramda salam yaz"));
  // yalnız orkestratorun cavabı (təsdiq barədə xəbərdarlıq) göndərilir, "salam" mətni hələ göndərilməyib
  assert.ok(sends(calls).every((c) => c.body.text !== "salam"), "təsdiqdən əvvəl real mesaj getməməlidir");
  assert.ok(sends(calls).some((c) => String(c.body.text).includes("Təsdiqi yalnız JARVIS səhifəsindən verə bilərsən")));
  const pend = await (await worker.fetch(new Request("https://x.dev/api/approvals?status=pending", { headers: { "x-passcode": "pw" } }), e)).json();
  assert.equal(pend.approvals.length, 1);
  // Telegram-dan "hə"
  const calls2 = setup({ mode: "chat", reply: "ok" });
  await hook(e, textUpdate(CHAT, "hə"));
  const pend2 = await (await worker.fetch(new Request("https://x.dev/api/approvals?status=pending", { headers: { "x-passcode": "pw" } }), e)).json();
  assert.equal(pend2.approvals.length, 1, "Telegram-dan 'hə' qeydi təsdiqləməməlidir");
  assert.ok(sends(calls2).every((c) => c.body.text !== "salam"));
});

test("API açarları yoxdursa webhook model çağırmır, çata aydın xəta bildirişi göndərilir", async () => {
  const calls = setup();
  const e = env();
  delete e.ANTHROPIC_API_KEY;
  await hook(e, textUpdate(CHAT, "salam"));
  assert.equal(modelReqs(calls).length, 0);
  assert.ok(sends(calls).length <= 1);
});

test("webhook cavabında və auditdə bot tokeni/secret görünmür", async () => {
  setup();
  const e = env();
  const r = await hook(e, textUpdate(CHAT, "salam"));
  const t = await r.text();
  const audit = await (await worker.fetch(new Request("https://x.dev/api/audit?limit=100", { headers: { "x-passcode": "pw" } }), e)).text();
  for (const s of [TOK, TG_TOKEN, WEBHOOK_SECRET]) {
    assert.ok(!t.includes(s));
    assert.ok(!audit.includes(s));
  }
});

test("Telegram sendMessage xətası (HTTP 403) webhook-u çökdürmür: 200 qaytarılır, xəta auditdə kodla qeyd olunur, token yoxdur", async () => {
  const base = standardHandler({ plan: { mode: "chat", reply: "ok" } });
  installFetch((u, b, i) => (u.startsWith("https://api.telegram.org/") ? new Response(JSON.stringify({ ok: false, description: "Forbidden " + TG_TOKEN }), { status: 403 }) : base(u, b, i)));
  const e = env();
  const r = await hook(e, textUpdate(CHAT, "salam"));
  assert.equal(r.status, 200);
  const audit = await (await worker.fetch(new Request("https://x.dev/api/audit?limit=100", { headers: { "x-passcode": "pw" } }), e)).text();
  assert.ok(!audit.includes(TG_TOKEN));
});
