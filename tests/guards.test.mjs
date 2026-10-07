// Qoruyucu mexanizmlərin testləri: limit, vaxt limiti, parol cəhd limiti.
import test from "node:test";
import assert from "node:assert/strict";
import { CallBudget, BudgetExceededError } from "../src/guards/budget.js";
import { httpRequest, TimeoutError } from "../src/guards/http.js";
import { getLimits } from "../src/config.js";
import { clampInt } from "../src/util.js";
import { safeEqual, isBlocked, recordFailure, clearFailures, _resetLoginMemoryForTests } from "../src/guards/login.js";
import { baseEnv, worker } from "./helpers.mjs";

test("CallBudget: limit dolanda xəta atır və exceeded=true olur", () => {
  const b = new CallBudget(2);
  b.spend();
  b.spend();
  assert.throws(() => b.spend(), BudgetExceededError);
  assert.equal(b.exceeded, true);
  assert.equal(b.used, 2);
});

test("getLimits: standart dəyərlər düzgündür", () => {
  const l = getLimits({});
  assert.equal(l.maxSubtasks, 4);
  assert.equal(l.maxModelCalls, 12);
  assert.equal(l.callTimeoutMs, 25000);
  assert.equal(l.loginMaxFailures, 5);
  assert.equal(l.loginWindowSeconds, 900);
});

test("getLimits: səhv və ya həddən kənar dəyər limiti söndürə bilmir", () => {
  const l = getLimits({ MAX_SUBTASKS: "9999", MAX_MODEL_CALLS: "0", CALL_TIMEOUT_SECONDS: "abc", LOGIN_MAX_FAILURES: "1" });
  assert.equal(l.maxSubtasks, 8);
  assert.equal(l.maxModelCalls, 3);
  assert.equal(l.callTimeoutMs, 25000);
  assert.equal(l.loginMaxFailures, 3);
  assert.equal(clampInt(undefined, 7, 1, 9), 7);
});

test("httpRequest: cavab gəlməsə vaxt limitində dayanır", async () => {
  globalThis.fetch = (url, init) => new Promise((_, reject) => { init.signal.addEventListener("abort", () => reject(new Error("aborted"))); });
  await assert.rejects(() => httpRequest("https://example.invalid", {}, 30), TimeoutError);
});

test("httpRequest: uğursuz cavabda xəta mətnini qaytarır (uğur kimi göstərmir)", async () => {
  globalThis.fetch = async () => new Response("bad key", { status: 401 });
  const r = await httpRequest("https://example.invalid", {}, 1000);
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
  assert.equal(r.data, "bad key");
});

test("safeEqual: düzgün müqayisə edir", () => {
  assert.equal(safeEqual("parol", "parol"), true);
  assert.equal(safeEqual("parol", "parol1"), false);
  assert.equal(safeEqual("parol", ""), false);
  assert.equal(safeEqual(null, "parol"), false);
});

test("parol cəhd limiti: limit dolunca 429, doğru parol da bloklanır, başqa IP təsirlənmir", async () => {
  _resetLoginMemoryForTests();
  const env = { ...baseEnv(), LOGIN_MAX_FAILURES: "3" };
  const hit = (pass, ip) => worker.fetch(new Request("https://x.dev/api/jobs", { headers: { "x-passcode": pass, "cf-connecting-ip": ip } }), env);
  for (let i = 0; i < 3; i++) assert.equal((await hit("yanlis", "1.1.1.1")).status, 401);
  const blocked = await hit("yanlis", "1.1.1.1");
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get("retry-after"));
  assert.equal((await hit("pw", "1.1.1.1")).status, 429, "bloklu IP doğru parolla da girə bilməz");
  assert.equal((await hit("pw", "2.2.2.2")).status, 200, "başqa IP təsirlənmir");
});

