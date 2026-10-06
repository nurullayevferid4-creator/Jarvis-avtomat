// Sosial testlər üçün köməkçilər. HEÇ BİR real şəbəkə çağırışı olmur:
// installSocialFetch saxta fetch qoyur, uyğun marşrut tapılmazsa test pozulur.
import { _resetMemoryForTests, createStore } from "../src/state/store.js";
import { createAudit } from "../src/audit/log.js";
import { ApprovalCenter } from "../src/approval/center.js";
import { createSocialHub } from "../src/social/hub.js";
import { createSocialFlow } from "../src/social/flow.js";

export const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });

// routes: [[RegExp|string, (call) => Response], ...]; call = { url, method, headers, body }
export function installSocialFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const headers = {};
    const h = init.headers || {};
    for (const [k, v] of h instanceof Headers ? h.entries() : Object.entries(h)) headers[k.toLowerCase()] = String(v);
    const call = { url: u, method: (init.method || "GET").toUpperCase(), headers, body: init.body };
    calls.push(call);
    for (const [m, fn] of routes) {
      const hit = typeof m === "string" ? u.includes(m) : m.test(u);
      if (hit) return await fn(call);
    }
    throw new Error("TEST: gözlənilməyən şəbəkə çağırışı: " + u.slice(0, 80));
  };
  return calls;
}

export const bodyText = (c) => (typeof c.body === "string" ? c.body : c.body instanceof URLSearchParams ? c.body.toString() : "");
export const bodyParams = (c) => new URLSearchParams(bodyText(c));
export const bodyJson = (c) => JSON.parse(bodyText(c));

// Cloudflare R2 saxta binding
export function fakeR2() {
  const m = new Map();
  return {
    _m: m,
    async put(key, value, opts = {}) {
      const bytes = value instanceof ArrayBuffer ? value.slice(0) : new Uint8Array(value).buffer.slice(0);
      m.set(key, { bytes, httpMetadata: opts.httpMetadata || {}, customMetadata: opts.customMetadata || {} });
    },
    async head(key) {
      const o = m.get(key);
      return o ? { size: o.bytes.byteLength, httpMetadata: o.httpMetadata, customMetadata: o.customMetadata } : null;
    },
    async get(key) {
      const o = m.get(key);
      if (!o) return null;
      return { size: o.bytes.byteLength, httpMetadata: o.httpMetadata, body: new Blob([o.bytes]).stream(), arrayBuffer: async () => o.bytes.slice(0) };
    },
  };
}

export const socialEnv = (extra = {}) => ({
  ANTHROPIC_API_KEY: "test-a",
  OPENAI_API_KEY: "test-o",
  PASSCODE: "pw",
  PUBLIC_BASE_URL: "https://jarvis.example.dev",
  MEDIA_SIGNING_KEY: "test-signing-key",
  INSTAGRAM_APP_ID: "ig-app",
  INSTAGRAM_APP_SECRET: "ig-secret",
  TIKTOK_CLIENT_KEY: "tt-key",
  TIKTOK_CLIENT_SECRET: "tt-secret",
  GOOGLE_CLIENT_ID: "g-id",
  GOOGLE_CLIENT_SECRET: "g-secret",
  TELEGRAM_BOT_TOKEN: "123:TESTTOKEN",
  TELEGRAM_WEBHOOK_SECRET: "whsec_test-1",
  TELEGRAM_ALLOWED_CHAT_IDS: "1001",
  TELEGRAM_CHANNEL_ID: "@testchannel",
  JARVIS_MEDIA: fakeR2(),
  ...extra,
});

// Hər test üçün təmiz dünya
export function world(envExtra = {}, opts = {}) {
  _resetMemoryForTests();
  const env = socialEnv(envExtra);
  const store = createStore(env);
  const audit = createAudit(store);
  const approvals = new ApprovalCenter(store, audit);
  let t = opts.start || 1_800_000_000_000;
  const now = () => t;
  const hub = createSocialHub(env, store, { now });
  const flow = createSocialFlow({ env, store, approvals, audit, hub, now, sleep: async (ms) => { t += ms; } });
  return { env, store, audit, approvals, hub, flow, now, advanceTime: (ms) => { t += ms; } };
}

// Token qeydini birbaşa qoyur (OAuth testlərdən kənar)
export async function seedToken(w, platform, rec) {
  await w.hub.vault.put(platform, rec);
}

export const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50, 1, 2, 3, 4, 5, 6, 7, 8]).buffer;
export const JPG = new Uint8Array([255, 216, 255, 224, 1, 2, 3, 4, 5, 6]).buffer;
