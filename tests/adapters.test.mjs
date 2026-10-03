// Adapterlərin göndərdiyi sorğuların formasının testi.
// DİQQƏT: bu testlər yalnız kodun nə göndərdiyini yoxlayır (saxta fetch ilə).
// Rəsmi API ilə real uyğunluq YALNIZ real açarlarla (npm run test:live) yoxlanıla bilər.
import test from "node:test";
import assert from "node:assert/strict";
import { ClaudeAdapter } from "../src/adapters/ClaudeAdapter.js";
import { OpenAIAdapter } from "../src/adapters/OpenAIAdapter.js";
import { CallBudget, BudgetExceededError } from "../src/guards/budget.js";
import { installFetch, ok, claudeText } from "./helpers.mjs";

const mkCtx = (max = 10) => ({ budget: new CallBudget(max), timeoutMs: 1000 });

test("ClaudeAdapter: Anthropic Messages formatında sorğu göndərir", async () => {
  const calls = installFetch(() => claudeText("salam"));
  const a = new ClaudeAdapter({ ANTHROPIC_API_KEY: "test-key" });
  const out = await a.complete("SYS", [{ role: "user", content: "x" }], 123, mkCtx());
  assert.equal(out, "salam");
  const c = calls[0];
  assert.equal(c.url, "https://api.anthropic.com/v1/messages");
  assert.equal(c.init.method, "POST");
  assert.equal(c.init.headers["x-api-key"], "test-key");
  assert.equal(c.init.headers["anthropic-version"], "2023-06-01");
  assert.equal(c.init.headers["content-type"], "application/json");
  assert.deepEqual(Object.keys(c.body).sort(), ["max_tokens", "messages", "model", "system"]);
  assert.equal(c.body.model, "claude-sonnet-5-5");
  assert.equal(c.body.max_tokens, 123);
  assert.equal(c.body.system, "SYS");
});

test("ClaudeAdapter: CLAUDE_MODEL ilə model dəyişdirilə bilir", async () => {
  const calls = installFetch(() => claudeText("x"));
  await new ClaudeAdapter({ ANTHROPIC_API_KEY: "k", CLAUDE_MODEL: "baska-model" }).complete("s", [{ role: "user", content: "x" }], 10, mkCtx());
  assert.equal(calls[0].body.model, "baska-model");
});

test("ClaudeAdapter: xəta cavabı uğur kimi qəbul edilmir", async () => {
  installFetch(() => new Response("nope", { status: 529 }));
  await assert.rejects(() => new ClaudeAdapter({ ANTHROPIC_API_KEY: "k" }).complete("s", [], 10, mkCtx()), /Claude 529: nope/);
});

test("ClaudeAdapter: limit dolubsa API-yə heç getmir", async () => {
  const calls = installFetch(() => claudeText("x"));
  const ctx = mkCtx(1);
  const a = new ClaudeAdapter({ ANTHROPIC_API_KEY: "k" });
  await a.complete("s", [{ role: "user", content: "x" }], 10, ctx);
  await assert.rejects(() => a.complete("s", [{ role: "user", content: "x" }], 10, ctx), BudgetExceededError);
  assert.equal(calls.length, 1);
});

test("OpenAIAdapter: standart olaraq 'web_search' aləti ilə /v1/responses çağırır", async () => {
  const calls = installFetch(() => ok({ output_text: "nəticə" }));
  const out = await new OpenAIAdapter({ OPENAI_API_KEY: "test-o" }).run({ prompt: "P" }, mkCtx());
  assert.deepEqual(out, { text: "nəticə", web: true });
  const c = calls[0];
  assert.equal(c.url, "https://api.openai.com/v1/responses");
  assert.equal(c.init.headers.authorization, "Bearer test-o");
  assert.deepEqual(c.body.tools, [{ type: "web_search" }]);
  assert.equal(c.body.model, "gpt-4o");
  assert.ok(c.body.input.endsWith("P"));
});

test("OpenAIAdapter: OPENAI_WEB_SEARCH_TOOL və OPENAI_MODEL ilə dəyişdirilə bilir", async () => {
  const calls = installFetch(() => ok({ output_text: "x" }));
  await new OpenAIAdapter({ OPENAI_API_KEY: "o", OPENAI_WEB_SEARCH_TOOL: "web_search_preview", OPENAI_MODEL: "m1" }).run({ prompt: "P" }, mkCtx());
  assert.deepEqual(calls[0].body.tools, [{ type: "web_search_preview" }]);
  assert.equal(calls[0].body.model, "m1");
});

test("OpenAIAdapter: 'output' massivindən mətni oxuya bilir", async () => {
  installFetch(() => ok({ output: [{ type: "web_search_call" }, { type: "message", content: [{ type: "output_text", text: "mətn" }] }] }));
  const out = await new OpenAIAdapter({ OPENAI_API_KEY: "o" }).run({ prompt: "P" }, mkCtx());
  assert.deepEqual(out, { text: "mətn", web: true });
});

test("OpenAIAdapter: axtarış alınmasa axtarışsız variantına keçir və web:false bildirir", async () => {
  const calls = installFetch((u) => (u.endsWith("/v1/responses") ? new Response("boom", { status: 500 }) : ok({ choices: [{ message: { content: "sadə" } }] })));
  const out = await new OpenAIAdapter({ OPENAI_API_KEY: "o" }).run({ prompt: "P" }, mkCtx());
  assert.deepEqual(out, { text: "sadə", web: false });
  assert.deepEqual(calls.map((c) => c.url.split("/v1/")[1]), ["responses", "chat/completions"]);
});

test("OpenAIAdapter: webSearch:false olanda birbaşa chat/completions", async () => {
  const calls = installFetch(() => ok({ choices: [{ message: { content: "sadə" } }] }));
  await new OpenAIAdapter({ OPENAI_API_KEY: "o" }).run({ prompt: "P", webSearch: false }, mkCtx());
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith("/v1/chat/completions"));
});

test("OpenAIAdapter: hər iki cəhd alınmasa xəta atır (saxta uğur yoxdur)", async () => {
  installFetch(() => new Response("boom", { status: 500 }));
  await assert.rejects(() => new OpenAIAdapter({ OPENAI_API_KEY: "o" }).run({ prompt: "P" }, mkCtx()), /OpenAI 500: boom/);
});

test("OpenAIAdapter: limit dolubsa xəta atır və fallback-a keçmir", async () => {
  const calls = installFetch(() => ok({ output_text: "x" }));
  await assert.rejects(() => new OpenAIAdapter({ OPENAI_API_KEY: "o" }).run({ prompt: "P" }, mkCtx(0)), BudgetExceededError);
  assert.equal(calls.length, 0);
});