test("parol cəhd limiti: vaxt keçəndən sonra blok açılır", async () => {
  _resetLoginMemoryForTests();
  const limits = getLimits({ LOGIN_MAX_FAILURES: "3", LOGIN_WINDOW_SECONDS: "60" });
  const env = {};
  for (let i = 0; i < 3; i++) await recordFailure(env, "3.3.3.3", limits);
  assert.equal(await isBlocked(env, "3.3.3.3", limits), true);
  const realNow = Date.now;
  Date.now = () => realNow() + 61_000;
  try {
    assert.equal(await isBlocked(env, "3.3.3.3", limits), false);
  } finally {
    Date.now = realNow;
  }
});

test("parol cəhd limiti: KV varsa orada işləyir (expirationTtl ilə)", async () => {
  const store = new Map();
  const puts = [];
  const KV = {
    async get(k) { return store.get(k) ?? null; },
    async put(k, v, opt) { puts.push({ k, opt }); store.set(k, v); },
    async delete(k) { store.delete(k); },
  };
  const env = { JARVIS_KV: KV };
  const limits = getLimits({ LOGIN_MAX_FAILURES: "3", LOGIN_WINDOW_SECONDS: "120" });
  for (let i = 0; i < 3; i++) await recordFailure(env, "4.4.4.4", limits);
  assert.equal(await isBlocked(env, "4.4.4.4", limits), true);
  assert.equal(puts[0].k, "login:4.4.4.4");
  assert.equal(puts[0].opt.expirationTtl, 120);
  await clearFailures(env, "4.4.4.4");
  assert.equal(await isBlocked(env, "4.4.4.4", limits), false);
});

test("PASSCODE təyin edilməyibsə 500 qaytarır (köhnə davranış qorunur)", async () => {
  const r = await worker.fetch(new Request("https://x.dev/api/jobs"), { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" });
  assert.equal(r.status, 500);
});

// ---- Atomik giriş sayğacı (Durable Object) ----
import { JarvisCoordinator } from "../src/coord/coordinator.js";
import { failureCount } from "../src/guards/login.js";

function fakeCoordNs({ down = false } = {}) {
  const map = new Map();
  const storage = { get: async (k) => { await new Promise((r) => setTimeout(r, 1)); return map.get(k); }, put: async (k, v) => { await new Promise((r) => setTimeout(r, 1)); map.set(k, v); }, delete: async (k) => { map.delete(k); } };
  const obj = new JarvisCoordinator({ storage });
  let chain = Promise.resolve(); // DO giriş qapısı kimi: sorğular ardıcıl
  const fetch = (url, init) => { if (down) return Promise.reject(new Error("down")); const run = chain.then(() => obj.fetch(new Request(url, init))); chain = run.catch(() => {}); return run; };
  return { idFromName: (n) => n, get: () => ({ fetch }) };
}

test("giriş limiti: 50 paralel səhv cəhd (DO ilə) hamısı sayılır və IP bloklanır", async () => {
  const env = { COORD: fakeCoordNs() };
  const limits = { loginMaxFailures: 5, loginWindowSeconds: 900 };
  await Promise.all(Array.from({ length: 50 }, () => recordFailure(env, "9.9.1.1", limits)));
  assert.equal(await failureCount(env, "9.9.1.1"), 50);
  assert.equal(await isBlocked(env, "9.9.1.1", limits), true);
  assert.equal(await isBlocked(env, "9.9.1.2", limits), false, "başqa IP təsirlənmir");
  await clearFailures(env, "9.9.1.1");
  assert.equal(await failureCount(env, "9.9.1.1"), 0);
});

test("giriş limiti: koordinator əlçatmaz olsa sahib bloklanmır, yaddaş sayğacına düşür", async () => {
  const env = { COORD: fakeCoordNs({ down: true }) };
  const limits = { loginMaxFailures: 2, loginWindowSeconds: 900 };
  _resetLoginMemoryForTests();
  assert.equal(await isBlocked(env, "9.9.2.2", limits), false);
  await recordFailure(env, "9.9.2.2", limits);
  await recordFailure(env, "9.9.2.2", limits);
  assert.equal(await isBlocked(env, "9.9.2.2", limits), true);
});
