// REAL API testləri. Defolt olaraq ATLANIR (pul xərcləmir, açar tələb etmir).
// İşə salmaq üçün: ANTHROPIC_API_KEY və OPENAI_API_KEY mühit dəyişənlərini təyin et,
// sonra:  npm run test:live
// Bu testlər real sorğu göndərir və çox az pul xərcləyir.
import test from "node:test";
import assert from "node:assert/strict";
import { ClaudeAdapter } from "../src/adapters/ClaudeAdapter.js";
import { OpenAIAdapter } from "../src/adapters/OpenAIAdapter.js";
import { CallBudget } from "../src/guards/budget.js";

const live = process.env.RUN_LIVE_TESTS === "1" && process.env.ANTHROPIC_API_KEY && process.env.OPENAI_API_KEY;
const skip = live ? false : "real açarlar yoxdur (RUN_LIVE_TESTS=1 və iki API açarı lazımdır)";
const ctx = () => ({ budget: new CallBudget(5), timeoutMs: 30000 });

test("LIVE: Claude real cavab verir", { skip }, async () => {
  const a = new ClaudeAdapter(process.env);
  const out = await a.complete("Reply with the single word OK.", [{ role: "user", content: "ping" }], 20, ctx());
  assert.ok(out.length > 0);
});

test("LIVE: OpenAI (axtarışsız) real cavab verir", { skip }, async () => {
  const a = new OpenAIAdapter(process.env);
  const out = await a.run({ prompt: "Reply with the single word OK.", webSearch: false }, ctx());
  assert.ok(out.text.length > 0);
});

test("LIVE: OpenAI canlı axtarış alətini qəbul edir", { skip }, async () => {
  const a = new OpenAIAdapter(process.env);
  const out = await a.run({ prompt: "What is today's date? Answer in one short sentence." }, ctx());
  assert.ok(out.text.length > 0);
  assert.equal(out.web, true, "canlı axtarış işləmədi: OPENAI_MODEL və OPENAI_WEB_SEARCH_TOOL yoxlanmalıdır");
});

// ---- Telegram (REAL Bot API) ----
// Yalnız oxuma: getMe + getWebhookInfo. Tələb: RUN_LIVE_TESTS=1 və TELEGRAM_BOT_TOKEN (öz botunun tokeni; heç vaxt repo-ya yazma).
// Webhook-u real dəyişən qurulum testi AYRICA işarələnib: əlavə olaraq TELEGRAM_LIVE_SETUP=1, TELEGRAM_WEBHOOK_SECRET və
// PUBLIC_BASE_URL (botun real webhook-unu dəyişir!) lazımdır.
const tgSkip = process.env.RUN_LIVE_TESTS === "1" && process.env.TELEGRAM_BOT_TOKEN ? false : "real Telegram tokeni yoxdur (RUN_LIVE_TESTS=1 və TELEGRAM_BOT_TOKEN lazımdır)";
const tgSetupSkip = tgSkip || (process.env.TELEGRAM_LIVE_SETUP === "1" && process.env.TELEGRAM_WEBHOOK_SECRET && process.env.PUBLIC_BASE_URL ? false : "webhook-u dəyişən test üçün TELEGRAM_LIVE_SETUP=1, TELEGRAM_WEBHOOK_SECRET və PUBLIC_BASE_URL lazımdır");

test("LIVE: Telegram tokeni etibarlıdır (getMe) və webhook vəziyyəti oxunur (getWebhookInfo)", { skip: tgSkip }, async () => {
  const { TelegramAdapter } = await import("../src/social/adapters/Telegram.js");
  const a = new TelegramAdapter({ env: process.env, store: null, now: Date.now });
  const me = await a.getMe();
  assert.ok(me.username, "bot adı gəlməlidir");
  const info = await a.getWebhookInfo();
  assert.equal(typeof info.url, "string");
  assert.equal(typeof info.pending_update_count, "number");
});

test("LIVE: setupWebhook real botda idempotent işləyir (BOTUN WEBHOOK-UNU DƏYİŞİR)", { skip: tgSetupSkip }, async () => {
  const { TelegramAdapter } = await import("../src/social/adapters/Telegram.js");
  const { setupWebhook } = await import("../src/telegram/setup.js");
  const a = new TelegramAdapter({ env: process.env, store: null, now: Date.now });
  const first = await setupWebhook({ adapter: a, env: process.env, origin: process.env.PUBLIC_BASE_URL });
  assert.ok(["created", "switched", "refreshed", "already_set"].includes(first.status));
  const second = await setupWebhook({ adapter: a, env: process.env, origin: process.env.PUBLIC_BASE_URL });
  assert.ok(["already_set", "refreshed"].includes(second.status));
});
