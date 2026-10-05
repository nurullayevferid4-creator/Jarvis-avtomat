// Wiring testləri üçün ortaq köməkçilər. Heç bir real API/KV çağırılmır.
import { createRuntime } from "../src/wiring.js";
import { _resetMemoryForTests } from "../src/state/store.js";
import { _resetSharedStorageForTests } from "../src/storage/index.js";

export class FakeKV {
  constructor() { this.m = new Map(); this.puts = []; }
  async get(k, type) {
    if (!this.m.has(k)) return null;
    const v = this.m.get(k);
    return type === "json" ? JSON.parse(v) : v;
  }
  async put(k, v, o) { this.puts.push({ k, o }); this.m.set(k, v); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix = "", limit = 1000, cursor } = {}) {
    const all = [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = cursor ? all.findIndex((k) => k === cursor) + 1 : 0;
    const page = all.slice(start, start + limit);
    const done = start + limit >= all.length;
    return { keys: page.map((name) => ({ name })), list_complete: done, cursor: done ? undefined : page[page.length - 1] };
  }
}

export const TOK = "TESTTOKEN-ABCDEF-1234567890";
export const TG_TOKEN = "123456789:" + TOK;
export const WEBHOOK_SECRET = "whsec_" + "A1b2C3d4E5f6G7h8I9j0";
export const CHAT = "4242";
export const FULL_ENV = Object.freeze({
  IG_FNPARFUM_TOKEN: TOK,
  TIKTOK_ACCESS_TOKEN: TOK,
  YOUTUBE_CLIENT_ID: TOK + "1", YOUTUBE_CLIENT_SECRET: TOK + "2", YOUTUBE_REFRESH_TOKEN: TOK + "3",
  TELEGRAM_BOT_TOKEN: TG_TOKEN, TELEGRAM_ALLOWED_CHAT_IDS: CHAT + ",-777", TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
  SHOPIFY_ADMIN_TOKEN: TOK, SHOPIFY_STORE_DOMAIN: "demo-shop.myshopify.com",
});

export function resetAll() {
  _resetMemoryForTests();
  _resetSharedStorageForTests();
}

// handler(url, init) -> { ok, status, data } | undefined (undefined = 404). Bütün çağırışlar calls-da.
export function fakeRequest(handler = () => ({ ok: true, status: 200, data: {} })) {
  const calls = [];
  const fn = async (url, init, timeout) => {
    calls.push({ url: String(url), init: init || {}, timeout, body: init && typeof init.body === "string" ? init.body : null });
    return handler(String(url), init || {}) || { ok: false, status: 404, data: "not found" };
  };
  fn.calls = calls;
  return fn;
}

export function runtime(envExtra = {}, request = fakeRequest(), opts = {}) {
  const env = { JARVIS_KV: new FakeKV(), PASSCODE: "pw", ...FULL_ENV, ...envExtra };
  const rt = createRuntime(env, { request, ...opts });
  return { env, rt, request };
}

export const err = async (p) => { try { await p; return null; } catch (e) { return e; } };

// Telegram sendMessage çağırışlarını ayırır
export const sendCalls = (request) => request.calls.filter((c) => c.url.endsWith("/sendMessage"));
