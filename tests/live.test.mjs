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
