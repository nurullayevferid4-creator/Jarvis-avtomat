// Provider qatı: Claude lider, OpenAI ehtiyat, Kimi ikinci rəy. Real API çağırılmır (impls ilə saxta).
import test from "node:test";
import assert from "node:assert/strict";
import { createProviderRouter } from "../src/providers/router.js";
import { providerHttpError } from "../src/providers/http.js";
import { AppError } from "../src/errors.js";

const env = { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" };
const ok = (text) => async () => ({ text, model: "m" });
const fail = (code) => async () => { throw new AppError(code, "x", { source: "t" }); };

test("provayder xətaları vahid kodlara çevrilir", () => {
  assert.equal(providerHttpError("claude", 401, "").code, "AUTH_ERROR");
  assert.equal(providerHttpError("claude", 403, "").code, "PERMISSION_ERROR");
  assert.equal(providerHttpError("openai", 429, "").code, "RATE_LIMIT");
  assert.equal(providerHttpError("openai", 400, "").code, "VALIDATION_ERROR");
  const e = providerHttpError("claude", 529, "overloaded");
  assert.equal(e.code, "PROVIDER_ERROR");
  assert.equal(e.retryable, true);
});

test("Claude cavab verir: ehtiyat çağırılmır", async () => {
  let o = 0;
  const r = createProviderRouter(env, { impls: { claude: ok("salam"), openai: async () => { o++; return { text: "x", model: "m" }; } } });
  const res = await r.complete({ system: "s", user: "u" });
  assert.equal(res.provider, "claude");
  assert.equal(o, 0);
});

test("Claude rate limit / timeout / auth / provider xətasında OpenAI-a keçir və hansı provayder olduğunu bildirir", async () => {
  for (const code of ["RATE_LIMIT", "TIMEOUT", "AUTH_ERROR", "PROVIDER_ERROR", "NETWORK_ERROR"]) {
    const r = createProviderRouter(env, { impls: { claude: fail(code), openai: ok("ehtiyat") } });
    const res = await r.complete({ system: "s", user: "u" });
    assert.equal(res.provider, "openai", code);
    assert.deepEqual(res.attempts.map((a) => a.provider + ":" + a.ok), ["claude:false", "openai:true"]);
  }
});

test("validation xətasında (səhv sorğu) ehtiyata keçilmir", async () => {
  let o = 0;
  const r = createProviderRouter(env, { impls: { claude: fail("VALIDATION_ERROR"), openai: async () => { o++; return { text: "x" }; } } });
  await assert.rejects(() => r.complete({ system: "s", user: "u" }), (e) => e.code === "PROVIDER_ERROR");
  assert.equal(o, 0);
});

test("hamısı uğursuzdursa saxta uğur yoxdur, açar yoxdursa AUTH_ERROR", async () => {
  const r = createProviderRouter(env, { impls: { claude: fail("TIMEOUT"), openai: fail("RATE_LIMIT") } });
  await assert.rejects(() => r.complete({ system: "s", user: "u" }), (e) => e.code === "PROVIDER_ERROR" && e.attempts.length === 2);
  const none = createProviderRouter({}, {});
  await assert.rejects(() => none.completeJson({ system: "s", user: "u", schema: { type: "object" } }), (e) => e.code === "AUTH_ERROR");
});

test("completeJson: yanlış format bir dəfə düzəldilir, sonra ehtiyata keçir; sxemə uymayan cavab qəbul edilmir", async () => {
  const schema = { type: "object", required: ["a"], properties: { a: { type: "string" } } };
  let n = 0;
  const r1 = createProviderRouter(env, { impls: { claude: async () => ({ text: ++n === 1 ? "bu JSON deyil" : '{"a":"ok"}', model: "m" }), openai: fail("TIMEOUT") } });
  assert.deepEqual(await r1.completeJson({ system: "s", user: "u", schema }), { a: "ok" });
  assert.equal(n, 2);

  const r2 = createProviderRouter(env, { impls: { claude: ok('{"b":1}'), openai: ok('{"a":"fallback"}') } });
  assert.deepEqual(await r2.completeJson({ system: "s", user: "u", schema }), { a: "fallback" });
  assert.equal(r2.lastProvider, "openai");
  assert.equal(r2.asLlm().provider, "openai");

  const r3 = createProviderRouter(env, { impls: { claude: ok("zibil"), openai: ok("zibil") } });
  await assert.rejects(() => r3.completeJson({ system: "s", user: "u", schema }), (e) => e.code === "PROVIDER_ERROR" && /malformed/.test(e.message));
});

test("öz çağırış limiti aşılarsa dayanır", async () => {
  const r = createProviderRouter(env, { maxCalls: 2, impls: { claude: ok("x"), openai: ok("x") } });
  await r.complete({ system: "s", user: "u" });
  await r.complete({ system: "s", user: "u" });
  await assert.rejects(() => r.complete({ system: "s", user: "u" }), (e) => e.code === "PROVIDER_ERROR");
});

test("Kimi yalnız açıq çağırışda işləyir, açarsızdırsa AUTH_ERROR; status açar dəyərini göstərmir", async () => {
  const r = createProviderRouter(env, { impls: { claude: ok("c"), openai: ok("o"), kimi: ok("kimi rəyi") } });
  await assert.rejects(() => r.secondOpinion({ system: "s", user: "u" }), (e) => e.code === "AUTH_ERROR");
  const r2 = createProviderRouter({ ...env, KIMI_API_KEY: "k" }, { impls: { kimi: ok("kimi rəyi") } });
  assert.equal((await r2.secondOpinion({ system: "s", user: "u" })).provider, "kimi");
  const st = JSON.stringify(r2.status());
  assert.ok(!st.includes('"k"') && !st.includes("ANTHROPIC"));
  assert.deepEqual(r2.status().map((x) => x.id + ":" + x.configured), ["claude:true", "openai:true", "kimi:true"]);
});

test("real HTTP yolu: fetch saxtalaşdırılıb, 401 AUTH_ERROR, 429 RATE_LIMIT, xarab cavab PROVIDER_ERROR", async () => {
  const orig = globalThis.fetch;
  try {
    const mk = (status, body) => { globalThis.fetch = async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); };
    const r = createProviderRouter({ ANTHROPIC_API_KEY: "a" });
    mk(401, "bad key");
    await assert.rejects(() => r.complete({ system: "s", user: "u", order: ["claude"] }), (e) => e.code === "AUTH_ERROR");
    mk(429, "slow down");
    await assert.rejects(() => r.complete({ system: "s", user: "u", order: ["claude"] }), (e) => e.code === "PROVIDER_ERROR" && e.attempts[0].code === "RATE_LIMIT");
    mk(200, { content: [] });
    await assert.rejects(() => r.complete({ system: "s", user: "u", order: ["claude"] }), (e) => e.attempts[0].code === "PROVIDER_ERROR");
    mk(200, { content: [{ type: "text", text: "salam" }] });
    assert.equal((await r.complete({ system: "s", user: "u", order: ["claude"] })).text, "salam");
  } finally {
    globalThis.fetch = orig;
  }
});
